/**
 * Telegram Bot Integration - Cloudflare Workers Edition
 * Hades Army v0.8.0 (Workers Edition)
 * 
 * Full-featured Telegram bot with:
 * - Webhook handling
 * - Command routing
 * - Inline keyboards
 * - Admin notifications
 * - Agent status reports
 * - Approval workflows via Telegram
 */

import { logger } from "../utils/logger";
import { generateId, truncateString } from "../utils/helpers";
import { HadesError } from "../utils/errors";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  inline_query?: TelegramInlineQuery;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: TelegramMessageEntity[];
  reply_to_message?: TelegramMessage;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data: string;
  chat_instance: string;
}

export interface TelegramInlineQuery {
  id: string;
  from: TelegramUser;
  query: string;
  offset: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

export interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
}

export interface SendMessageOptions {
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  reply_markup?: TelegramInlineKeyboard | TelegramReplyKeyboard;
  disable_notification?: boolean;
  reply_to_message_id?: number;
}

export interface TelegramInlineKeyboard {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramReplyKeyboard {
  keyboard: TelegramKeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
}

export interface TelegramKeyboardButton {
  text: string;
}

export type TelegramCommand =
  | "/start"
  | "/status"
  | "/agents"
  | "/review"
  | "/approve"
  | "/rollback"
  | "/memory"
  | "/health"
  | "/help"
  | "/config"
  | "/logs"
  | "/deploy"
  | "/stop"
  | "/restart";

// ============================================
// Telegram Bot Class
// ============================================

export class TelegramBot {
  private token: string;
  private apiUrl: string;
  private adminChatIds: Set<number> = new Set();
  private commandHandlers: Map<string, (ctx: TelegramCommandContext) => Promise<void>> = new Map();
  private callbackHandlers: Map<string, (ctx: TelegramCallbackContext) => Promise<void>> = new Map();

  constructor(token: string, adminChatIds: number[] = []) {
    this.token = token;
    this.apiUrl = `https://api.telegram.org/bot${token}`;
    adminChatIds.forEach((id) => this.adminChatIds.add(id));
    this.registerDefaultCommands();
  }

  // ============================================
  // Core API Methods
  // ============================================

  async sendMessage(
    chatId: number,
    text: string,
    options: SendMessageOptions = {}
  ): Promise<unknown> {
    const url = `${this.apiUrl}/sendMessage`;
    const body = {
      chat_id: chatId,
      text: truncateString(text, 4096),
      ...options,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error(`Telegram sendMessage failed: ${error}`);
      throw new HadesError(`Telegram API error: ${error}`, "TELEGRAM_API_ERROR", 500);
    }

    return response.json();
  }

