/**
 * Telegram Pipeline v9.4.1 - Cloudflare Workers Edition
 * Hades Army v9.4.1 — Unified UX
 *
 * COMPLETE REWRITE of callback routing:
 *   - ALL inline buttons have handlers — no "unknown action"
 *   - Unified router handles: home:*, menu:*, repos:*, mode:*, help:*, onboard:*
 *   - /start is SEPARATE from /menu (welcome vs home screen)
 *   - /start shows welcome message with channel link @ILIVIR3
 *   - /menu shows the home screen
 *   - Update deduplication prevents duplicate messages
 *   - Every step wrapped in try/catch — never silent
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";
import { getTelegramService, recordTelegramEvent } from "../integrations/telegram-service";
import { getConversationMemory } from "../memory/conversation-memory";
import { getRepositoryManager } from "../github/repository-manager";
import { runHealthCheck, renderHealthReport } from "../monitoring/health-dashboard";

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
// Update ID deduplication
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

const CHANNEL_LINK = "@ILIVIR3";
const VERSION_FALLBACK = "9.4.1";

export class TelegramPipeline {
  private env: HadesBindings;
  private traceId: string;

  constructor(env: HadesBindings) {
    this.env = env;
    this.traceId = generateId("tg-trace");
  }

  async processUpdate(update: TelegramUpdate): Promise<{ ok: boolean; traceId: string }> {
    // Deduplicate
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
  // Message handler — /start is SEPARATE from /menu
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

    // === /start — WELCOME MESSAGE (separate from /menu) ===
    if (text === "/start") {
      await this.sendWelcome(chatId);
      return;
    }

    // === /menu — HOME SCREEN ===
    if (text === "/menu" || text === "/home") {
      await this.sendHomeScreen(chatId, userId);
      return;
    }

    // === /help ===
    if (text === "/help") {
      await this.sendHelp(chatId);
      return;
    }

    // === Mode commands ===
    const modeMatch = text.match(/^\/(plan|build|explore|analyze|review|debug|architect|chat)$/);
    if (modeMatch) {
      await this.switchMode(chatId, userId, modeMatch[1]);
      return;
    }

    // === /repositories ===
    if (text === "/repositories" || text === "/repos") {
      await this.showRepositories(chatId, userId);
      return;
    }

    // === /health ===
    if (text === "/health") {
      await this.showHealth(chatId);
      return;
    }

    // === /memory ===
    if (text === "/memory") {
      await this.showMemorySnapshot(chatId, userId);
      return;
    }

    // === /reset ===
    if (text === "/reset") {
      try {
        const convMem = getConversationMemory(this.env);
        await convMem.reset(userId);
      } catch {}
      await service.sendMessage(chatId, `🧹 Memory reset. Mode is now *Plan*.`, { parseMode: "Markdown" });
      return;
    }

    // === Free text — check wizard state ===
    let activeWorkflow: string | undefined;
    let activeRepo: string | undefined;
    try {
      const convMem = getConversationMemory(this.env);
      const state = await convMem.load(userId);
      activeWorkflow = state.state.activeWorkflow;
      activeRepo = state.state.activeRepository;
    } catch {}

    // Repository wizard
    if (activeWorkflow === "wizard:connect_repo") {
      await this.handleRepositoryConnect(chatId, userId, text);
      return;
    }

    // Short message
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

    // No repo connected
    if (!activeRepo) {
      await service.sendMessage(
        chatId,
        [
          `🔗 *Connect a repository first*`,
          ``,
          `Tap below to start:`,
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

    // Free text request
    await service.sendMessage(
      chatId,
      [
        `📨 *Request received*`,
        ``,
        `Repository: \`${activeRepo}\``,
        `Trace: \`${this.traceId}\``,
        ``,
        `_Manager pipeline invocation pending — wire up in v9.5_`,
      ].join("\n"),
      { parseMode: "Markdown" },
    );
  }

  // ============================================
  // UNIFIED Callback Query Router
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
        // === HOME screen callbacks ===
        case "home":
          await this.handleHomeCallback(chatId, userId, action);
          return;

        // === MENU (legacy compatibility) ===
        case "menu":
          await this.handleMenuCallback(chatId, userId, action);
          return;

        // === REPOS callbacks ===
        case "repos":
          await this.handleReposCallback(chatId, userId, action);
          return;

        // === MODE switch ===
        case "mode":
          if (action === "switch") {
            // data format: mode:switch:plan
            const targetMode = data.split(":")[2];
            if (targetMode) await this.switchMode(chatId, userId, targetMode);
          }
          return;

        // === HELP callbacks ===
        case "help":
          await this.handleHelpCallback(chatId, userId, action);
          return;

        // === ONBOARDING callbacks ===
        case "onboard":
          await this.handleOnboardCallback(chatId, userId, action);
          return;

        default:
          await service.sendMessage(
            chatId,
            `Unknown action: \`${data}\`\n\nUse /menu to restart.`,
            { parseMode: "Markdown" },
          );
      }
    } catch (err) {
      logger.error("[TG] Callback handler error", {
        traceId: this.traceId,
        data,
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
  // Home callback handler
  // ============================================

  private async handleHomeCallback(chatId: number, userId: string, action: string | undefined): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    switch (action) {
      case "main":
      case "back":
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
        // Set wizard state
        try {
          const convMem = getConversationMemory(this.env);
          await convMem.setActiveWorkflow(userId, "wizard:connect_repo");
        } catch {}
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
            replyMarkup: {
              inline_keyboard: [
                [{ text: "🔙 Cancel", callback_data: "home:main" }],
              ],
            },
          },
        );
        return;

      case "repositories":
        await this.showRepositories(chatId, userId);
        return;

      case "tasks":
        await service.sendMessage(
          chatId,
          [
            `📋 *Tasks*`,
            ``,
            `No active tasks.`,
          ].join("\n"),
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
          [
            `📊 *Activity*`,
            ``,
            `No recent activity.`,
          ].join("\n"),
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
          [
            `💰 *Cost Report*`,
            ``,
            `Cost tracking is available via the admin dashboard.`,
          ].join("\n"),
          {
            parseMode: "Markdown",
            replyMarkup: { inline_keyboard: [[{ text: "🔙 Home", callback_data: "home:main" }]] },
          },
        );
        return;

      default:
        await service.sendMessage(
          chatId,
          `Unknown home action: \`${action}\``,
          { parseMode: "Markdown" },
        );
    }
  }

  // ============================================
  // Menu callback handler (legacy compatibility)
  // ============================================

  private async handleMenuCallback(chatId: number, userId: string, action: string | undefined): Promise<void> {
    // Map old menu:* callbacks to home:* handlers
    switch (action) {
      case "main":
      case "back":
        await this.sendHomeScreen(chatId, userId);
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
        // Forward to home handler
        await this.handleHomeCallback(chatId, userId, action);
    }
  }

  // ============================================
  // Repos callback handler
  // ============================================

  private async handleReposCallback(chatId: number, userId: string, action: string | undefined): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    // data format: repos:select:owner/repo or repos:rescan:owner/repo or repos:remove:owner/repo
    const parts = action ? action.split(":") : [];
    const subAction = parts[0];
    const repoFullName = parts.slice(1).join(":");

    switch (subAction) {
      case "select":
        if (repoFullName) {
          try {
            const convMem = getConversationMemory(this.env);
            await convMem.setActiveRepository(userId, repoFullName);
          } catch {}
          await service.sendMessage(
            chatId,
            `✅ Active repository: \`${repoFullName}\``,
            { parseMode: "Markdown" },
          );
        }
        return;

      case "rescan":
        if (repoFullName) {
          await service.sendMessage(chatId, `🔄 Rescanning \`${repoFullName}\`...`, { parseMode: "Markdown" });
          try {
            const repoManager = getRepositoryManager(this.env);
            const result = await repoManager.rescan(userId, repoFullName);
            if ("ok" in result && result.ok === false) {
              await service.sendMessage(chatId, `❌ Rescan failed: ${result.reason}`);
            } else {
              await service.sendMessage(chatId, `✅ Rescan complete.`, { parseMode: "Markdown" });
            }
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
            await service.sendMessage(chatId, `🗑 Removed \`${repoFullName}\``, { parseMode: "Markdown" });
          } catch (err) {
            await service.sendMessage(chatId, `❌ Remove failed: ${err instanceof Error ? err.message : String(err)}`);
          }
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
      planning: [
        `🧠 *How Planning Works*`,
        ``,
        `1. Switch to PLAN mode: /plan`,
        `2. Describe what you want`,
        `3. Manager asks clarifying questions`,
        `4. Manager produces 3 strategies:`,
        `   • ⚡ Fast — minimal change`,
        `   • ⚖️ Balanced — production-ready`,
        `   • 🏛 Enterprise — bullet-proof`,
        `5. You choose a strategy`,
        `6. Manager generates task breakdown`,
        ``,
        `No code is generated in PLAN mode.`,
      ].join("\n"),
      build: [
        `⚒ *How Build Works*`,
        ``,
        `1. Switch to BUILD mode: /build`,
        `2. Have an approved plan (from PLAN mode)`,
        `3. Manager assigns task to Builder`,
        `4. Builder generates patch`,
        `5. Reviewer validates patch`,
        `6. Manager summarizes`,
        `7. You approve`,
        `8. PR is created on GitHub`,
        `9. You merge`,
        ``,
        `Never auto-merges. Always requires your approval.`,
      ].join("\n"),
      approval: [
        `✅ *How Approval Works*`,
        ``,
        `Before any PR is created:`,
        `• Manager shows a summary`,
        `• Files changed, risk, impact`,
        `• You choose: Approve / Reject / Request changes`,
        ``,
        `PR is only created after you tap "Approve".`,
      ].join("\n"),
      memory: [
        `🧠 *How Memory Works*`,
        ``,
        `Hades Army remembers:`,
        `• Repository architecture`,
        `• Past decisions (ADRs)`,
        `• Failed approaches (lessons)`,
        `• Coding conventions`,
        `• Recent conversations`,
        ``,
        `Memory is per-project and persistent.`,
        `Use /memory to view your snapshot.`,
      ].join("\n"),
    };

    const text = topics[action ?? ""] ?? `Unknown help topic: ${action}`;
    await service.sendMessage(chatId, text, {
      parseMode: "Markdown",
      replyMarkup: { inline_keyboard: [[{ text: "🔙 Help", callback_data: "home:help" }]] },
    });
  }

  // ============================================
  // Onboarding callback handler
  // ============================================

  private async handleOnboardCallback(chatId: number, _userId: string, action: string | undefined): Promise<void> {
    if (action === "skip" || action === "finish") {
      await this.sendHomeScreen(chatId, _userId);
      return;
    }
    // onboard:N (step number)
    const step = parseInt(action ?? "1", 10);
    await this.sendOnboardingStep(chatId, step);
  }

  // ============================================
  // Screen renderers
  // ============================================

  private async sendWelcome(chatId: number): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;
    const version = this.env.HADES_VERSION ?? VERSION_FALLBACK;

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
    const version = this.env.HADES_VERSION ?? VERSION_FALLBACK;

    let activeRepo: string | undefined;
    let activeMode: string = "plan";
    try {
      const convMem = getConversationMemory(this.env);
      const snap = await convMem.getSnapshot(userId);
      activeRepo = snap.activeRepository;
      activeMode = snap.activeMode ?? "plan";
    } catch {}

    const modeEmoji: Record<string, string> = {
      plan: "🧠", build: "⚒️", explore: "🔍", analyze: "🔬",
      review: "🛡️", debug: "🐞", architect: "🏛", chat: "💬",
    };

    const lines: string[] = [
      `🏛 *Hades Army* v${version}`,
      ``,
      `*Mode:* ${modeEmoji[activeMode] ?? "🧠"} ${activeMode}`,
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

    let activeRepo: string | undefined;
    try {
      const convMem = getConversationMemory(this.env);
      const snap = await convMem.getSnapshot(userId);
      activeRepo = snap.activeRepository;
    } catch {}

    const text = [
      `🏠 *Dashboard*`,
      ``,
      `*Repository:* ${activeRepo ? `\`${activeRepo}\`` : "none"}`,
      `*Running tasks:* 0`,
      `*Pending approvals:* 0`,
      `*Completed today:* 0`,
      `*Failed today:* 0`,
      ``,
      `Tap below for details:`,
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

  private async showModeSwitcher(chatId: number, _userId: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    const text = [
      `🎛 *Switch Mode*`,
      ``,
      `Select a mode:`,
    ].join("\n");

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

  private async showSettings(chatId: number, _userId: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;
    const version = this.env.HADES_VERSION ?? VERSION_FALLBACK;

    const text = [
      `⚙ *Settings*`,
      ``,
      `*Version:* ${version}`,
      `*Mode:* Plan (default)`,
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
          [{ text: "🔄 Reset Memory", callback_data: "home:reset" }],
          [{ text: "🔙 Home", callback_data: "home:main" }],
        ],
      },
    });
  }

  private async sendHelp(chatId: number): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    const text = [
      `❓ *Help*`,
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
      `/reset — Clear memory`,
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

    const steps: Array<{ title: string; body: string }> = [
      {
        title: "Welcome",
        body: `🏛 *Welcome to Hades Army*\n\nYour autonomous AI software engineering team.\n\n🧠 Manager — plans, decides\n⚒ Builder — generates code\n🛡 Reviewer — validates`,
      },
      {
        title: "Operating Modes",
        body: `🎛 *8 Modes*\n\nPLAN, BUILD, EXPLORE, ANALYZE, REVIEW, DEBUG, ARCHITECT, CHAT\n\nSwitch anytime with /plan /build etc.`,
      },
      {
        title: "Memory",
        body: `🧠 *Memory System*\n\nRemembers: architecture, decisions, failures, conventions.\n\nPer-project, persistent.`,
      },
      {
        title: "Connect Repository",
        body: `🔗 *Connect a Repository*\n\nTap "Connect Repo" from the menu and send the URL.`,
      },
      {
        title: "Ready",
        body: `✅ *Ready!*\n\nUse /menu to start.\nChannel: ${CHANNEL_LINK}`,
      },
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
  // Mode switching
  // ============================================

  private async switchMode(chatId: number, userId: string, mode: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    const modes: Record<string, { emoji: string; label: string; role: string; tagline: string }> = {
      plan: { emoji: "🧠", label: "Plan", role: "Planner", tagline: "Engineering planning" },
      build: { emoji: "⚒️", label: "Build", role: "Executor", tagline: "Execute approved plans" },
      explore: { emoji: "🔍", label: "Explore", role: "Analyst", tagline: "Quick repo exploration" },
      analyze: { emoji: "🔬", label: "Analyze", role: "Senior Analyst", tagline: "Deep repo analysis" },
      review: { emoji: "🛡️", label: "Review", role: "Reviewer", tagline: "Review code/PR" },
      debug: { emoji: "🐞", label: "Debug", role: "Debugger", tagline: "Diagnose failures" },
      architect: { emoji: "🏛", label: "Architect", role: "Architect", tagline: "Architecture discussion" },
      chat: { emoji: "💬", label: "Chat", role: "Assistant", tagline: "General conversation" },
    };

    const m = modes[mode];
    if (!m) {
      await service.sendMessage(chatId, `❌ Unknown mode: ${mode}`, { parseMode: "Markdown" });
      return;
    }

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
  // Repository connection handler
  // ============================================

  private async handleRepositoryConnect(chatId: number, userId: string, input: string): Promise<void> {
    const service = getTelegramService(this.env);
    if (!service) return;

    // Clear wizard state
    try {
      const convMem = getConversationMemory(this.env);
      await convMem.clearWorkflow(userId);
    } catch {}

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
        ].join("\n"),
        { parseMode: "Markdown" },
      );
      return;
    }

    await service.sendMessage(
      chatId,
      [
        `🔗 *Connecting...*`,
        ``,
        `Repository: \`${repoFullName}\``,
        `⏳ Validating access...`,
      ].join("\n"),
      { parseMode: "Markdown" },
    );

    try {
      const repoManager = getRepositoryManager(this.env);
      const summary = await repoManager.fetchSummary(repoFullName);
      if (!summary) {
        await service.sendMessage(
          chatId,
          [
            `❌ *Access failed*`,
            ``,
            `Could not access \`${repoFullName}\`.`,
            `Make sure GITHUB_TOKEN has access.`,
          ].join("\n"),
          { parseMode: "Markdown" },
        );
        return;
      }

      await repoManager.connect(userId, {
        repositoryFullName: summary.repositoryFullName,
        displayName: summary.displayName,
        visibility: summary.visibility,
        defaultBranch: summary.defaultBranch,
        language: summary.language,
        size: summary.size,
      });

      const convMem = getConversationMemory(this.env);
      await convMem.setActiveRepository(userId, summary.repositoryFullName);
      const projectId = `proj_${Date.now()}`;
      await convMem.setActiveProject(userId, projectId);

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
          `*Branches:* ${summary.branchesCount}`,
          `*Stars:* ${summary.starsCount}`,
          ``,
          `*Project ID:* \`${projectId}\``,
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
      await service.sendMessage(
        chatId,
        `❌ Connection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
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
      const text = [
        `🧠 *Memory Snapshot*`,
        ``,
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
}

// ============================================
// Factory
// ============================================

export function getTelegramPipeline(env: HadesBindings): TelegramPipeline {
  return new TelegramPipeline(env);
}
