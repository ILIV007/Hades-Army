/**
 * Hades Army v0.2 — Telegram Bot Service
 * GPT-style conversational interface + live progress updates.
 * Pure ESM.
 */

import type { HadesEnv } from "../config/env";
import type { TelegramUpdate } from "../types";
import { Logger } from "../utils/logger";
import { withRetry } from "../utils/helpers";

export class TelegramService {
  private logger: Logger;
  private baseUrl: string;

  constructor(private env: HadesEnv) {
    this.logger = new Logger(env);
    this.baseUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  }

  async handleUpdate(update: TelegramUpdate): Promise<{ chatId: number; text: string; userId: number } | null> {
    if (update.message) {
      return { chatId: update.message.chat.id, text: update.message.text ?? "", userId: update.message.from.id };
    }
    if (update.callback_query) {
      return { chatId: update.callback_query.message?.chat.id ?? update.callback_query.from.id, text: update.callback_query.data, userId: update.callback_query.from.id };
    }
    return null;
  }

  async sendMessage(chatId: number, text: string, options?: { parseMode?: "Markdown" | "HTML"; replyMarkup?: unknown; replyToMessageId?: number }): Promise<void> {
    const body: Record<string, unknown> = { chat_id: chatId, text: text.slice(0, 4096) };
    if (options?.parseMode) body.parse_mode = options.parseMode;
    if (options?.replyMarkup) body.reply_markup = options.replyMarkup;
    if (options?.replyToMessageId) body.reply_to_message_id = options.replyToMessageId;

    await withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Telegram error: ${res.status}`);
    }, 2);
  }

  async sendTyping(chatId: number): Promise<void> {
    await fetch(`${this.baseUrl}/sendChatAction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, action: "typing" }) });
  }

  async reportProgress(chatId: number, stage: string, detail?: string): Promise<void> {
    const emoji = this.getStageEmoji(stage);
    await this.sendMessage(chatId, `${emoji} *${stage}*${detail ? `\n_${detail}_` : ""}`, { parseMode: "Markdown" });
  }

  async reportStageChange(chatId: number, fromStage: string, toStage: string, detail?: string): Promise<void> {
    await this.sendMessage(chatId, `${this.getStageEmoji(fromStage)} *${fromStage}* → ${this.getStageEmoji(toStage)} *${toStage}*${detail ? `\n_${detail}_` : ""}`, { parseMode: "Markdown" });
  }

  private getStageEmoji(stage: string): string {
    const map: Record<string, string> = { Analyzing: "🧠", Planning: "📋", Building: "🔨", Reviewing: "🔍", "Creating PR": "📦", "Waiting Approval": "⏳", Merging: "🔀", Completed: "✅", Failed: "❌", Error: "⚠️", Retrying: "🔄", Cancelled: "🚫" };
    return map[stage] ?? "⚙️";
  }

  async sendApprovalRequest(chatId: number, prUrl: string, taskId: string): Promise<void> {
    const keyboard = { inline_keyboard: [[{ text: "✅ Approve", callback_data: `approve:${taskId}` }, { text: "❌ Reject", callback_data: `reject:${taskId}` }], [{ text: "📝 Request Changes", callback_data: `changes:${taskId}` }]] };
    await this.sendMessage(chatId, `📦 *Pull Request Ready*\n\n${prUrl}\n\nReview and approve to merge.`, { parseMode: "Markdown", replyMarkup: keyboard });
  }

  async sendTaskBreakdown(chatId: number, tasks: Array<{ id: string; title: string; priority: string }>): Promise<void> {
    await this.sendMessage(chatId, `📋 *Task Breakdown*\n\n${tasks.map((t, i) => `${i + 1}. ${t.title} (${t.priority})`).join("\n")}`, { parseMode: "Markdown" });
  }

  async sendReviewResults(chatId: number, status: "PASS" | "FAIL", issues: Array<{ severity: string; message: string }>, summary: string): Promise<void> {
    const emoji = status === "PASS" ? "✅" : "❌";
    const issueLines = issues.map(i => `- [${i.severity}] ${i.message}`);
    const message = `${emoji} *Review ${status}*\n\n${issues.length > 0 ? `*Issues:*\n${issueLines.join("\n")}\n\n` : ""}*Summary:* ${summary}`;
    await this.sendMessage(chatId, message, { parseMode: "Markdown" });
  }

  async setWebhook(url: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/setWebhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, allowed_updates: ["message", "callback_query"] }) });
    if (!res.ok) throw new Error(`Failed to set webhook: ${await res.text()}`);
  }

  async deleteWebhook(): Promise<void> {
    await fetch(`${this.baseUrl}/deleteWebhook`, { method: "POST" });
  }
}