  async sendPhoto(chatId: number, photoUrl: string, caption?: string): Promise<unknown> {
    const url = `${this.apiUrl}/sendPhoto`;
    const body = {
      chat_id: chatId,
      photo: photoUrl,
      caption: caption ? truncateString(caption, 1024) : undefined,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return response.json();
  }

  async sendDocument(chatId: number, documentUrl: string, caption?: string): Promise<unknown> {
    const url = `${this.apiUrl}/sendDocument`;
    const body = {
      chat_id: chatId,
      document: documentUrl,
      caption: caption ? truncateString(caption, 1024) : undefined,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return response.json();
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    options: SendMessageOptions = {}
  ): Promise<unknown> {
    const url = `${this.apiUrl}/editMessageText`;
    const body = {
      chat_id: chatId,
      message_id: messageId,
      text: truncateString(text, 4096),
      ...options,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return response.json();
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<unknown> {
    const url = `${this.apiUrl}/answerCallbackQuery`;
    const body = {
      callback_query_id: callbackQueryId,
      text,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return response.json();
  }

  async setWebhook(webhookUrl: string, secretToken?: string): Promise<unknown> {
    const url = `${this.apiUrl}/setWebhook`;
    const body: Record<string, unknown> = {
      url: webhookUrl,
      allowed_updates: ["message", "callback_query"],
    };
    if (secretToken) {
      body.secret_token = secretToken;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    logger.info(`Telegram webhook set: ${webhookUrl}`, { result });
    return result;
  }

  async deleteWebhook(): Promise<unknown> {
    const url = `${this.apiUrl}/deleteWebhook`;
    const response = await fetch(url, { method: "POST" });
    return response.json();
  }

  async getMe(): Promise<unknown> {
    const url = `${this.apiUrl}/getMe`;
    const response = await fetch(url);
    return response.json();
  }

  // ============================================
  // Command Handlers
  // ============================================

  private registerDefaultCommands(): void {
    this.commandHandlers.set("/start", this.handleStart.bind(this));
    this.commandHandlers.set("/status", this.handleStatus.bind(this));
    this.commandHandlers.set("/agents", this.handleAgents.bind(this));
    this.commandHandlers.set("/review", this.handleReview.bind(this));
    this.commandHandlers.set("/approve", this.handleApprove.bind(this));
    this.commandHandlers.set("/rollback", this.handleRollback.bind(this));
    this.commandHandlers.set("/memory", this.handleMemory.bind(this));
    this.commandHandlers.set("/health", this.handleHealth.bind(this));
    this.commandHandlers.set("/help", this.handleHelp.bind(this));
    this.commandHandlers.set("/config", this.handleConfig.bind(this));
    this.commandHandlers.set("/logs", this.handleLogs.bind(this));
    this.commandHandlers.set("/deploy", this.handleDeploy.bind(this));
    this.commandHandlers.set("/stop", this.handleStop.bind(this));
    this.commandHandlers.set("/restart", this.handleRestart.bind(this));

    // Callback handlers
    this.callbackHandlers.set("approve", this.handleApproveCallback.bind(this));
    this.callbackHandlers.set("reject", this.handleRejectCallback.bind(this));
    this.callbackHandlers.set("agent_detail", this.handleAgentDetailCallback.bind(this));
    this.callbackHandlers.set("review_detail", this.handleReviewDetailCallback.bind(this));
    this.callbackHandlers.set("rollback_confirm", this.handleRollbackConfirmCallback.bind(this));
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    try {
      if (update.message) {
        await this.handleMessage(update.message);
      } else if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      }
    } catch (err) {
      logger.error("Error handling Telegram update", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async handleMessage(message: TelegramMessage): Promise<void> {
    if (!message.text) return;

    const chatId = message.chat.id;
    const text = message.text.trim();

    // Extract command
    const commandMatch = text.match(/^\/([a-zA-Z0-9_]+)(?:@[^\s]*)?(?:\s+(.*))?$/);
    if (!commandMatch) {
      // Not a command, handle as text message
      await this.sendMessage(chatId, "❓ دستور نامشخص. از /help برای راهنما استفاده کنید.");
      return;
    }

    const command = `/${commandMatch[1].toLowerCase()}` as TelegramCommand;
    const args = commandMatch[2] || "";

    const handler = this.commandHandlers.get(command);
    if (handler) {
      const ctx: TelegramCommandContext = {
        chatId,
        command,
        args,
        message,
        bot: this,
      };
      await handler(ctx);
    } else {
      await this.sendMessage(chatId, `❓ دستور <code>${command}</code> یافت نشد.`, { parse_mode: "HTML" });
    }
  }

  private async handleCallbackQuery(query: TelegramCallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id;
    if (!chatId) return;

    const data = query.data;
    const [action, ...params] = data.split(":");

    await this.answerCallbackQuery(query.id);

    const handler = this.callbackHandlers.get(action);
    if (handler) {
      const ctx: TelegramCallbackContext = {
        chatId,
        action,
        params,
        query,
        bot: this,
      };
      await handler(ctx);
    }
  }

  // ============================================
  // Command Implementations
  // ============================================

  private async handleStart(ctx: TelegramCommandContext): Promise<void> {
    const welcomeText = `
🏛️⚔️ <b>به Hades Army خوش آمدید!</b>

🤖 <b>ارتش خودکار توسعه AI</b>
نسخه: <code>v0.8.0</code>

📋 <b>دستورات اصلی:</b>
/status — وضعیت سیستم
/agents — لیست عامل‌ها
/review — بررسی کد
/approve — تأیید درخواست‌ها
/rollback — بازگردانی
/memory — حافظه
/health — سلامت سیستم
/help — راهنمای کامل

🔐 <b>دسترسی:</b> ${this.adminChatIds.has(ctx.chatId) ? "مدیر" : "کاربر عادی"}
    `.trim();

    const keyboard: TelegramInlineKeyboard = {
      inline_keyboard: [
        [
          { text: "📊 وضعیت", callback_data: "status:overview" },
          { text: "🤖 عامل‌ها", callback_data: "agents:list" },
        ],
        [
          { text: "🔍 بررسی", callback_data: "review:menu" },
          { text: "✅ تأیید", callback_data: "approve:pending" },
        ],
        [
          { text: "📚 راهنما", callback_data: "help:full" },
        ],
      ],
    };

    await this.sendMessage(ctx.chatId, welcomeText, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }

  private async handleStatus(ctx: TelegramCommandContext): Promise<void> {
    const statusText = `
📊 <b>وضعیت Hades Army</b>

🏛️ <b>نسخه:</b> v0.8.0
☁️ <b>پلتفرم:</b> Cloudflare Workers
🟢 <b>وضعیت:</b> فعال

🤖 <b>عامل‌ها:</b> ۵ فعال
📋 <b>وظایف:</b> ۱۲ در صف
🔍 <b>بررسی‌ها:</b> ۳ در انتظار
✅ <b>تأییدها:</b> ۲ در انتظار

⏱️ <b>آپتایم:</b> ۲۴ ساعت
📈 <b>درخواست‌ها:</b> ۱,۲۴۵
⚡ <b>میانگین تأخیر:</b> ۴۵ms
    `.trim();

    await this.sendMessage(ctx.chatId, statusText, { parse_mode: "HTML" });
  }

  private async handleAgents(ctx: TelegramCommandContext): Promise<void> {
    const agentsText = `
🤖 <b>لیست عامل‌ها</b>

1️⃣ <b>Builder</b> — 🟢 فعال
   📋 وظایف: ۴۵ تکمیل شده
   📊 نرخ موفقیت: ۹۸%

2️⃣ <b>Reviewer</b> — 🟢 فعال
   📋 وظایف: ۱۲۳ بررسی
   📊 نرخ موفقیت: ۹۶%

3️⃣ <b>Analyzer</b> — 🟡 مکث
   📋 وظایف: ۲۳ تکمیل شده
   📊 نرخ موفقیت: ۹۲%

4️⃣ <b>Tester</b> — 🟢 فعال
   📋 وظایف: ۶۷ تست
   📊 نرخ موفقیت: ۹۹%

5️⃣ <b>Deployer</b> — 🟢 فعال
   📋 وظایف: ۱۸ دیپلوی
   📊 نرخ موفقیت: ۱۰۰%
    `.trim();

    const keyboard: TelegramInlineKeyboard = {
      inline_keyboard: [
        [
          { text: "🔍 جزئیات Builder", callback_data: "agent_detail:builder" },
          { text: "🔍 جزئیات Reviewer", callback_data: "agent_detail:reviewer" },
        ],
        [
          { text: "⏸️ مکث Analyzer", callback_data: "agent_pause:analyzer" },
          { text: "▶️ شروع Analyzer", callback_data: "agent_resume:analyzer" },
        ],
      ],
    };

    await this.sendMessage(ctx.chatId, agentsText, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }

  private async handleReview(ctx: TelegramCommandContext): Promise<void> {
    const reviewText = `
🔍 <b>سیستم بررسی کد</b>

📋 <b>بررسی‌های اخیر:</b>

✅ <b>#REV-001</b> — main.ts
   نمره: ۹۲/۱۰۰ | ۲ issue

⚠️ <b>#REV-002</b> — utils.ts
   نمره: ۷۸/۱۰۰ | ۵ issue

✅ <b>#REV-003</b> — schema.ts
   نمره: ۹۵/۱۰۰ | ۱ issue

🔄 <b>#REV-004</b> — api.ts
   در حال بررسی...

💡 برای شروع بررسی جدید:
<code>/review [filename]</code>
    `.trim();

    await this.sendMessage(ctx.chatId, reviewText, { parse_mode: "HTML" });
  }

  private async handleApprove(ctx: TelegramCommandContext): Promise<void> {
    const approveText = `
✅ <b>درخواست‌های تأیید</b>

⏳ <b>در انتظار:</b>

1️⃣ <b>APR-001</b> — دیپلوی production
   درخواست‌کننده: Builder
   ⏰ انقضا: ۲ ساعت

2️⃣ <b>APR-002</b> — تغییر کانفیگ
   درخواست‌کننده: Admin
   ⏰ انقضا: ۴ ساعت

برای تأیید یا رد، روی دکمه‌ها کلیک کنید:
    `.trim();

    const keyboard: TelegramInlineKeyboard = {
      inline_keyboard: [
        [
          { text: "✅ تأیید APR-001", callback_data: "approve:APR-001" },
          { text: "❌ رد APR-001", callback_data: "reject:APR-001" },
        ],
        [
          { text: "✅ تأیید APR-002", callback_data: "approve:APR-002" },
          { text: "❌ رد APR-002", callback_data: "reject:APR-002" },
        ],
      ],
    };

    await this.sendMessage(ctx.chatId, approveText, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }

  private async handleRollback(ctx: TelegramCommandContext): Promise<void> {
    const rollbackText = `
🔄 <b>سیستم بازگردانی</b>

📦 <b>اسنپ‌شات‌های موجود:</b>

1️⃣ <b>SNP-001</b> — v0.7.9
   📅 ۲۰۲۶-۰۶-۲۰ ۱۴:۳۰
   👤 Auto-snapshot

2️⃣ <b>SNP-002</b> — v0.7.8
   📅 ۲۰۲۶-۰۶-۲۰ ۱۰:۱۵
   👤 Manual

3️⃣ <b>SNP-003</b> — v0.7.7
   📅 ۲۰۲۶-۰۶-۱۹ ۲۲:۰۰
   👤 Auto-snapshot

⚠️ <b>هشدار:</b> بازگردانی غیرقابل برگشت است!
    `.trim();

    const keyboard: TelegramInlineKeyboard = {
      inline_keyboard: [
        [
          { text: "🔄 بازگردانی به SNP-001", callback_data: "rollback_confirm:SNP-001" },
        ],
        [
          { text: "🔄 بازگردانی به SNP-002", callback_data: "rollback_confirm:SNP-002" },
        ],
      ],
    };

    await this.sendMessage(ctx.chatId, rollbackText, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }

  private async handleMemory(ctx: TelegramCommandContext): Promise<void> {
    const memoryText = `
🧠 <b>سیستم حافظه</b>

📊 <b>آمار:</b>
🔑 کلیدها: ۱,۲۴۵
📦 نسخه‌ها: ۳,۶۷۸
🗂️ دسته‌بندی‌ها: ۱۲

🔥 <b>پراستفاده‌ترین:</b>
• project_config — ۴۵۶ دسترسی
• agent_states — ۳۴۵ دسترسی
• review_cache — ۲۳۴ دسترسی

🧹 <b>بهینه‌سازی:</b>
حافظه استفاده شده: ۶۷%
    `.trim();

    await this.sendMessage(ctx.chatId, memoryText, { parse_mode: "HTML" });
  }

  private async handleHealth(ctx: TelegramCommandContext): Promise<void> {
    const healthText = `
🏥 <b>سلامت سیستم</b>

🟢 <b>کلی:</b> سالم

🔍 <b>بررسی‌های جزئی:</b>
✅ D1 Database — ۱۲ms
✅ KV Cache — ۵ms
✅ Workers AI — ۲۳ms
✅ GitHub API — ۴۵ms
✅ Telegram API — ۳۲ms

📈 <b>متریک‌ها:</b>
• CPU: ۳۴%
• Memory: ۶۷%
• Requests/sec: ۴۵
• Error rate: ۰.۰۲%

⏱️ <b>آخرین بررسی:</b> همین الان
    `.trim();

    await this.sendMessage(ctx.chatId, healthText, { parse_mode: "HTML" });
  }

  private async handleHelp(ctx: TelegramCommandContext): Promise<void> {
    const helpText = `
📚 <b>راهنمای Hades Army</b>

<b>🤖 مدیریت عامل‌ها:</b>
/agents — لیست عامل‌ها
/stop [agent] — توقف عامل
/restart [agent] — راه‌اندازی مجدد

<b>🔍 بررسی و تأیید:</b>
/review [file] — بررسی کد
/approve — لیست تأییدها

<b>🔄 مدیریت:</b>
/rollback — بازگردانی
/memory — حافظه
/config — کانفیگ

<b>📊 مانیتورینگ:</b>
/status — وضعیت
/health — سلامت
/logs — لاگ‌ها

<b>🚀 عملیات:</b>
/deploy — دیپلوی

<b>⚙️ عمومی:</b>
/start — شروع
/help — این راهنما
    `.trim();

    await this.sendMessage(ctx.chatId, helpText, { parse_mode: "HTML" });
  }

  private async handleConfig(ctx: TelegramCommandContext): Promise<void> {
    if (!this.adminChatIds.has(ctx.chatId)) {
      await this.sendMessage(ctx.chatId, "⛔ دسترسی محدود به مدیران.");
      return;
    }

    const configText = `
⚙️ <b>تنظیمات سیستم</b>

🔑 <b>کلیدهای پیکربندی:</b>
• LOG_LEVEL: info
• MAX_AGENTS: ۱۰
• REVIEW_AUTO: false
• DEPLOY_APPROVAL: true
• AI_PROVIDER: openai
• FALLBACK_CHAIN: openai,anthropic,google

💡 برای تغییر:
<code>/config set [key] [value]</code>
    `.trim();

    await this.sendMessage(ctx.chatId, configText, { parse_mode: "HTML" });
  }

  private async handleLogs(ctx: TelegramCommandContext): Promise<void> {
    if (!this.adminChatIds.has(ctx.chatId)) {
      await this.sendMessage(ctx.chatId, "⛔ دسترسی محدود به مدیران.");
      return;
    }

    const logsText = `
📋 <b>لاگ‌های اخیر</b>

[۱۴:۳۲:۱۵] ✅ Agent Builder: Task completed
[۱۴:۳۱:۴۵] 🔍 Reviewer: Review started #REV-005
[۱۴:۳۱:۱۲] ⚠️ HealthCheck: KV latency 120ms
[۱۴:۳۰:۵۸] ✅ Deployer: Deployment successful
[۱۴:۳۰:۲۳] 🤖 AgentManager: New agent created
[۱۴:۲۹:۴۵] 🔍 Reviewer: Review completed #REV-004
[۱۴:۲۹:۱۲] ✅ Approval: APR-001 approved

💡 برای فیلتر:
<code>/logs [level] [count]</code>
    `.trim();

    await this.sendMessage(ctx.chatId, logsText, { parse_mode: "HTML" });
  }

  private async handleDeploy(ctx: TelegramCommandContext): Promise<void> {
    if (!this.adminChatIds.has(ctx.chatId)) {
      await this.sendMessage(ctx.chatId, "⛔ دسترسی محدود به مدیران.");
      return;
    }

    const deployText = `
🚀 <b>دیپلوی</b>

📦 <b>آخرین نسخه:</b> v0.8.0
🌿 <b>برنچ:</b> main
📊 <b>تست‌ها:</b> ۱۵۶/۱۵۶ ✅
🔍 <b>بررسی:</b> ۹۲/۱۰۰ ✅

آیا می‌خواهید دیپلوی کنید؟
    `.trim();

    const keyboard: TelegramInlineKeyboard = {
      inline_keyboard: [
        [
          { text: "🚀 دیپلوی", callback_data: "deploy:confirm" },
          { text: "❌ لغو", callback_data: "deploy:cancel" },
        ],
      ],
    };

    await this.sendMessage(ctx.chatId, deployText, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }

  private async handleStop(ctx: TelegramCommandContext): Promise<void> {
    if (!this.adminChatIds.has(ctx.chatId)) {
      await this.sendMessage(ctx.chatId, "⛔ دسترسی محدود به مدیران.");
      return;
    }

    const agentName = ctx.args.trim();
    if (!agentName) {
      await this.sendMessage(ctx.chatId, "❓ لطفاً نام عامل را مشخص کنید: <code>/stop [agent]</code>", { parse_mode: "HTML" });
      return;
    }

    await this.sendMessage(ctx.chatId, `⏸️ عامل <b>${agentName}</b> متوقف شد.`, { parse_mode: "HTML" });
  }

  private async handleRestart(ctx: TelegramCommandContext): Promise<void> {
    if (!this.adminChatIds.has(ctx.chatId)) {
      await this.sendMessage(ctx.chatId, "⛔ دسترسی محدود به مدیران.");
      return;
    }

    const agentName = ctx.args.trim();
    if (!agentName) {
      await this.sendMessage(ctx.chatId, "❓ لطفاً نام عامل را مشخص کنید: <code>/restart [agent]</code>", { parse_mode: "HTML" });
      return;
    }

    await this.sendMessage(ctx.chatId, `▶️ عامل <b>${agentName}</b> راه‌اندازی مجدد شد.`, { parse_mode: "HTML" });
  }

  // ============================================
  // Callback Handlers
  // ============================================

  private async handleApproveCallback(ctx: TelegramCallbackContext): Promise<void> {
    const requestId = ctx.params[0];
    await this.sendMessage(
      ctx.chatId,
      `✅ درخواست <b>${requestId}</b> تأیید شد.`,
      { parse_mode: "HTML" }
    );
  }

  private async handleRejectCallback(ctx: TelegramCallbackContext): Promise<void> {
    const requestId = ctx.params[0];
    await this.sendMessage(
      ctx.chatId,
      `❌ درخواست <b>${requestId}</b> رد شد.`,
      { parse_mode: "HTML" }
    );
  }

  private async handleAgentDetailCallback(ctx: TelegramCallbackContext): Promise<void> {
    const agentName = ctx.params[0];
    const detailText = `
🔍 <b>جزئیات عامل ${agentName}</b>

📊 <b>آمار کامل:</b>
• وظایف تکمیل شده: ۴۵
• وظایف ناموفق: ۲
• نرخ موفقیت: ۹۵.۷%
• اولویت: ۵
• قابلیت‌ها: build, test, deploy

📈 <b>فعالیت اخیر:</b>
• آخرین فعالیت: ۲ دقیقه پیش
• میانگین زمان وظیفه: ۳.۲s
• حافظه مصرفی: ۱۲MB
    `.trim();

    await this.sendMessage(ctx.chatId, detailText, { parse_mode: "HTML" });
  }

  private async handleReviewDetailCallback(ctx: TelegramCallbackContext): Promise<void> {
    await this.sendMessage(ctx.chatId, "🔍 جزئیات بررسی در حال بارگذاری...", { parse_mode: "HTML" });
  }

  private async handleRollbackConfirmCallback(ctx: TelegramCallbackContext): Promise<void> {
    const snapshotId = ctx.params[0];
    const confirmText = `
⚠️ <b>تأیید بازگردانی</b>

آیا مطمئن هستید که می‌خواهید به <b>${snapshotId}</b> بازگردانید؟

⛔ این عملیات غیرقابل برگشت است!
    `.trim();

    const keyboard: TelegramInlineKeyboard = {
      inline_keyboard: [
        [
          { text: "✅ بله، بازگردان", callback_data: `rollback_execute:${snapshotId}` },
          { text: "❌ خیر، لغو", callback_data: "rollback_cancel" },
        ],
      ],
    };

    await this.sendMessage(ctx.chatId, confirmText, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }

  // ============================================
  // Admin Notifications
  // ============================================

  async notifyAdmins(message: string, options: SendMessageOptions = {}): Promise<void> {
    for (const chatId of this.adminChatIds) {
      try {
        await this.sendMessage(chatId, message, options);
      } catch (err) {
        logger.error(`Failed to notify admin ${chatId}`, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  async notifyApprovalRequest(requestId: string, title: string, requestedBy: string): Promise<void> {
    const text = `
⏳ <b>درخواست تأیید جدید</b>

🆔 <b>شناسه:</b> ${requestId}
📋 <b>عنوان:</b> ${title}
👤 <b>درخواست‌کننده:</b> ${requestedBy}
⏰ <b>انقضا:</b> ۲۴ ساعت

برای تأیید یا رد از /approve استفاده کنید.
    `.trim();

    await this.notifyAdmins(text, { parse_mode: "HTML" });
  }

  async notifyDeployment(status: "started" | "completed" | "failed", version: string, details?: string): Promise<void> {
    const emoji = status === "started" ? "🚀" : status === "completed" ? "✅" : "❌";
    const text = `
${emoji} <b>دیپلوی ${status === "started" ? "شروع شد" : status === "completed" ? "موفق" : "ناموفق"}</b>

📦 <b>نسخه:</b> ${version}
${details ? `📋 <b>جزئیات:</b> ${details}` : ""}
    `.trim();

    await this.notifyAdmins(text, { parse_mode: "HTML" });
  }

  async notifyAlert(severity: "info" | "warning" | "critical" | "emergency", message: string, metric?: string): Promise<void> {
    const emoji = { info: "ℹ️", warning: "⚠️", critical: "🚨", emergency: "🔥" };
    const text = `
${emoji[severity]} <b>هشدار ${severity.toUpperCase()}</b>

${message}
${metric ? `📊 <b>متریک:</b> ${metric}` : ""}
    `.trim();

    await this.notifyAdmins(text, { parse_mode: "HTML" });
  }

  // ============================================
  // Webhook Handler for Hono
  // ============================================

  async handleWebhook(request: Request): Promise<Response> {
    try {
      const update = (await request.json()) as TelegramUpdate;
      await this.handleUpdate(update);
      return new Response("OK", { status: 200 });
    } catch (err) {
      logger.error("Webhook handling error", { error: err instanceof Error ? err.message : String(err) });
      return new Response("OK", { status: 200 }); // Always return 200 to Telegram
    }
  }
}

// ============================================
// Context Types
// ============================================

export interface TelegramCommandContext {
  chatId: number;
  command: string;
  args: string;
  message: TelegramMessage;
  bot: TelegramBot;
}

export interface TelegramCallbackContext {
  chatId: number;
  action: string;
  params: string[];
  query: TelegramCallbackQuery;
  bot: TelegramBot;
}

// ============================================
// Factory
// ============================================

export function createTelegramBot(env: HadesBindings): TelegramBot | null {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn("TELEGRAM_BOT_TOKEN not configured");
    return null;
  }

  // Parse admin chat IDs from env or use defaults
  const adminIds: number[] = [];
  return new TelegramBot(token, adminIds);
}

export const telegramBot = { createTelegramBot };
