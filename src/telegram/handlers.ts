/**
 * Telegram Handlers - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Priority 5: Telegram UX Redesign
 *
 * Modular callback-query handlers for the new main menu, the wizard,
 * approvals, dashboards, and settings. The existing src/integrations/
 * telegram-bot.ts is UNMODIFIED — these handlers are mounted by the
 * new controller (src/telegram/controller.ts) on the same Telegram
 * webhook endpoint.
 *
 * Each handler:
 *   - Receives the parsed callback data + the originating message
 *   - Returns the next message + reply markup to send
 */

import type { HadesBindings } from "../types";
import {
  renderMainMenu,
  renderSystemStatusMenu,
  renderSettingsMenu,
  renderMemoryMenu,
  renderApprovalsMenu,
  type MenuAction,
} from "./menu";
import {
  renderHealthDashboard,
  renderCostDashboard,
  renderAgentMetricsDashboard,
  renderQueueDashboard,
  renderMemoryDashboard,
  renderModelRegistryDashboard,
} from "./dashboards";
import { TelegramWizardBridge } from "./wizard";
import { renderApprovalPrompt, renderStageProgressWithDetail } from "./progress";
import { getManagerController } from "../orchestration/manager-controller";
import { ModelRegistry } from "../registry/model-registry";

// ============================================
// Types
// ============================================

export interface HandlerContext {
  env: HadesBindings;
  userId: string; // Telegram user id (string)
  chatId: number;
  /** original callback_data string */
  callbackData: string;
  /** optional free-text payload accompanying the callback */
  text?: string;
}

export interface HandlerResult {
  text: string;
  replyMarkup?: unknown;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
}

// ============================================
// Top-level dispatcher
// ============================================

export class TelegramHandlers {
  private wizardBridge: TelegramWizardBridge;

  constructor(private env: HadesBindings) {
    this.wizardBridge = new TelegramWizardBridge(env);
  }

  async dispatch(ctx: HandlerContext): Promise<HandlerResult> {
    const { callbackData } = ctx;
    const [domain, action] = callbackData.split(":");

    switch (domain) {
      case "menu":
        return this.handleMenu(ctx, action);
      case "status":
        return this.handleStatus(ctx, action);
      case "settings":
        return this.handleSettings(ctx, action);
      case "memory":
        return this.handleMemory(ctx, action);
      case "approvals":
        return this.handleApprovals(ctx, action);
      case "wizard":
        return this.handleWizard(ctx, action);
      case "approval":
        return this.handleApprovalDecision(ctx, action);
      default:
        return { text: `Unknown callback: \`${callbackData}\`` };
    }
  }

  // ============================================
  // /menu
  // ============================================

  private async handleMenu(ctx: HandlerContext, action: string): Promise<HandlerResult> {
    if (action === "main" || action === "back") {
      const r = renderMainMenu();
      return { text: r.text, replyMarkup: r.replyMarkup, parseMode: "Markdown" };
    }
    switch (action as MenuAction) {
      case "connect_repository":
        return this.startWizard(ctx);
      case "my_repositories":
        return { text: `📦 *My Repositories*\n\n_No repositories connected yet. Use "Connect Repository" to add one._`, parseMode: "Markdown" };
      case "projects":
        return { text: `📁 *Projects*\n\n_No active projects._`, parseMode: "Markdown" };
      case "tasks":
        return { text: `⚔️ *Tasks*\n\n_No active tasks._`, parseMode: "Markdown" };
      case "approvals": {
        const r = renderApprovalsMenu(0);
        return { text: r.text, replyMarkup: r.replyMarkup, parseMode: "Markdown" };
      }
      case "memory": {
        const r = renderMemoryMenu();
        return { text: r.text, replyMarkup: r.replyMarkup, parseMode: "Markdown" };
      }
      case "settings": {
        const r = renderSettingsMenu();
        return { text: r.text, replyMarkup: r.replyMarkup, parseMode: "Markdown" };
      }
      case "system_status": {
        const r = renderSystemStatusMenu();
        return { text: r.text, replyMarkup: r.replyMarkup, parseMode: "Markdown" };
      }
      default:
        return { text: `Unknown menu action: ${action}` };
    }
  }

  // ============================================
  // /status
  // ============================================

  private async handleStatus(ctx: HandlerContext, action: string): Promise<HandlerResult> {
    switch (action) {
      case "health":
        return {
          text: renderHealthDashboard({
            managerOk: true,
            builderOk: true,
            reviewerOk: true,
            githubOk: !!this.env.GITHUB_TOKEN,
            memoryOk: !!this.env.HADES_KV,
            queueDepth: 0,
          }),
          parseMode: "Markdown",
        };
      case "cost":
        return { text: renderCostDashboard(this.env, "today"), parseMode: "Markdown" };
      case "agents":
        return { text: renderAgentMetricsDashboard(this.env), parseMode: "Markdown" };
      case "queue":
        return { text: renderQueueDashboard(this.env), parseMode: "Markdown" };
      default:
        return { text: `Unknown status action: ${action}` };
    }
  }

  // ============================================
  // /settings
  // ============================================

