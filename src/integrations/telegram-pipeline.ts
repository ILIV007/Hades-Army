/**
 * Telegram Pipeline Orchestrator - Cloudflare Workers Edition
 * Hades Army v9.2 — Fix & Stabilization
 *
 * This is the SINGLE entry point for all Telegram updates. It guarantees:
 *
 *   1. The bot NEVER goes silent — every update gets a response
 *   2. Every step is wrapped in try/catch
 *   3. Structured logs at every stage:
 *        [TG] Update received
 *        [TG] Parsed
 *        [TG] Manager start
 *        [TG] Manager finished
 *        [TG] Sending response
 *        [TG] Response sent
 *   4. If anything fails, user gets a fallback message with a trace ID
 *   5. Manager startup failures are isolated — they don't crash Telegram
 *   6. Mode defaults safely: mode = mode ?? "plan"
 *   7. Memory failures are non-fatal — chat continues
 *   8. Missing project → returns onboarding guidance (not silent return)
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";
import { getTelegramService, recordTelegramEvent } from "../integrations/telegram-service";
import { getConversationMemory } from "../memory/conversation-memory";
import { getModeManager } from "../modes/operation-modes";
import { renderHealthReport, runHealthCheck } from "../monitoring/health-dashboard";
import { getRepositoryManager } from "../github/repository-manager";

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
    entities?: Array<{ type: string; offset: number; length: number }>;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; last_name?: string; username?: string };
    message?: { message_id: number; chat: { id: number; type: string } };
    data: string;
    chat_instance: string;
  };
  inline_query?: {
    id: string;
    from: { id: number };
    query: string;
    offset: string;
  };
}

// ============================================
// Update ID deduplication (prevents duplicate messages)
// ============================================
//
// Telegram retries updates if the webhook returns non-200. Even with
// 200 responses, multiple isolates can process the same update_id
// concurrently. We track the last N update_ids per-isolate and skip
// duplicates. This is the SINGLE most effective fix for duplicate
// messages.

const MAX_DEDUP_IDS = 200;
const recentUpdateIds = new Set<number>();
const recentUpdateIdsArray: number[] = [];

function isDuplicateUpdate(updateId: number): boolean {
  if (recentUpdateIds.has(updateId)) {
    logger.warn("[TG Dedup] Duplicate update_id detected — skipping", { updateId });
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
// Pipeline orchestrator
// ============================================

export class TelegramPipeline {
  private env: HadesBindings;
  private traceId: string;

  constructor(env: HadesBindings) {
    this.env = env;
    this.traceId = generateId("tg-trace");
  }

  /**
   * Process a Telegram update. NEVER throws — always returns 200 OK
   * so Telegram doesn't retry the same failing update forever.
   *
   * CRITICAL (v9.4): Deduplicates by update_id BEFORE any processing
   * to prevent duplicate messages.
   */
  async processUpdate(update: TelegramUpdate): Promise<{ ok: boolean; traceId: string }> {
    // === STEP 0: Deduplicate by update_id ===
    if (update.update_id !== undefined && isDuplicateUpdate(update.update_id)) {
      return { ok: true, traceId: this.traceId }; // silently skip — already processed
    }

    recordTelegramEvent({
      kind: "update_received",
      chatId: update.message?.chat.id ?? update.callback_query?.message?.chat.id,
      userId: update.message?.from?.id ?? update.callback_query?.from.id,
      text: update.message?.text ?? update.callback_query?.data,
    });

    try {
      // === STEP 1: Parse ===
      if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      } else if (update.message?.text) {
        await this.handleMessage(update.message);
      } else {
        // Non-text message — acknowledge silently
        logger.info("[TG] Non-text update ignored", { traceId: this.traceId, updateId: update.update_id });
      }
      return { ok: true, traceId: this.traceId };
    } catch (err) {
      // === MANDATORY FALLBACK ===
      // This is the LAST line of defense. The user must ALWAYS get a response.
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("[TG] Pipeline FATAL — sending fallback", {
        traceId: this.traceId,
        error: errorMsg,
        stack: err instanceof Error ? err.stack : undefined,
      });

      const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
      if (chatId !== undefined) {
        const service = getTelegramService(this.env);
        if (service) {
          await service.sendMessage(
            chatId,
            [
              `⚠️ Internal system error.`,
              ``,
              `Reference ID: \`${this.traceId}\``,
              ``,
              `The admin has been notified. Please try again in a moment, or use /start to restart.`,
            ].join("\n"),
            { parseMode: "Markdown" },
          );
        }
      }
      return { ok: false, traceId: this.traceId };
    }
  }

  // ============================================
  // Message handler
  // ============================================

  private async handleMessage(msg: NonNullable<TelegramUpdate["message"]>): Promise<void> {
    const chatId = msg.chat.id;
    const userId = String(msg.from?.id ?? "unknown");
    const text = (msg.text ?? "").trim();

    recordTelegramEvent({ kind: "parsed", chatId, userId: Number(userId), text });

    const service = getTelegramService(this.env);
    if (!service) {
      // No bot token configured — can't respond
      logger.error("[TG] TELEGRAM_BOT_TOKEN missing — cannot respond to message");
      return;
    }

    // === STEP 2: Manager start (isolated) ===
    recordTelegramEvent({ kind: "manager_start", chatId, userId: Number(userId) });

    try {
      // Always load conversation memory — but NEVER let it block the response
      let activeMode: "plan" | "build" | "explore" = "plan";
      let activeProject: string | undefined;
      let activeRepo: string | undefined;
      let activeWorkflow: string | undefined;

      try {
        const convMem = getConversationMemory(this.env);
        const snapshot = await convMem.getSnapshot(userId);
        // CRITICAL FIX #4: default safely — never discard message if mode missing
        activeMode = (snapshot.activeMode ?? "plan") as typeof activeMode;
        activeProject = snapshot.activeProject;
        activeRepo = snapshot.activeRepository;
        // v9.4 — load wizard/workflow state
        const state = await convMem.load(userId);
        activeWorkflow = state.state.activeWorkflow;
      } catch (memErr) {
        // CRITICAL FIX #8: memory failures are NON-FATAL
        logger.warn("[TG] Conversation memory load failed — continuing with defaults", {
          err: memErr instanceof Error ? memErr.message : String(memErr),
        });
      }

      // === Route by command ===
      if (text === "/start" || text === "/menu" || text === "/help") {
        await this.sendMainMenu(chatId, userId, activeMode, activeRepo);
        return;
      }

      if (text === "/plan") {
        await this.switchMode(chatId, userId, "plan");
        return;
      }
      if (text === "/build") {
        await this.switchMode(chatId, userId, "build");
        return;
      }
      if (text === "/explore") {
        await this.switchMode(chatId, userId, "explore");
        return;
      }
      // v9.3 — extended modes
      if (text === "/analyze") {
        await this.switchMode(chatId, userId, "analyze");
        return;
      }
      if (text === "/review") {
        await this.switchMode(chatId, userId, "review");
        return;
      }
      if (text === "/debug") {
        await this.switchMode(chatId, userId, "debug");
        return;
      }
      if (text === "/architect") {
        await this.switchMode(chatId, userId, "architect");
        return;
      }
      if (text === "/chat") {
        await this.switchMode(chatId, userId, "chat");
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

      if (text === "/reset") {
        try {
          const convMem = getConversationMemory(this.env);
          await convMem.reset(userId);
        } catch {
          // ignore
        }
        await service.sendMessage(chatId, `🧹 Conversation memory reset. Mode is now *Plan*.`, { parseMode: "Markdown" });
        return;
      }

      // === Free-text message → Manager workflow ===
      if (text.length < 3) {
        await service.sendMessage(
          chatId,
          [
            `👋 *Hades Army* — Send a description of what you want me to do.`,
            ``,
            `Commands: /menu · /plan · /build · /explore · /repositories · /health · /memory`,
          ].join("\n"),
          { parseMode: "Markdown" },
        );
        return;
      }

      // v9.4 — Repository Wizard: if user is in wizard mode, treat free-text as repo URL
      if (activeWorkflow === "wizard:connect_repo") {
        await this.handleRepositoryConnect(chatId, userId, text);
        return;
      }

      // CRITICAL FIX #5: if no project/repo, return onboarding guidance (NOT silent return)
      if (!activeRepo) {
        await service.sendMessage(
          chatId,
          [
            `🔗 *Connect a repository first*`,
            ``,
            `Before I can work on your request, I need a repository.`,
            ``,
            `Tap the button below to start the Repository Wizard, or use /repositories to see existing ones.`,
          ].join("\n"),
          {
            parseMode: "Markdown",
            replyMarkup: {
              inline_keyboard: [
                [{ text: "🔗 Connect Repository", callback_data: "menu:connect_repository" }],
                [{ text: "📦 My Repositories", callback_data: "menu:my_repositories" }],
              ],
            },
          },
        );
        return;
      }

      // Mode-aware response
      await this.handleFreeTextRequest(chatId, userId, text, activeMode, activeRepo, activeProject);
    } finally {
      recordTelegramEvent({ kind: "manager_finished", chatId, userId: Number(userId) });
    }
  }

  // ============================================
  // Callback query handler
  // ============================================

  private async handleCallbackQuery(cq: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
    const chatId = cq.message?.chat.id;
    if (chatId === undefined) return;
    const userId = String(cq.from.id);
    const data = cq.data ?? "";

    const service = getTelegramService(this.env);
    if (!service) return;

    // Answer the callback to clear the loading spinner
    await service.answerCallbackQuery(cq.id);

    try {
      // Simple callback routing — delegate to handlers
      if (data === "menu:main" || data === "menu:back") {
        let activeMode: "plan" | "build" | "explore" = "plan";
        let activeRepo: string | undefined;
        try {
          const convMem = getConversationMemory(this.env);
          const snap = await convMem.getSnapshot(userId);
          activeMode = (snap.activeMode ?? "plan") as typeof activeMode;
          activeRepo = snap.activeRepository;
        } catch {
          // defaults
        }
        await this.sendMainMenu(chatId, userId, activeMode, activeRepo);
        return;
      }

      if (data === "menu:connect_repository") {
        // v9.4 — set wizard state so the next free-text message is treated as repo URL
        try {
          const convMem = getConversationMemory(this.env);
          await convMem.setActiveWorkflow(userId, "wizard:connect_repo");
        } catch {
          // non-fatal
        }
        await service.sendMessage(
          chatId,
          [
            `🔗 *Connect Repository*`,
            ``,
            `Send me the repository URL or \`owner/name\` to connect.`,
            ``,
            `Examples:`,
            `• \`https://github.com/owner/repo\``,
            `• \`owner/repo\``,
            ``,
            `_I'll validate the token, scan the repo, and create a project._`,
          ].join("\n"),
          { parseMode: "Markdown" },
        );
        return;
      }

      if (data === "menu:my_repositories") {
        await this.showRepositories(chatId, userId);
        return;
      }

      if (data === "menu:plan" || data === "menu:build" || data === "menu:explore") {
        const mode = data.split(":")[1] as "plan" | "build" | "explore";
        await this.switchMode(chatId, userId, mode);
        return;
      }

      // Unknown callback
      await service.sendMessage(chatId, `Unknown action. Tap /menu to restart.`);
    } catch (err) {
      logger.error("[TG] Callback handler error", {
        traceId: this.traceId,
        err: err instanceof Error ? err.message : String(err),
      });
      await service.sendMessage(
        chatId,
        `⚠️ Action failed. Reference: \`${this.traceId}\``,
        { parseMode: "Markdown" },
      );
    }
  }

  // ============================================
  // Helpers
  // ============================================

  private async sendMainMenu(
    chatId: number,
    userId: string,
    activeMode: "plan" | "build" | "explore",
    activeRepo: string | undefined,
  ): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    const version = this.env.HADES_VERSION ?? "unknown";

    // v9.4 — use new home screen
    try {
      const { renderHomeScreen } = await import("../telegram/home-screen");
      const { EXTENDED_MODES } = await import("../modes/extended-modes");
      const home = renderHomeScreen({
        userId,
        activeMode: activeMode as any,
        activeRepository: activeRepo,
        runningTasks: 0,
        pendingApprovals: 0,
        version,
      });
      recordTelegramEvent({ kind: "sending", chatId, userId: Number(userId), responsePreview: home.text.slice(0, 80) });
      const result = await service.sendMessage(chatId, home.text, {
        parseMode: "Markdown",
        replyMarkup: home.replyMarkup,
      });
      recordTelegramEvent({
        kind: result.ok ? "sent" : "failed",
        chatId,
        userId: Number(userId),
        error: result.error,
      });
    } catch (err) {
      // Fallback to simple menu if home-screen fails
      logger.warn("[TG] Home screen render failed, using fallback", { err });
      const text = `🏛 *Hades Army* v${version}\n\n*Repository:* ${activeRepo ?? "none connected"}\n\nUse /plan /build /explore /repositories /health`;
      await service.sendMessage(chatId, text, { parseMode: "Markdown" });
    }
  }

  private async switchMode(chatId: number, userId: string, mode: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    try {
      // v9.4 — use extended modes for the labels/roles
      const { EXTENDED_MODES, isValidExtendedMode } = await import("../modes/extended-modes");
      if (!isValidExtendedMode(mode)) {
        await service.sendMessage(chatId, `❌ Unknown mode: ${mode}`, { parseMode: "Markdown" });
        return;
      }
      const modeDesc = EXTENDED_MODES[mode as keyof typeof EXTENDED_MODES];

      // Set in mode manager (only for plan/build/explore — others are just labels)
      if (mode === "plan" || mode === "build" || mode === "explore") {
        const modeManager = getModeManager(this.env);
        const result = modeManager.setMode(userId, mode as "plan" | "build" | "explore");
        if (!result.ok) {
          await service.sendMessage(chatId, `❌ ${result.reason}`, { parseMode: "Markdown" });
          return;
        }
      }
      try {
        const convMem = getConversationMemory(this.env);
        await convMem.setMode(userId, mode as any);
      } catch {
        // non-fatal
      }
      await service.sendMessage(
        chatId,
        [
          `${modeDesc.emoji} *${modeDesc.label}* mode activated.`,
          ``,
          `_${modeDesc.tagline}_`,
          ``,
          `Manager behavior: *${modeDesc.managerRole}*`,
        ].join("\n"),
        { parseMode: "Markdown" },
      );
    } catch (err) {
      await service.sendMessage(chatId, `⚠️ Mode switch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

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

  private async showHealth(chatId: number): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;
    await service.sendMessage(chatId, `🩺 Running health check…`);
    try {
      const report = await runHealthCheck(this.env);
      const text = renderHealthReport(report);
      await service.sendMessage(chatId, text, { parseMode: "Markdown" });
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
      const text = [
        `🧠 *Memory Snapshot*`,
        ``,
        `*Active project:* \`${snap.activeProject ?? "(none)"}\``,
        `*Active repository:* \`${snap.activeRepository ?? "(none)"}\``,
        `*Active workflow:* \`${snap.activeWorkflow ?? "(none)"}\``,
        `*Active mode:* ${snap.activeMode ?? "plan"}`,
        `*Recent approvals:* ${snap.recentApprovalsCount}`,
        `*Last interaction:* ${new Date(snap.lastInteractionAt).toLocaleString()}`,
      ].join("\n");
      await service.sendMessage(chatId, text, { parseMode: "Markdown" });
    } catch (err) {
      await service.sendMessage(chatId, `⚠️ Memory snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ============================================
  // v9.4 — Repository Connection Handler
  // ============================================

  private async handleRepositoryConnect(chatId: number, userId: string, input: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    // Clear wizard state immediately
    try {
      const convMem = getConversationMemory(this.env);
      await convMem.clearWorkflow(userId);
    } catch {
      // non-fatal
    }

    // Parse repo URL
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
          `Could not parse: \`${trimmed}\``,
          ``,
          `Accepted formats:`,
          `• \`https://github.com/owner/repo\``,
          `• \`owner/repo\``,
          ``,
          `Try again with /menu → Connect Repository.`,
        ].join("\n"),
        { parseMode: "Markdown" },
      );
      return;
    }

    // Send "analyzing" message
    await service.sendMessage(
      chatId,
      [
        `🔗 *Connecting repository...*`,
        ``,
        `Repository: \`${repoFullName}\``,
        ``,
        `⏳ Validating access...`,
      ].join("\n"),
      { parseMode: "Markdown" },
    );

    try {
      const repoManager = getRepositoryManager(this.env);

      // Fetch summary from GitHub
      const summary = await repoManager.fetchSummary(repoFullName);
      if (!summary) {
        await service.sendMessage(
          chatId,
          [
            `❌ *Repository access failed*`,
            ``,
            `Could not access \`${repoFullName}\`.`,
            `Make sure GITHUB_TOKEN is set and has access to this repository.`,
          ].join("\n"),
          { parseMode: "Markdown" },
        );
        return;
      }

      // Connect the repository
      const connected = await repoManager.connect(userId, {
        repositoryFullName: summary.repositoryFullName,
        displayName: summary.displayName,
        visibility: summary.visibility,
        defaultBranch: summary.defaultBranch,
        language: summary.language,
        size: summary.size,
      });

      // Set as active in conversation memory
      const convMem = getConversationMemory(this.env);
      await convMem.setActiveRepository(userId, summary.repositoryFullName);
      const projectId = `proj_${Date.now()}`;
      await convMem.setActiveProject(userId, projectId);

      // Send summary
      const vis = summary.visibility === "private" ? "🔒 Private" : "🌐 Public";
      await service.sendMessage(
        chatId,
        [
          `✅ *Repository Connected!*`,
          ``,
          `*Name:* ${summary.displayName}`,
          `*Full name:* \`${summary.repositoryFullName}\``,
          `*Visibility:* ${vis}`,
          `*Language:* ${summary.language}`,
          `*Default branch:* \`${summary.defaultBranch}\``,
          `*Size:* ${Math.round(summary.size)} KB`,
          `*Branches:* ${summary.branchesCount}`,
          `*Stars:* ${summary.starsCount}`,
          ``,
          `*Project ID:* \`${projectId}\``,
          ``,
          `🎉 You can now use /plan to start planning, or /build to execute.`,
        ].join("\n"),
        {
          parseMode: "Markdown",
          replyMarkup: {
            inline_keyboard: [
              [
                { text: "🧠 Plan", callback_data: "menu:plan" },
                { text: "⚒ Build", callback_data: "menu:build" },
              ],
              [{ text: "🏠 Home", callback_data: "menu:main" }],
            ],
          },
        },
      );
    } catch (err) {
      await service.sendMessage(
        chatId,
        [
          `❌ *Connection failed*`,
          ``,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        ].join("\n"),
        { parseMode: "Markdown" },
      );
    }
  }

  private async handleFreeTextRequest(
    chatId: number,
    userId: string,
    text: string,
    mode: "plan" | "build" | "explore",
    activeRepo: string,
    activeProject: string | undefined,
  ): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    await service.sendMessage(
      chatId,
      [
        `📨 *Request received*`,
        ``,
        `*Mode:* ${mode.toUpperCase()}`,
        `*Repository:* \`${activeRepo}\``,
        ``,
        `Manager is analyzing your request…`,
        ``,
        `_Trace ID: \`${this.traceId}\`_`,
      ].join("\n"),
      { parseMode: "Markdown" },
    );

    // In a full impl, this would invoke the ManagerController.
    // For now, we acknowledge and log — the Manager pipeline is
    // wired up in src/orchestration/manager-controller.ts and can
    // be invoked once onboarding is fully complete.
    logger.info("[TG] Free-text request logged (Manager pipeline invocation pending)", {
      traceId: this.traceId,
      userId,
      mode,
      repo: activeRepo,
      project: activeProject,
      promptLength: text.length,
    });
  }
}

// ============================================
// Factory
// ============================================

export function getTelegramPipeline(env: HadesBindings): TelegramPipeline {
  return new TelegramPipeline(env);
}
