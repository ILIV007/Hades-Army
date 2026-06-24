/**
 * Telegram Controller - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Priority 5: Telegram UX Redesign
 *
 * The controller ties the new Telegram UX (menu, wizard, dashboards,
 * handlers) together. It is the entry point that the existing
 * src/integrations/telegram-bot.ts would call for v0.8.5 routes —
 * without modifying the existing bot file.
 *
 * Mounting strategy (do NOT modify telegram-bot.ts):
 *   - The existing bot handles slash commands and old callback queries.
 *   - This controller is invoked by a new webhook route mounted in
 *     src/index.ts (via src/telegram/router.ts) for the v0.8.5 paths.
 *   - Both can coexist: the existing bot keeps running, and v0.8.5
 *     features are progressively enabled.
 */

import { logger } from "../utils/logger";
import type { HadesBindings } from "../types";
import { TelegramHandlers, type HandlerContext, type HandlerResult } from "./handlers";
import { renderMainMenu } from "./menu";
import { getManagerController } from "../orchestration/manager-controller";
import { renderWorkflowStarted, renderStageProgress } from "./progress";

// ============================================
// Types
// ============================================

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; username?: string };
    message?: { message_id: number; chat: { id: number } };
    data: string;
  };
}

// ============================================
// Controller
// ============================================

export class TelegramController {
  private env: HadesBindings;
  private handlers: TelegramHandlers;

  constructor(env: HadesBindings) {
    this.env = env;
    this.handlers = new TelegramHandlers(env);
  }

  // ============================================
  // Webhook entry
  // ============================================

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
    } else if (update.message?.text) {
      await this.handleMessage(update.message);
    }
  }

  // ============================================
  // Message handler
  // ============================================

  private async handleMessage(msg: NonNullable<TelegramUpdate["message"]>): Promise<void> {
    const text = msg.text?.trim() ?? "";
    const chatId = msg.chat.id;
    const userId = String(msg.from?.id ?? "unknown");

    if (text === "/start" || text === "/menu") {
      const r = renderMainMenu();
      await this.send(chatId, r.text, r.replyMarkup);
      return;
    }

    // Free-text → treat as a Hades request to the Manager
    if (text.startsWith("/")) {
      // Unknown command — show menu
      const r = renderMainMenu();
      await this.send(chatId, `Unknown command. Showing main menu:`, r.replyMarkup);
      return;
    }

    if (text.length < 3) {
      await this.send(chatId, `Send a description of what you want Hades Army to do, or tap /menu.`);
      return;
    }

    await this.startWorkflowFromText(chatId, userId, text);
  }

  // ============================================
  // Callback query handler
  // ============================================

  private async handleCallbackQuery(cq: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
    const chatId = cq.message?.chat.id;
    if (!chatId) return;
    const userId = String(cq.from.id);

    const ctx: HandlerContext = {
      env: this.env,
      userId,
      chatId,
      callbackData: cq.data,
    };

    try {
      const result: HandlerResult = await this.handlers.dispatch(ctx);
      await this.send(chatId, result.text, result.replyMarkup, result.parseMode);
      // Acknowledge the callback query to clear the loading indicator
      await this.answerCallbackQuery(cq.id);
    } catch (err) {
      logger.error(`Telegram callback failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.send(chatId, `❌ Something went wrong. Tap /menu to restart.`);
      await this.answerCallbackQuery(cq.id);
    }
  }

  // ============================================
  // Workflow starter
  // ============================================

  private async startWorkflowFromText(chatId: number, userId: string, prompt: string): Promise<void> {
    const controller = getManagerController(this.env);

    await this.send(chatId, renderWorkflowStarted("(queued)", prompt));

    try {
      const result = await controller.executeRequest({
        requestId: `tg_${Date.now()}`,
        userId,
        projectId: "default", // would be looked up from user's connected repo
        repositoryFullName: "owner/repo", // placeholder
        prompt,
      });

      if (result.status === "awaiting_approval" && result.prUrl) {
        await this.send(chatId, `${renderStageProgress("GITHUB_PR")}\n\nPR: ${result.prUrl}\n\n_Reply with /approve or /reject once you've reviewed it._`);
      } else if (result.status === "aborted") {
        await this.send(chatId, `${renderStageProgress("ABORTED")}\n\nReason: \`${result.abortReason}\``);
      } else {
        await this.send(chatId, `${renderStageProgress(result.currentStage)} (${result.progress}%)`);
      }
    } catch (err) {
      await this.send(chatId, `❌ Workflow failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ============================================
  // Telegram API helpers
  // ============================================

  private async send(chatId: number, text: string, replyMarkup?: unknown, parseMode?: "HTML" | "Markdown" | "MarkdownV2"): Promise<void> {
    if (!this.env.TELEGRAM_BOT_TOKEN) {
      logger.warn("TelegramController: TELEGRAM_BOT_TOKEN not set, skipping send");
      return;
    }
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    };
    if (parseMode) body.parse_mode = parseMode;
    if (replyMarkup) body.reply_markup = replyMarkup;

    const res = await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      logger.error(`TelegramController sendMessage failed ${res.status}: ${err}`);
    }
  }

  private async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    if (!this.env.TELEGRAM_BOT_TOKEN) return;
    await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  }
}

// ============================================
// Factory
// ============================================

let _controller: TelegramController | null = null;

export function getTelegramController(env: HadesBindings): TelegramController {
  if (!_controller) _controller = new TelegramController(env);
  return _controller;
}