  private async handleSettings(ctx: HandlerContext, action: string): Promise<HandlerResult> {
    switch (action) {
      case "models":
        return { text: renderModelRegistryDashboard(this.env), parseMode: "Markdown" };
      case "github_token":
        return {
          text: [
            `🔐 *GitHub Token*`,
            ``,
            `Your GitHub token is stored as a Cloudflare Worker secret (\`GITHUB_TOKEN\`).`,
            `To update it:`,
            ``,
            `\`wrangler secret put GITHUB_TOKEN\``,
            ``,
            `Then redeploy.`,
          ].join("\n"),
          parseMode: "Markdown",
        };
      case "admin_token":
        return {
          text: [
            `🔑 *Admin Token*`,
            ``,
            `Stored as \`ADMIN_API_TOKEN\` secret. Update with:`,
            ``,
            `\`wrangler secret put ADMIN_API_TOKEN\``,
          ].join("\n"),
          parseMode: "Markdown",
        };
      case "language":
        return {
          text: [
            `🌐 *Language*`,
            ``,
            `Currently: \`English\``,
            ``,
            `_Persian / Farsi support is on the roadmap._`,
          ].join("\n"),
          parseMode: "Markdown",
        };
      default:
        return { text: `Unknown settings action: ${action}` };
    }
  }

  // ============================================
  // /memory
  // ============================================

  private async handleMemory(ctx: HandlerContext, action: string): Promise<HandlerResult> {
    const projectId = ctx.text || "default";
    switch (action) {
      case "main":
        return { text: renderMemoryDashboard(this.env, projectId), parseMode: "Markdown" };
      case "architecture":
        return { text: `🏛 *Architecture*\n\n_Architecture summary is loaded from \`.hades/architecture.md\`._`, parseMode: "Markdown" };
      case "roadmap":
        return { text: `🗺 *Roadmap*\n\n_Roadmap is loaded from \`.hades/roadmap.md\`._`, parseMode: "Markdown" };
      case "decisions":
        return { text: `📝 *Decisions*\n\n_Architecture Decision Records (ADRs) from \`.hades/decisions.md\`._`, parseMode: "Markdown" };
      case "tasks":
        return { text: `⚔️ *Tasks*\n\n_Task records from \`.hades/tasks/\`._`, parseMode: "Markdown" };
      case "reviews":
        return { text: `🛡 *Reviews*\n\n_Review verdicts from \`.hades/reviews/\`._`, parseMode: "Markdown" };
      case "failures":
        return { text: `⚠️ *Failures*\n\n_Failure records from \`.hades/failures/\`. The Manager learns from these._`, parseMode: "Markdown" };
      case "knowledge":
        return { text: `📚 *Knowledge*\n\n_Free-form notes from \`.hades/knowledge/\`._`, parseMode: "Markdown" };
      case "metrics":
        return { text: `📊 *Metrics*\n\n_Cost & patch metrics from \`.hades/metrics/\`._`, parseMode: "Markdown" };
      default:
        return { text: `Unknown memory action: ${action}` };
    }
  }

  // ============================================
  // /approvals
  // ============================================

  private async handleApprovals(ctx: HandlerContext, action: string): Promise<HandlerResult> {
    switch (action) {
      case "list":
        return { text: `📋 *Pending Approvals*\n\n_None._`, parseMode: "Markdown" };
      default:
        return { text: `Unknown approvals action: ${action}` };
    }
  }

  // ============================================
  // /wizard
  // ============================================

  private async startWizard(ctx: HandlerContext): Promise<HandlerResult> {
    const result = await this.wizardBridge.start(ctx.userId);
    return {
      text: result.message,
      replyMarkup: this.wizardReplyMarkup(result),
      parseMode: "Markdown",
    };
  }

  private async handleWizard(ctx: HandlerContext, action: string): Promise<HandlerResult> {
    if (action === "cancel") {
      this.wizardBridge.end(ctx.userId);
      const r = renderMainMenu();
      return { text: `🚫 Wizard cancelled.`, replyMarkup: r.replyMarkup, parseMode: "Markdown" };
    }
    // Otherwise treat the entire callbackData as user input
    const result = await this.wizardBridge.advance(ctx.userId, ctx.callbackData);
    return {
      text: result.message,
      replyMarkup: this.wizardReplyMarkup(result),
      parseMode: "Markdown",
    };
  }

  private wizardReplyMarkup(result: { expectedInput: string; options?: Array<{ key: string; label: string }> }): unknown {
    if (result.expectedInput !== "option" || !result.options) return undefined;
    return {
      inline_keyboard: [
        result.options.map((o) => ({ text: o.label, callback_data: `wizard:${o.key}` })),
        [{ text: "🚫 Cancel", callback_data: "wizard:cancel" }],
      ],
    };
  }

  // ============================================
  // /approval (decision on a specific PR)
  // ============================================

  private async handleApprovalDecision(ctx: HandlerContext, action: string): Promise<HandlerResult> {
    // action = "approve" or "reject"
    // In a real impl, the workflowId would be encoded in the callback data.
    const controller = getManagerController(this.env);
    // For demonstration, we use a placeholder workflowId
    const workflowId = ctx.text || "unknown";
    try {
      const result = await controller.approveAndMerge(workflowId, ctx.userId, action === "approve" ? "approve" : "reject");
      return {
        text: action === "approve"
          ? `✅ *Merged*\n\nSHA: \`${result.mergeSha ?? "—"}\``
          : `❌ *Rejected*\n\nThe Manager will replan.`,
        parseMode: "Markdown",
      };
    } catch (err) {
      return { text: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
