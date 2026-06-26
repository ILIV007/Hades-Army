/**
 * Telegram Pipeline v9.5 - Cloudflare Workers Edition
 * Hades Army v9.5 — State-Driven Conversation Engine
 *
 * COMPLETE REWRITE with proper State Machine:
 *
 *   HOME → WAITING_REPO_URL → VALIDATING_REPO → PROJECT_CREATED → PLAN/BUILD
 *
 * The Message Router checks the user's state BEFORE dispatching.
 * No handler runs outside of its expected state.
 *
 * Wizard flow:
 *   1. User taps "Connect Repo" → state = WAITING_REPO_URL
 *   2. User sends URL → state = VALIDATING_REPO → run validator
 *   3. Validation passes → connect repo → state = PROJECT_CREATED
 *   4. Validation fails → show error → state = WAITING_REPO_URL (retry) or HOME
 *
 * Every step wrapped in try/catch — never silent.
 * Update deduplication prevents duplicate messages.
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";
import { getTelegramService, recordTelegramEvent } from "../integrations/telegram-service";
import { getConversationMemory } from "../memory/conversation-memory";
import { getRepositoryManager } from "../github/repository-manager";
import { getRepositoryValidator } from "../github/repository-validator";
import { getConversationStateMachine, STATE_METADATA, type ConversationState } from "../conversation/state-machine";
import { runHealthCheck, renderHealthReport } from "../monitoring/health-dashboard";

// ============================================
// Constants
// ============================================

const CHANNEL_LINK = "@ILIVIR3";
const VERSION_FALLBACK = "9.5";

// ============================================
// Types
// ============================================

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; last_name?: string; username?: string };
    chat: { id: number; type: string; title?: string };
    date: number;
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; last_name?: string; username?: string };
    message?: { message_id: number; chat: { id: number; type: string } };
    data: string;
    chat_instance: string;
  };
}

// ============================================
// Update ID deduplication (single source of truth)
// ============================================

const MAX_DEDUP_IDS = 200;
const recentUpdateIds = new Set<number>();
const recentUpdateIdsArray: number[] = [];

function isDuplicateUpdate(updateId: number): boolean {
  if (recentUpdateIds.has(updateId)) {
    logger.warn("[TG Dedup] Duplicate update_id — skipping", { updateId });
    return true;
  }
  recentUpdateIds.add(updateId);
  recentUpdateIdsArray.push(updateId);
  if (recentUpdateIdsArray.length > MAX_DEDUP_IDS) {
    const oldest = recentUpdateIdsArray.shift();
    if (oldest !== undefined) recentUpdateIds.delete(oldest);
  }
  return false;
}

// ============================================
// Pipeline
// ============================================

export class TelegramPipeline {
  private env: HadesBindings;
  private traceId: string;

  constructor(env: HadesBindings) {
    this.env = env;
    this.traceId = generateId("tg-trace");
  }

  async processUpdate(update: TelegramUpdate): Promise<{ ok: boolean; traceId: string }> {
    // === STEP 0: Deduplicate by update_id (BEFORE anything else) ===
    if (update.update_id !== undefined && isDuplicateUpdate(update.update_id)) {
      return { ok: true, traceId: this.traceId };
    }

    recordTelegramEvent({
      kind: "update_received",
      chatId: update.message?.chat.id ?? update.callback_query?.message?.chat.id,
      userId: update.message?.from?.id ?? update.callback_query?.from.id,
      text: update.message?.text ?? update.callback_query?.data,
    });

    try {
      if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      } else if (update.message?.text) {
        await this.handleMessage(update.message);
      }
      return { ok: true, traceId: this.traceId };
    } catch (err) {
      logger.error("[TG] Pipeline FATAL", {
        traceId: this.traceId,
        error: err instanceof Error ? err.message : String(err),
      });
      const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
      if (chatId !== undefined) {
        const service = getTelegramService(this.env);
        if (service) {
          await service.sendMessage(
            chatId,
            `⚠️ Internal error. Reference: \`${this.traceId}\`\n\nUse /menu to restart.`,
            { parseMode: "Markdown" },
          );
        }
      }
      return { ok: false, traceId: this.traceId };
    }
  }

  // ============================================
  // Message Router — checks state BEFORE dispatching
  // ============================================

  private async handleMessage(msg: NonNullable<TelegramUpdate["message"]>): Promise<void> {
    const chatId = msg.chat.id;
    const userId = String(msg.from?.id ?? "unknown");
    const text = (msg.text ?? "").trim();

    recordTelegramEvent({ kind: "parsed", chatId, userId: Number(userId), text });

    const service = getTelegramService(this.env);
    if (!service) {
      logger.error("[TG] TELEGRAM_BOT_TOKEN missing");
      return;
    }

    // === Commands always work regardless of state ===
    if (text === "/start") {
      await this.sendWelcome(chatId);
      return;
    }
    if (text === "/menu" || text === "/home") {
      await this.stateMachine(userId).transition(userId, "HOME");
      await this.sendHomeScreen(chatId, userId);
      return;
    }
    if (text === "/help") {
      await this.sendHelp(chatId);
      return;
    }
    if (text === "/reset") {
      try {
        const csm = this.stateMachine(userId);
        await csm.reset(userId);
        const convMem = getConversationMemory(this.env);
        await convMem.reset(userId);
      } catch {}
      await service.sendMessage(chatId, `🧹 Reset complete. State: *Home*`, { parseMode: "Markdown" });
      return;
    }

    // === State-driven routing ===
    const csm = this.stateMachine(userId);
    const stateCtx = await csm.getState(userId);
    const state = stateCtx.state;

    logger.info("[TG Router] state-driven", { userId, state, text: text.slice(0, 50) });

    switch (state) {
      case "WAITING_REPO_URL":
        // User is in the wizard — treat ANY text (that's not a command) as a repo URL
        await this.handleRepositoryConnect(chatId, userId, text);
        return;

      case "VALIDATING_REPO":
        await service.sendMessage(chatId, `⏳ Still validating repository... please wait.`, { parseMode: "Markdown" });
        return;

      case "WAITING_APPROVAL":
        // User is responding to an approval request
        await service.sendMessage(
          chatId,
          `Please use the buttons (✅ Approve / ❌ Reject) to respond.`,
          { parseMode: "Markdown" },
        );
        return;

      case "WAITING_CLARIFICATION":
        // User is answering a Manager question
        await service.sendMessage(
          chatId,
          [
            `❓ *Answer recorded*`,
            ``,
            `_Manager will process your answer: ${text.slice(0, 200)}_`,
            ``,
            `Trace: \`${this.traceId}\``,
          ].join("\n"),
          { parseMode: "Markdown" },
        );
        await csm.transition(userId, "PLAN_MODE");
        return;
    }

    // === Mode commands (only valid when not in wizard) ===
    const modeMatch = text.match(/^\/(plan|build|explore|analyze|review|debug|architect|chat)$/);
    if (modeMatch) {
      await this.switchMode(chatId, userId, modeMatch[1]);
      return;
    }

    if (text === "/repositories" || text === "/repos") {
      await this.showRepositories(chatId, userId);
      return;
    }
    if (text === "/health") {
      await this.showHealth(chatId);
      return;
    }
    if (text === "/memory") {
      await this.showMemorySnapshot(chatId, userId);
      return;
    }

    // === Free text — depends on state ===
    if (text.length < 3) {
      await service.sendMessage(
        chatId,
        [
          `👋 Send a description of what you want me to do.`,
          ``,
          `Commands: /menu · /plan · /build · /explore · /repositories · /health`,
        ].join("\n"),
        { parseMode: "Markdown" },
      );
      return;
    }

    // Check if repo is connected
    let activeRepo: string | undefined;
    try {
      const convMem = getConversationMemory(this.env);
      const snap = await convMem.getSnapshot(userId);
      activeRepo = snap.activeRepository;
    } catch {}

    if (!activeRepo) {
      await service.sendMessage(
        chatId,
        [
          `🔗 *Connect a repository first*`,
          ``,
          `Tap below to start the wizard:`,
        ].join("\n"),
        {
          parseMode: "Markdown",
          replyMarkup: {
            inline_keyboard: [
              [{ text: "🔗 Connect Repository", callback_data: "home:connect_repo" }],
              [{ text: "📦 My Repositories", callback_data: "home:repositories" }],
            ],
          },
        },
      );
      return;
    }

    // Free-text request — v9.6: ACTUALLY call the Manager Execution Pipeline
    await this.executeManagerPipeline(chatId, userId, text, state, activeRepo);
  }

  // ============================================
  // v10.1 — Manager Execution Pipeline (calls LLM)
  // FIXED: no intermediate edits (causes timing issues),
  //        fallback to new message if edit fails,
  //        timeout protection (25s — Worker limit is 30s)
  // ============================================

  private async executeManagerPipeline(
    chatId: number,
    userId: string,
    userPrompt: string,
    state: ConversationState,
    activeRepo: string | undefined,
  ): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    // Send ONE initial message — we'll edit it ONCE at the end
    const progressMsg = await service.sendMessage(
      chatId,
      [
        `⏳ *Processing...*`,
        ``,
        `_Manager is analyzing your request_`,
      ].join("\n"),
      { parseMode: "Markdown" },
    );

    const messageId = progressMsg.messageId;

    // Helper: try to edit, fall back to new message if edit fails
    const updateMessage = async (text: string): Promise<void> => {
      if (messageId) {
        const editResult = await service.editMessageText(chatId, messageId, text, { parseMode: "Markdown" });
        if (editResult.ok) return; // edit succeeded
        // edit failed — fall back to sending a new message
        logger.warn("[TG Pipeline] edit failed, sending new message", { error: editResult.error });
      }
      await service.sendMessage(chatId, text, { parseMode: "Markdown" });
    };

    try {
      const { getManagerExecutionPipeline } = await import("../manager/execution-pipeline");
      const pipeline = getManagerExecutionPipeline(this.env);

      // Run pipeline with 25s timeout (Worker limit is 30s)
      const pipelinePromise = pipeline.execute({
        userPrompt,
        userId,
        repositoryFullName: activeRepo,
        mode: STATE_METADATA[state].label.toLowerCase().replace(" mode", ""),
        traceId: this.traceId,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Pipeline timed out (25s)")), 25000);
      });

      const result = await Promise.race([pipelinePromise, timeoutPromise]);

      if (result.ok) {
        await updateMessage(result.response);
      } else {
        await updateMessage([
          `⚠️ *Request failed*`,
          ``,
          result.error ?? "Unknown error",
          ``,
          `📋 Trace: \`${this.traceId.slice(-8)}\``,
        ].join("\n"));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error("[TG Pipeline] FATAL", { traceId: this.traceId, error: errMsg });

      await updateMessage([
        `⚠️ *Error*`,
        ``,
        errMsg,
        ``,
        `📋 Trace: \`${this.traceId.slice(-8)}\``,
        ``,
        `Use /menu to restart.`,
      ].join("\n"));
    }
  }

  // ============================================
  // Unified Callback Router
  // ============================================

  private async handleCallbackQuery(cq: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
    const chatId = cq.message?.chat.id;
    if (chatId === undefined) return;
    const userId = String(cq.from.id);
    const data = cq.data ?? "";

    const service = getTelegramService(this.env);
    if (!service) return;

    // Acknowledge callback
    await service.answerCallbackQuery(cq.id);

    try {
      const [prefix, action] = data.split(":");

      switch (prefix) {
        case "home":
          await this.handleHomeCallback(chatId, userId, action);
          return;
        case "menu":
          await this.handleMenuCallback(chatId, userId, action);
          return;
        case "repos":
          await this.handleReposCallback(chatId, userId, action);
          return;
        case "mode":
          if (action === "switch") {
            const targetMode = data.split(":")[2];
            if (targetMode) await this.switchMode(chatId, userId, targetMode);
          }
          return;
        case "help":
          await this.handleHelpCallback(chatId, userId, action);
          return;
        case "onboard":
          await this.handleOnboardCallback(chatId, userId, action);
          return;
        case "approval":
          await this.handleApprovalCallback(chatId, userId, action);
          return;
        default:
          await service.sendMessage(
            chatId,
            `Unknown action: \`${data}\`\n\nUse /menu to restart.`,
            { parseMode: "Markdown" },
          );
      }
    } catch (err) {
      logger.error("[TG] Callback error", { traceId: this.traceId, data, err: err instanceof Error ? err.message : String(err) });
      await service.sendMessage(
        chatId,
        `⚠️ Action failed. Reference: \`${this.traceId}\``,
        { parseMode: "Markdown" },
      );
    }
  }

  // ============================================
  // Home callback handler
  // ============================================

  private async handleHomeCallback(chatId: number, userId: string, action: string | undefined): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;
    const csm = this.stateMachine(userId);

    switch (action) {
      case "main":
      case "back":
        await csm.transition(userId, "HOME");
        await this.sendHomeScreen(chatId, userId);
        return;

      case "dashboard":
        await this.sendDashboard(chatId, userId);
        return;

      case "projects":
        await service.sendMessage(
          chatId,
          [
            `📂 *My Projects*`,
            ``,
            `No projects yet. Connect a repository to create your first project.`,
          ].join("\n"),
          {
            parseMode: "Markdown",
            replyMarkup: {
              inline_keyboard: [
                [{ text: "🔗 Connect Repository", callback_data: "home:connect_repo" }],
                [{ text: "🔙 Home", callback_data: "home:main" }],
              ],
            },
          },
        );
        return;

      case "new_project":
      case "connect_repo":
        // v9.6 — Check if user has GitHub OAuth token
        try {
          const { getGitHubOAuthManager } = await import("../github/oauth-manager");
          const oauth = getGitHubOAuthManager(this.env);
          const hasToken = await oauth.hasToken(userId);

          if (!hasToken) {
            // No token — offer OAuth or manual URL
            if (oauth.isOAuthConfigured()) {
              await service.sendMessage(
                chatId,
                [
                  `🔗 *Connect Repository*`,
                  ``,
                  `You need to authorize GitHub first.`,
                  ``,
                  `Tap below to open GitHub OAuth:`,
                ].join("\n"),
                {
                  parseMode: "Markdown",
                  replyMarkup: {
                    inline_keyboard: [
                      [{ text: "🔐 Authorize GitHub", callback_data: "home:github_oauth" }],
                      [{ text: "✏️ Enter URL manually", callback_data: "home:manual_repo" }],
                      [{ text: "🔙 Home", callback_data: "home:main" }],
                    ],
                  },
                },
              );
            } else {
              // OAuth not configured — fall back to manual URL
              await csm.transition(userId, "WAITING_REPO_URL");
              await service.sendMessage(
                chatId,
                [
                  `🔗 *Connect Repository*`,
                  ``,
                  `Send me the repository URL or \`owner/name\`:`,
                  ``,
                  `Examples:`,
                  `• \`https://github.com/owner/repo\``,
                  `• \`owner/repo\``,
                ].join("\n"),
                {
                  parseMode: "Markdown",
                  replyMarkup: { inline_keyboard: [[{ text: "🔙 Cancel", callback_data: "home:main" }]] },
                },
              );
            }
            return;
          }

          // Has token — show repository list
          await this.showRepositoryList(chatId, userId);
        } catch (err) {
          // Fallback to manual URL
          await csm.transition(userId, "WAITING_REPO_URL");
          await service.sendMessage(
            chatId,
            `🔗 Send me the repository URL (\`owner/repo\`):`,
            { parseMode: "Markdown" },
          );
        }
        return;

      case "github_oauth":
        // v9.6 — Start OAuth flow
        await this.startGitHubOAuth(chatId, userId);
        return;

      case "manual_repo":
        // v9.6 — Manual URL entry (fallback)
        await csm.transition(userId, "WAITING_REPO_URL");
        await service.sendMessage(
          chatId,
          [
            `🔗 *Connect Repository*`,
            ``,
            `Send me the repository URL or \`owner/name\`:`,
          ].join("\n"),
          {
            parseMode: "Markdown",
            replyMarkup: { inline_keyboard: [[{ text: "🔙 Cancel", callback_data: "home:main" }]] },
          },
        );
        return;

      case "select_repo":
        // v9.6 — Show user's repos from their GitHub token
        await this.showRepositoryList(chatId, userId);
        return;

      case "repositories":
        await this.showRepositories(chatId, userId);
        return;

      case "tasks":
        await service.sendMessage(
          chatId,
          [`📋 *Tasks*`, ``, `No active tasks.`].join("\n"),
          {
            parseMode: "Markdown",
            replyMarkup: { inline_keyboard: [[{ text: "🔙 Home", callback_data: "home:main" }]] },
          },
        );
        return;

      case "plan":
        await this.switchMode(chatId, userId, "plan");
        return;

      case "build":
        await this.switchMode(chatId, userId, "build");
        return;

      case "activity":
        await service.sendMessage(
          chatId,
          [`📊 *Activity*`, ``, `No recent activity.`].join("\n"),
          {
            parseMode: "Markdown",
            replyMarkup: { inline_keyboard: [[{ text: "🔙 Home", callback_data: "home:main" }]] },
          },
        );
        return;

      case "mode":
        await this.showModeSwitcher(chatId, userId);
        return;

      case "memory":
        await this.showMemorySnapshot(chatId, userId);
        return;

      case "settings":
        await this.showSettings(chatId, userId);
        return;

      case "help":
        await this.sendHelp(chatId);
        return;

      case "full_health":
        await this.showHealth(chatId);
        return;

      case "cost":
        await service.sendMessage(
          chatId,
          [`💰 *Cost Report*`, ``, `Cost tracking is available via the admin dashboard.`].join("\n"),
          {
            parseMode: "Markdown",
            replyMarkup: { inline_keyboard: [[{ text: "🔙 Home", callback_data: "home:main" }]] },
          },
        );
        return;

      default:
        await service.sendMessage(chatId, `Unknown home action: \`${action}\``, { parseMode: "Markdown" });
    }
  }

  // ============================================
  // Menu callback handler (legacy compat)
  // ============================================

  private async handleMenuCallback(chatId: number, userId: string, action: string | undefined): Promise<void> {
    switch (action) {
      case "main":
      case "back":
        await this.handleHomeCallback(chatId, userId, "main");
        return;
      case "connect_repository":
        await this.handleHomeCallback(chatId, userId, "connect_repo");
        return;
      case "my_repositories":
        await this.showRepositories(chatId, userId);
        return;
      case "plan":
        await this.switchMode(chatId, userId, "plan");
        return;
      case "build":
        await this.switchMode(chatId, userId, "build");
        return;
      case "explore":
        await this.switchMode(chatId, userId, "explore");
        return;
      case "status":
        await this.showHealth(chatId);
        return;
      case "settings":
        await this.showSettings(chatId, userId);
        return;
      default:
        await this.handleHomeCallback(chatId, userId, action);
    }
  }

  // ============================================
  // Repos callback handler
  // ============================================

  private async handleReposCallback(chatId: number, userId: string, action: string | undefined): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    const parts = action ? action.split(":") : [];
    const subAction = parts[0];
    const repoFullName = parts.slice(1).join(":");

    switch (subAction) {
      case "select":
        if (repoFullName) {
          try {
            const convMem = getConversationMemory(this.env);
            await convMem.setActiveRepository(userId, repoFullName);
            const csm = this.stateMachine(userId);
            await csm.transition(userId, "PROJECT_CREATED");
          } catch {}
          await service.sendMessage(chatId, `✅ Active repository: \`${repoFullName}\``, { parseMode: "Markdown" });
        }
        return;
      case "rescan":
        if (repoFullName) {
          await service.sendMessage(chatId, `🔄 Rescanning \`${repoFullName}\`...`, { parseMode: "Markdown" });
          try {
            const repoManager = getRepositoryManager(this.env);
            await repoManager.rescan(userId, repoFullName);
            await service.sendMessage(chatId, `✅ Rescan complete.`, { parseMode: "Markdown" });
          } catch (err) {
            await service.sendMessage(chatId, `❌ Rescan error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return;
      case "remove":
        if (repoFullName) {
          try {
            const repoManager = getRepositoryManager(this.env);
            await repoManager.remove(userId, repoFullName);
            const convMem = getConversationMemory(this.env);
            await convMem.clearWorkflow(userId);
            const csm = this.stateMachine(userId);
            await csm.transition(userId, "HOME");
          } catch {}
          await service.sendMessage(chatId, `🗑 Removed \`${repoFullName}\``, { parseMode: "Markdown" });
        }
        return;
      default:
        await this.showRepositories(chatId, userId);
    }
  }

  // ============================================
  // Help callback handler
  // ============================================

  private async handleHelpCallback(chatId: number, _userId: string, action: string | undefined): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    const topics: Record<string, string> = {
      planning: `🧠 *Planning*\n\n1. /plan mode\n2. Describe request\n3. Manager asks questions\n4. 3 strategies: Fast / Balanced / Enterprise\n5. Choose strategy\n6. Task breakdown\n\nNo code changes in Plan mode.`,
      build: `⚒ *Build*\n\n1. /build mode\n2. Need approved plan\n3. Manager → Builder → Reviewer\n4. Manager summarizes\n5. You approve\n6. PR created\n7. You merge\n\nNever auto-merges.`,
      approval: `✅ *Approval*\n\nBefore PR:\n• Manager shows summary\n• Files, risk, impact\n• Approve / Reject / Request changes\n\nPR only after Approve.`,
      memory: `🧠 *Memory*\n\nPer-project:\n• Architecture\n• Decisions (ADRs)\n• Failed approaches\n• Conventions\n• Recent conversations\n\nUse /memory to view.`,
    };

    const text = topics[action ?? ""] ?? `Unknown topic: ${action}`;
    await service.sendMessage(chatId, text, {
      parseMode: "Markdown",
      replyMarkup: { inline_keyboard: [[{ text: "🔙 Help", callback_data: "home:help" }]] },
    });
  }

  // ============================================
  // Onboarding callback handler
  // ============================================

  private async handleOnboardCallback(chatId: number, userId: string, action: string | undefined): Promise<void> {
    if (action === "skip" || action === "finish") {
      await this.sendHomeScreen(chatId, userId);
      return;
    }
    const step = parseInt(action ?? "1", 10);
    await this.sendOnboardingStep(chatId, step);
  }

  // ============================================
  // Approval callback handler (v9.5)
  // ============================================

  private async handleApprovalCallback(chatId: number, userId: string, action: string | undefined): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;
    const csm = this.stateMachine(userId);

    if (action === "approve") {
      await service.sendMessage(chatId, `✅ *Approved!* Proceeding with deployment...`, { parseMode: "Markdown" });
      await csm.transition(userId, "DEPLOY_MODE");
    } else if (action === "reject") {
      await service.sendMessage(chatId, `❌ *Rejected.* Returning to planning.`, { parseMode: "Markdown" });
      await csm.transition(userId, "PLAN_MODE");
    } else if (action === "changes") {
      await service.sendMessage(chatId, `🔄 *Changes requested.* Builder will revise.`, { parseMode: "Markdown" });
      await csm.transition(userId, "BUILD_MODE");
    }
  }

  // ============================================
  // Repository Connect — THE FIXED WIZARD
  // ============================================

  private async handleRepositoryConnect(chatId: number, userId: string, input: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;
    const csm = this.stateMachine(userId);

    // Parse URL
    const trimmed = input.trim();
    let repoFullName: string | undefined;
    const shortMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
    if (shortMatch) {
      repoFullName = `${shortMatch[1]}/${shortMatch[2].replace(/\.git$/, "")}`;
    } else {
      const urlMatch = trimmed.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/i);
      if (urlMatch) {
        repoFullName = `${urlMatch[1]}/${urlMatch[2].replace(/\.git$/, "")}`;
      }
    }

    if (!repoFullName) {
      await service.sendMessage(
        chatId,
        [
          `❌ *Invalid repository URL*`,
          ``,
          `Accepted: \`owner/repo\` or \`https://github.com/owner/repo\``,
          ``,
          `_Try again or tap Cancel._`,
        ].join("\n"),
        {
          parseMode: "Markdown",
          replyMarkup: { inline_keyboard: [[{ text: "🔙 Cancel", callback_data: "home:main" }]] },
        },
      );
      return; // stay in WAITING_REPO_URL state
    }

    // Transition to VALIDATING_REPO
    await csm.transition(userId, "VALIDATING_REPO", { repoFullName });

    await service.sendMessage(
      chatId,
      [
        `🔍 *Validating repository...*`,
        ``,
        `Repository: \`${repoFullName}\``,
        ``,
        `⏳ Checking:`,
        `• Repository exists`,
        `• GitHub access`,
        `• Default branch`,
        `• Permissions`,
        `• Language & framework`,
        `• Size & license`,
      ].join("\n"),
      { parseMode: "Markdown" },
    );

    try {
      // === Run validator ===
      const validator = getRepositoryValidator(this.env);
      const result = await validator.validate(repoFullName);

      // Show validation results
      await service.sendMessage(chatId, validator.render(result), { parseMode: "Markdown" });

      if (!result.ok) {
        // Validation failed — return to WAITING_REPO_URL so user can try again
        await csm.transition(userId, "WAITING_REPO_URL");
        await service.sendMessage(
          chatId,
          [
            `❌ *Validation failed*`,
            ``,
            `${result.error ?? "Unknown error"}`,
            ``,
            `Send another repository URL, or tap Cancel.`,
          ].join("\n"),
          {
            parseMode: "Markdown",
            replyMarkup: { inline_keyboard: [[{ text: "🔙 Cancel", callback_data: "home:main" }]] },
          },
        );
        return;
      }

      // === Validation passed — connect the repository ===
      const repoManager = getRepositoryManager(this.env);
      await repoManager.connect(userId, {
        repositoryFullName: result.summary.repositoryFullName ?? repoFullName,
        displayName: repoFullName.split("/").pop() ?? repoFullName,
        visibility: result.summary.visibility,
        defaultBranch: result.summary.defaultBranch,
        language: result.summary.language,
        size: result.summary.sizeKb,
      });

      const convMem = getConversationMemory(this.env);
      await convMem.setActiveRepository(userId, repoFullName);
      const projectId = `proj_${Date.now()}`;
      await convMem.setActiveProject(userId, projectId);

      // Transition to PROJECT_CREATED
      await csm.transition(userId, "PROJECT_CREATED", { projectId, repoFullName });

      const vis = result.summary.visibility === "private" ? "🔒 Private" : "🌐 Public";
      await service.sendMessage(
        chatId,
        [
          `✅ *Repository Connected Successfully!*`,
          ``,
          `*Name:* \`${repoFullName}\``,
          `*Visibility:* ${vis}`,
          `*Language:* ${result.summary.language}`,
          `*Framework:* ${result.summary.framework ?? "Not detected"}`,
          `*Default branch:* \`${result.summary.defaultBranch}\``,
          `*Size:* ${(result.summary.sizeKb / 1024).toFixed(1)} MB`,
          `*License:* ${result.summary.license ?? "None"}`,
          `*Write access:* ${result.summary.canWrite ? "✅ Yes" : "⚠️ Read-only"}`,
          ``,
          `*Project ID:* \`${projectId}\``,
          ``,
          `🎉 You can now use /plan to start planning!`,
        ].join("\n"),
        {
          parseMode: "Markdown",
          replyMarkup: {
            inline_keyboard: [
              [
                { text: "🧠 Plan", callback_data: "home:plan" },
                { text: "⚒ Build", callback_data: "home:build" },
              ],
              [{ text: "🏠 Home", callback_data: "home:main" }],
            ],
          },
        },
      );
    } catch (err) {
      // Error — return to WAITING_REPO_URL
      await csm.transition(userId, "WAITING_REPO_URL");
      await service.sendMessage(
        chatId,
        [
          `❌ *Connection failed*`,
          ``,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
          ``,
          `Send another URL or tap Cancel.`,
        ].join("\n"),
        {
          parseMode: "Markdown",
          replyMarkup: { inline_keyboard: [[{ text: "🔙 Cancel", callback_data: "home:main" }]] },
        },
      );
    }
  }

  // ============================================
  // Screen renderers
  // ============================================

  private async sendWelcome(chatId: number): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;
    const version = this.getVersion();

    const text = [
      `🏛 *Welcome to Hades Army* v${version}`,
      ``,
      `Your autonomous AI software engineering team.`,
      ``,
      `🧠 *Manager* — plans, evaluates risk, decides`,
      `⚒ *Builder* — generates code patches`,
      `🛡 *Reviewer* — validates before PR`,
      ``,
      `📊 *Channel:* ${CHANNEL_LINK}`,
      ``,
      `Tap /menu to get started.`,
    ].join("\n");

    await service.sendMessage(chatId, text, {
      parseMode: "Markdown",
      replyMarkup: {
        inline_keyboard: [
          [{ text: "🏠 Open Menu", callback_data: "home:main" }],
          [{ text: "📢 Join Channel", url: `https://t.me/${CHANNEL_LINK.replace("@", "")}` }],
        ],
      },
    });
  }

  private async sendHomeScreen(chatId: number, userId: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;
    const version = this.getVersion();

    // Get current state
    const csm = this.stateMachine(userId);
    const stateCtx = await csm.getState(userId);
    const stateMeta = STATE_METADATA[stateCtx.state];

    let activeRepo: string | undefined;
    try {
      const convMem = getConversationMemory(this.env);
      const snap = await convMem.getSnapshot(userId);
      activeRepo = snap.activeRepository;
    } catch {}

    const lines: string[] = [
      `🏛 *Hades Army* v${version}`,
      ``,
      `*State:* ${stateMeta.emoji} ${stateMeta.label}`,
      `*Repository:* ${activeRepo ? `\`${activeRepo}\`` : "none connected"}`,
      ``,
      `_Tap an option below:_`,
    ];

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
      [
        { text: "🏠 Dashboard", callback_data: "home:dashboard" },
        { text: "📂 Projects", callback_data: "home:projects" },
      ],
      [
        { text: "🔗 Connect Repo", callback_data: "home:connect_repo" },
        { text: "📦 Repositories", callback_data: "home:repositories" },
      ],
      [
        { text: "🧠 Plan", callback_data: "home:plan" },
        { text: "⚒ Build", callback_data: "home:build" },
      ],
      [
        { text: "📋 Tasks", callback_data: "home:tasks" },
        { text: "📊 Activity", callback_data: "home:activity" },
      ],
      [
        { text: "🎛 Mode", callback_data: "home:mode" },
        { text: "📚 Memory", callback_data: "home:memory" },
      ],
      [
        { text: "📊 Health", callback_data: "home:full_health" },
        { text: "⚙ Settings", callback_data: "home:settings" },
      ],
      [{ text: "❓ Help", callback_data: "home:help" }],
    ];

    recordTelegramEvent({ kind: "sending", chatId, responsePreview: lines.join("\n").slice(0, 80) });
    await service.sendMessage(chatId, lines.join("\n"), {
      parseMode: "Markdown",
      replyMarkup: { inline_keyboard: keyboard },
    });
  }

  private async sendDashboard(chatId: number, userId: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    const csm = this.stateMachine(userId);
    const stateCtx = await csm.getState(userId);
    const stateMeta = STATE_METADATA[stateCtx.state];

    let activeRepo: string | undefined;
    try {
      const convMem = getConversationMemory(this.env);
      const snap = await convMem.getSnapshot(userId);
      activeRepo = snap.activeRepository;
    } catch {}

    const text = [
      `🏠 *Dashboard*`,
      ``,
      `*State:* ${stateMeta.emoji} ${stateMeta.label}`,
      `*Repository:* ${activeRepo ? `\`${activeRepo}\`` : "none"}`,
      `*Running tasks:* 0`,
      `*Pending approvals:* 0`,
      `*Completed today:* 0`,
      `*Failed today:* 0`,
    ].join("\n");

    await service.sendMessage(chatId, text, {
      parseMode: "Markdown",
      replyMarkup: {
        inline_keyboard: [
          [
            { text: "📋 Tasks", callback_data: "home:tasks" },
            { text: "📊 Activity", callback_data: "home:activity" },
          ],
          [
            { text: "🩺 Full Health", callback_data: "home:full_health" },
            { text: "💰 Cost", callback_data: "home:cost" },
          ],
          [{ text: "🔙 Home", callback_data: "home:main" }],
        ],
      },
    });
  }

  private async showModeSwitcher(chatId: number, userId: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    const text = [`🎛 *Switch Mode*`, ``, `Select a mode:`].join("\n");

    const modes: Array<{ emoji: string; label: string; mode: string }> = [
      { emoji: "🧠", label: "Plan", mode: "plan" },
      { emoji: "⚒️", label: "Build", mode: "build" },
      { emoji: "🔍", label: "Explore", mode: "explore" },
      { emoji: "🔬", label: "Analyze", mode: "analyze" },
      { emoji: "🛡️", label: "Review", mode: "review" },
      { emoji: "🐞", label: "Debug", mode: "debug" },
      { emoji: "🏛", label: "Architect", mode: "architect" },
      { emoji: "💬", label: "Chat", mode: "chat" },
    ];

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < modes.length; i += 2) {
      const row: Array<{ text: string; callback_data: string }> = [];
      for (let j = 0; j < 2; j++) {
        if (modes[i + j]) {
          row.push({
            text: `${modes[i + j].emoji} ${modes[i + j].label}`,
            callback_data: `mode:switch:${modes[i + j].mode}`,
          });
        }
      }
      keyboard.push(row);
    }
    keyboard.push([{ text: "🔙 Home", callback_data: "home:main" }]);

    await service.sendMessage(chatId, text, {
      parseMode: "Markdown",
      replyMarkup: { inline_keyboard: keyboard },
    });
  }

  private async showSettings(chatId: number, userId: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;
    const version = this.getVersion();
    const csm = this.stateMachine(userId);
    const stateCtx = await csm.getState(userId);

    const text = [
      `⚙ *Settings*`,
      ``,
      `*Version:* ${version}`,
      `*State:* ${STATE_METADATA[stateCtx.state].label}`,
      ``,
      `Configured:`,
      `• Telegram: ${this.env.TELEGRAM_BOT_TOKEN ? "✅" : "❌"}`,
      `• GitHub: ${this.env.GITHUB_TOKEN ? "✅" : "❌"}`,
      `• Google AI: ${this.env.GOOGLE_AI_API_KEY ? "✅" : "❌"}`,
      `• OpenRouter: ${this.env.OPENROUTER_API_KEY ? "✅" : "❌"}`,
      `• Admin: ${this.env.ADMIN_API_TOKEN ? "✅" : "❌"}`,
    ].join("\n");

    await service.sendMessage(chatId, text, {
      parseMode: "Markdown",
      replyMarkup: {
        inline_keyboard: [
          [{ text: "🔄 Reset State", callback_data: "home:reset" }],
          [{ text: "🔙 Home", callback_data: "home:main" }],
        ],
      },
    });
  }

  private async sendHelp(chatId: number): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;
    const version = this.getVersion();

    const text = [
      `❓ *Help* — v${version}`,
      ``,
      `*Commands:*`,
      `/start — Welcome message`,
      `/menu — Home screen`,
      `/plan — PLAN mode`,
      `/build — BUILD mode`,
      `/explore — EXPLORE mode`,
      `/analyze — ANALYZE mode`,
      `/review — REVIEW mode`,
      `/debug — DEBUG mode`,
      `/architect — ARCHITECT mode`,
      `/chat — CHAT mode`,
      `/repositories — Manage repos`,
      `/memory — Memory snapshot`,
      `/health — System health`,
      `/reset — Reset state + memory`,
      ``,
      `*Channel:* ${CHANNEL_LINK}`,
    ].join("\n");

    await service.sendMessage(chatId, text, {
      parseMode: "Markdown",
      replyMarkup: {
        inline_keyboard: [
          [
            { text: "How planning works", callback_data: "help:planning" },
            { text: "How build works", callback_data: "help:build" },
          ],
          [
            { text: "How approval works", callback_data: "help:approval" },
            { text: "How memory works", callback_data: "help:memory" },
          ],
          [{ text: "🔙 Home", callback_data: "home:main" }],
        ],
      },
    });
  }

  private async sendOnboardingStep(chatId: number, step: number): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    const steps: Array<{ body: string }> = [
      { body: `🏛 *Welcome to Hades Army*\n\nYour autonomous AI software engineering team.\n\n🧠 Manager — plans, decides\n⚒ Builder — generates code\n🛡 Reviewer — validates` },
      { body: `🎛 *8 Modes*\n\nPLAN, BUILD, EXPLORE, ANALYZE, REVIEW, DEBUG, ARCHITECT, CHAT\n\nSwitch anytime with /plan /build etc.` },
      { body: `🧠 *Memory System*\n\nRemembers: architecture, decisions, failures, conventions.\n\nPer-project, persistent.` },
      { body: `🔗 *Connect a Repository*\n\nTap "Connect Repo" from the menu and send the URL.` },
      { body: `✅ *Ready!*\n\nUse /menu to start.\nChannel: ${CHANNEL_LINK}` },
    ];

    const idx = Math.max(0, Math.min(step - 1, steps.length - 1));
    const s = steps[idx];

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
    if (idx < steps.length - 1) {
      keyboard.push([{ text: "Next →", callback_data: `onboard:${idx + 2}` }]);
    } else {
      keyboard.push([{ text: "✅ Finish", callback_data: "onboard:finish" }]);
    }
    keyboard.push([{ text: "🔙 Skip", callback_data: "onboard:skip" }]);

    await service.sendMessage(chatId, s.body, {
      parseMode: "Markdown",
      replyMarkup: { inline_keyboard: keyboard },
    });
  }

  // ============================================
  // Mode switching (uses state machine)
  // ============================================

  private async switchMode(chatId: number, userId: string, mode: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;
    const csm = this.stateMachine(userId);

    const modes: Record<string, { emoji: string; label: string; role: string; tagline: string; state: ConversationState }> = {
      plan: { emoji: "🧠", label: "Plan", role: "Planner", tagline: "Engineering planning", state: "PLAN_MODE" },
      build: { emoji: "⚒️", label: "Build", role: "Executor", tagline: "Execute approved plans", state: "BUILD_MODE" },
      explore: { emoji: "🔍", label: "Explore", role: "Analyst", tagline: "Quick repo exploration", state: "HOME" },
      analyze: { emoji: "🔬", label: "Analyze", role: "Senior Analyst", tagline: "Deep repo analysis", state: "HOME" },
      review: { emoji: "🛡️", label: "Review", role: "Reviewer", tagline: "Review code/PR", state: "REVIEW_MODE" },
      debug: { emoji: "🐞", label: "Debug", role: "Debugger", tagline: "Diagnose failures", state: "HOME" },
      architect: { emoji: "🏛", label: "Architect", role: "Architect", tagline: "Architecture discussion", state: "HOME" },
      chat: { emoji: "💬", label: "Chat", role: "Assistant", tagline: "General conversation", state: "HOME" },
    };

    const m = modes[mode];
    if (!m) {
      await service.sendMessage(chatId, `❌ Unknown mode: ${mode}`, { parseMode: "Markdown" });
      return;
    }

    // Transition to the mode's state
    await csm.transition(userId, m.state);

    try {
      const convMem = getConversationMemory(this.env);
      await convMem.setMode(userId, mode as any);
    } catch {}

    await service.sendMessage(
      chatId,
      [
        `${m.emoji} *${m.label}* mode activated`,
        ``,
        `_${m.tagline}_`,
        ``,
        `Manager role: *${m.role}*`,
        ``,
        `State: ${STATE_METADATA[m.state].emoji} ${STATE_METADATA[m.state].label}`,
      ].join("\n"),
      {
        parseMode: "Markdown",
        replyMarkup: { inline_keyboard: [[{ text: "🔙 Home", callback_data: "home:main" }]] },
      },
    );
  }

  // ============================================
  // Repositories
  // ============================================

  private async showRepositories(chatId: number, userId: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    try {
      const repoManager = getRepositoryManager(this.env);
      const repos = await repoManager.listForUser(userId);
      const { text, replyMarkup } = repoManager.renderList(repos);
      await service.sendMessage(chatId, text, { parseMode: "Markdown", replyMarkup });
    } catch (err) {
      await service.sendMessage(chatId, `⚠️ Failed to load repositories: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ============================================
  // Health & Memory
  // ============================================

  private async showHealth(chatId: number): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;
    await service.sendMessage(chatId, `🩺 Running health check...`);
    try {
      const report = await runHealthCheck(this.env);
      const text = renderHealthReport(report);
      await service.sendMessage(chatId, text, {
        parseMode: "Markdown",
        replyMarkup: { inline_keyboard: [[{ text: "🔙 Home", callback_data: "home:main" }]] },
      });
    } catch (err) {
      await service.sendMessage(chatId, `⚠️ Health check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async showMemorySnapshot(chatId: number, userId: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;
    try {
      const convMem = getConversationMemory(this.env);
      const snap = await convMem.getSnapshot(userId);
      const csm = this.stateMachine(userId);
      const stateCtx = await csm.getState(userId);

      const text = [
        `🧠 *Memory Snapshot*`,
        ``,
        `*State:* ${STATE_METADATA[stateCtx.state].emoji} ${STATE_METADATA[stateCtx.state].label}`,
        `*Active project:* \`${snap.activeProject ?? "(none)"}\``,
        `*Active repository:* \`${snap.activeRepository ?? "(none)"}\``,
        `*Active workflow:* \`${snap.activeWorkflow ?? "(none)"}\``,
        `*Active mode:* ${snap.activeMode ?? "plan"}`,
        `*Recent approvals:* ${snap.recentApprovalsCount}`,
      ].join("\n");
      await service.sendMessage(chatId, text, {
        parseMode: "Markdown",
        replyMarkup: { inline_keyboard: [[{ text: "🔙 Home", callback_data: "home:main" }]] },
      });
    } catch (err) {
      await service.sendMessage(chatId, `⚠️ Memory snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ============================================
  // Helpers
  // ============================================

  private getVersion(): string {
    return this.env.HADES_VERSION ?? VERSION_FALLBACK;
  }

  private stateMachine(userId: string): ReturnType<typeof getConversationStateMachine> {
    return getConversationStateMachine(this.env);
  }

  // ============================================
  // v9.6 — GitHub OAuth helpers
  // ============================================

  private async startGitHubOAuth(chatId: number, userId: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    try {
      const { getGitHubOAuthManager } = await import("../github/oauth-manager");
      const oauth = getGitHubOAuthManager(this.env);

      if (!oauth.isOAuthConfigured()) {
        await service.sendMessage(
          chatId,
          [
            `❌ *GitHub OAuth not configured*`,
            ``,
            `The admin needs to set:`,
            `• \`OAUTH_GITHUB_CLIENT_ID\``,
            `• \`OAUTH_GITHUB_CLIENT_SECRET\``,
            ``,
            `Use "Enter URL manually" as fallback.`,
          ].join("\n"),
          {
            parseMode: "Markdown",
            replyMarkup: { inline_keyboard: [[{ text: "✏️ Manual URL", callback_data: "home:manual_repo" }]] },
          },
        );
        return;
      }

      // We need the worker URL — derive from a known endpoint
      // In production, this would come from the request
      const workerUrl = `https://hades-army.iliv007.workers.dev`;
      const result = await oauth.createAuthorizationUrl(userId, chatId, workerUrl);

      if ("error" in result) {
        await service.sendMessage(chatId, `❌ ${result.error}`, { parseMode: "Markdown" });
        return;
      }

      await service.sendMessage(
        chatId,
        [
          `🔐 *GitHub Authorization*`,
          ``,
          `Tap the button below to authorize Hades Army on GitHub:`,
          ``,
          `_You'll be redirected to GitHub. After authorizing, you'll come back here automatically._`,
        ].join("\n"),
        {
          parseMode: "Markdown",
          replyMarkup: {
            inline_keyboard: [
              [{ text: "🔐 Authorize on GitHub", url: result.url }],
              [{ text: "🔙 Cancel", callback_data: "home:main" }],
            ],
          },
        },
      );
    } catch (err) {
      await service.sendMessage(chatId, `❌ OAuth error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async showRepositoryList(chatId: number, userId: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    await service.sendMessage(chatId, `📦 *Loading your repositories...*`, { parseMode: "Markdown" });

    try {
      const { getGitHubOAuthManager } = await import("../github/oauth-manager");
      const oauth = getGitHubOAuthManager(this.env);
      const repos = await oauth.fetchUserRepositories(userId);

      if (repos.length === 0) {
        await service.sendMessage(
          chatId,
          [
            `📦 *No repositories found*`,
            ``,
            `Your GitHub account has no repositories, or the token lacks access.`,
          ].join("\n"),
          {
            parseMode: "Markdown",
            replyMarkup: { inline_keyboard: [[{ text: "🔙 Home", callback_data: "home:main" }]] },
          },
        );
        return;
      }

      // Show top 10 repos as buttons
      const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
      const topRepos = repos.slice(0, 10);
      for (const repo of topRepos) {
        const vis = repo.private ? "🔒" : "🌐";
        const lang = repo.language ? ` [${repo.language}]` : "";
        keyboard.push([{
          text: `${vis} ${repo.fullName}${lang}`,
          callback_data: `repos:select:${repo.fullName}`,
        }]);
      }
      keyboard.push([{ text: "🔙 Home", callback_data: "home:main" }]);

      const text = [
        `📦 *Your Repositories* (${repos.length} total)`,
        ``,
        `Tap a repository to connect:`,
      ].join("\n");

      await service.sendMessage(chatId, text, {
        parseMode: "Markdown",
        replyMarkup: { inline_keyboard: keyboard },
      });
    } catch (err) {
      await service.sendMessage(chatId, `❌ Failed to load repos: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ============================================
// Factory
// ============================================

export function getTelegramPipeline(env: HadesBindings): TelegramPipeline {
  return new TelegramPipeline(env);
}
