/**
 * Telegram Service (v9.2 hardening) - Cloudflare Workers Edition
 * Hades Army v9.2 — Fix & Stabilization
 *
 * Wraps every Telegram API call with:
 *   - try/catch (never throws)
 *   - retry with exponential backoff (max 3 attempts)
 *   - structured logging at every step
 *   - mandatory fallback response when everything fails
 *
 * The bot must NEVER be silent. If sendMessage fails 3 times, we
 * log the failure with a trace ID so the admin can investigate via
 * /admin → Telegram Debug Panel.
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export interface TelegramSendResult {
  ok: boolean;
  messageId?: number;
  error?: string;
  attempts: number;
  traceId: string;
}

export interface TelegramDebugEvent {
  id: string;
  timestamp: string;
  kind: "update_received" | "parsed" | "manager_start" | "manager_finished" | "sending" | "sent" | "failed";
  chatId?: number;
  userId?: number;
  text?: string;
  responsePreview?: string;
  error?: string;
  durationMs?: number;
}

// ============================================
// In-memory event log (per-isolate, mirrored to KV)
// ============================================

const MAX_EVENTS = 200;
const recentEvents: TelegramDebugEvent[] = [];

export function recordTelegramEvent(event: Omit<TelegramDebugEvent, "id" | "timestamp">): TelegramDebugEvent {
  const full: TelegramDebugEvent = {
    ...event,
    id: generateId("tg-evt"),
    timestamp: new Date().toISOString(),
  };
  recentEvents.push(full);
  if (recentEvents.length > MAX_EVENTS) recentEvents.splice(0, recentEvents.length - MAX_EVENTS);
  return full;
}

export function getRecentTelegramEvents(limit = 50): TelegramDebugEvent[] {
  return recentEvents.slice(-limit).reverse();
}

// ============================================
// Telegram Service (hardened)
// ============================================

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

export class TelegramService {
  private botToken: string;
  private apiBase: string;

  constructor(botToken: string) {
    this.botToken = botToken;
    this.apiBase = `https://api.telegram.org/bot${botToken}`;
  }

  /**
   * Send a message with retry + exponential backoff. Never throws.
   */
  async sendMessage(
    chatId: number,
    text: string,
    options?: {
      parseMode?: "HTML" | "Markdown" | "MarkdownV2";
      replyMarkup?: unknown;
      disableWebPagePreview?: boolean;
      replyToMessageId?: number;
    },
  ): Promise<TelegramSendResult> {
    const traceId = generateId("tg-send");
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      disable_web_page_preview: options?.disableWebPagePreview ?? true,
    };
    if (options?.parseMode) body.parse_mode = options.parseMode;
    if (options?.replyMarkup) body.reply_markup = options.replyMarkup;
    if (options?.replyToMessageId) body.reply_to_message_id = options.replyToMessageId;

    let lastError: string | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const start = Date.now();
        const res = await fetch(`${this.apiBase}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          const data = (await res.json()) as any;
          const durationMs = Date.now() - start;
          recordTelegramEvent({
            kind: "sent",
            chatId,
            responsePreview: text.slice(0, 100),
            durationMs,
          });
          return {
            ok: true,
            messageId: data?.result?.message_id,
            attempts: attempt,
            traceId,
          };
        }

        // 4xx — don't retry (bad request, chat not found, etc.)
        if (res.status >= 400 && res.status < 500) {
          const errText = await res.text().catch(() => res.statusText);
          lastError = `Telegram ${res.status}: ${errText}`;
          logger.warn(`TelegramService sendMessage 4xx (no retry)`, { traceId, attempt, status: res.status, errText });
          break;
        }

        // 5xx — retry
        const errText = await res.text().catch(() => res.statusText);
        lastError = `Telegram ${res.status}: ${errText}`;
        logger.warn(`TelegramService sendMessage 5xx (will retry)`, { traceId, attempt, status: res.status });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        logger.warn(`TelegramService sendMessage network error (will retry)`, { traceId, attempt, err: lastError });
      }

      if (attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }

    recordTelegramEvent({
      kind: "failed",
      chatId,
      responsePreview: text.slice(0, 100),
      error: lastError,
    });
    logger.error(`TelegramService sendMessage FAILED after retries`, { traceId, lastError });
    return { ok: false, error: lastError, attempts: MAX_RETRIES, traceId };
  }

  /**
   * Answer a callback query with retry. Never throws.
   */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<TelegramSendResult> {
    const traceId = generateId("tg-cb");
    const body: Record<string, unknown> = { callback_query_id: callbackQueryId };
    if (text) body.text = text;

    let lastError: string | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${this.apiBase}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) return { ok: true, attempts: attempt, traceId };
        const errText = await res.text().catch(() => res.statusText);
        lastError = `Telegram ${res.status}: ${errText}`;
        if (res.status >= 400 && res.status < 500) break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1)));
      }
    }
    return { ok: false, error: lastError, attempts: MAX_RETRIES, traceId };
  }

  /**
   * Edit message text with retry. Never throws.
   */
  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    options?: { parseMode?: "HTML" | "Markdown" | "MarkdownV2"; replyMarkup?: unknown },
  ): Promise<TelegramSendResult> {
    const traceId = generateId("tg-edit");
    const body: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      text,
      disable_web_page_preview: true,
    };
    if (options?.parseMode) body.parse_mode = options.parseMode;
    if (options?.replyMarkup) body.reply_markup = options.replyMarkup;

    let lastError: string | undefined;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${this.apiBase}/editMessageText`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) return { ok: true, attempts: attempt, traceId };
        const errText = await res.text().catch(() => res.statusText);
        lastError = `Telegram ${res.status}: ${errText}`;
        if (res.status >= 400 && res.status < 500) break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1)));
      }
    }
    return { ok: false, error: lastError, attempts: MAX_RETRIES, traceId };
  }

  /**
   * Get webhook info (for /health/telegram).
   */
  async getWebhookInfo(): Promise<{ ok: boolean; info?: unknown; error?: string }> {
    try {
      const res = await fetch(`${this.apiBase}/getWebhookInfo`);
      if (!res.ok) return { ok: false, error: `Telegram ${res.status}` };
      const data = (await res.json()) as any;
      return { ok: true, info: data?.result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ============================================
// Factory
// ============================================

let _instance: TelegramService | null = null;

export function getTelegramService(env: HadesBindings): TelegramService | null {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  // Create a new instance each call to avoid stale token across isolates
  return new TelegramService(env.TELEGRAM_BOT_TOKEN);
}
