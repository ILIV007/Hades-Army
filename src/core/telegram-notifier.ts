/**
 * Telegram Notifier - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Lightweight notification service for sending
 * alerts and updates to Telegram admin channels.
 */

import { logger } from "../utils/logger";
import { truncateString } from "../utils/helpers";
import type { HadesBindings, AlertSeverity } from "../types";

// ============================================
// Types
// ============================================

export interface TelegramNotification {
  chatId: number;
  message: string;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  disableNotification?: boolean;
}

export interface AlertNotification {
  severity: AlertSeverity;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

// ============================================
// Telegram Notifier
// ============================================

export class TelegramNotifier {
  private token: string;
  private apiUrl: string;
  private adminChatIds: number[];

  constructor(token: string, adminChatIds: number[] = []) {
    this.token = token;
    this.apiUrl = `https://api.telegram.org/bot${token}`;
    this.adminChatIds = adminChatIds;
  }

  /**
   * Send a message to a specific chat
   */
  async sendMessage(notification: TelegramNotification): Promise<boolean> {
    try {
      const url = `${this.apiUrl}/sendMessage`;
      const body = {
        chat_id: notification.chatId,
        text: truncateString(notification.message, 4096),
        parse_mode: notification.parseMode || "HTML",
        disable_notification: notification.disableNotification || false,
      };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.warn(`Telegram notification failed: ${error}`);
        return false;
      }

      logger.debug(`Telegram notification sent to ${notification.chatId}`);
      return true;
    } catch (err) {
      logger.error("Telegram notification error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Send alert to all admin channels
   */
  async sendAlert(alert: AlertNotification): Promise<void> {
    const emoji = this.getSeverityEmoji(alert.severity);
    const timestamp = new Date().toISOString();

    const message = `
${emoji} <b>${alert.title}</b>

<b>Severity:</b> ${alert.severity.toUpperCase()}
<b>Time:</b> <code>${timestamp}</code>

${alert.message}

${alert.metadata ? `<b>Metadata:</b>
<pre>${JSON.stringify(alert.metadata, null, 2)}</pre>` : ""}
    `.trim();

    for (const chatId of this.adminChatIds) {
      await this.sendMessage({
        chatId,
        message,
        parseMode: "HTML",
        disableNotification: alert.severity === "info",
      });
    }

    logger.info(`Alert sent to ${this.adminChatIds.length} admin channels`, {
      severity: alert.severity,
      title: alert.title,
    });
  }

  /**
   * Send system status update
   */
  async sendStatusUpdate(
    status: "healthy" | "degraded" | "unhealthy",
    details: string
  ): Promise<void> {
    const emoji = status === "healthy" ? "🟢" : status === "degraded" ? "🟡" : "🔴";

    const message = `
${emoji} <b>System Status Update</b>

<b>Status:</b> ${status.toUpperCase()}
<b>Time:</b> <code>${new Date().toISOString()}</code>

${details}
    `.trim();

    for (const chatId of this.adminChatIds) {
      await this.sendMessage({
        chatId,
        message,
        parseMode: "HTML",
      });
    }
  }

  /**
   * Send deployment notification
   */
  async sendDeploymentNotification(
    version: string,
    status: "started" | "completed" | "failed",
    details?: string
  ): Promise<void> {
    const emoji = status === "started" ? "🚀" : status === "completed" ? "✅" : "❌";

    const message = `
${emoji} <b>Deployment ${status.toUpperCase()}</b>

<b>Version:</b> <code>${version}</code>
<b>Time:</b> <code>${new Date().toISOString()}</code>

${details || ""}
    `.trim();

    for (const chatId of this.adminChatIds) {
      await this.sendMessage({
        chatId,
        message,
        parseMode: "HTML",
      });
    }
  }

  /**
   * Get emoji for severity level
   */
  private getSeverityEmoji(severity: AlertSeverity): string {
    const emojis: Record<AlertSeverity, string> = {
      info: "ℹ️",
      warning: "⚠️",
      critical: "🚨",
      emergency: "🔥",
    };
    return emojis[severity] || "ℹ️";
  }

  /**
   * Get admin chat IDs
   */
  getAdminChatIds(): number[] {
    return [...this.adminChatIds];
  }

  /**
   * Add admin chat ID
   */
  addAdminChatId(chatId: number): void {
    if (!this.adminChatIds.includes(chatId)) {
      this.adminChatIds.push(chatId);
      logger.info(`Admin chat ID added: ${chatId}`);
    }
  }

  /**
   * Remove admin chat ID
   */
  removeAdminChatId(chatId: number): void {
    const index = this.adminChatIds.indexOf(chatId);
    if (index >= 0) {
      this.adminChatIds.splice(index, 1);
      logger.info(`Admin chat ID removed: ${chatId}`);
    }
  }
}

// ============================================
// Factory
// ============================================

export function createTelegramNotifier(env: HadesBindings): TelegramNotifier | null {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn("TELEGRAM_BOT_TOKEN not configured");
    return null;
  }

  // Parse admin chat IDs from environment or use empty array
  const adminIds: number[] = [];

  return new TelegramNotifier(token, adminIds);
}

export const telegramNotifier = { createTelegramNotifier };
