/**
 * Shutdown Manager - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { logger } from "./logger";

export interface ShutdownHandler {
  name: string;
  handler: () => Promise<void>;
  priority: number;
}

export class ShutdownManager {
  private handlers: ShutdownHandler[] = [];
  private isShuttingDown = false;

  register(handler: ShutdownHandler): void {
    this.handlers.push(handler);
    this.handlers.sort((a, b) => a.priority - b.priority);
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info("Shutdown initiated...");
    for (const { name, handler } of this.handlers) {
      try {
        await handler();
        logger.info(`Shutdown handler completed: ${name}`);
      } catch (err) {
        logger.error(`Shutdown handler failed: ${name}`, { error: err instanceof Error ? err.message : String(err) });
      }
    }
    logger.info("Shutdown completed");
  }

  getHandlers(): ShutdownHandler[] {
    return [...this.handlers];
  }
}

export const shutdownManager = new ShutdownManager();
