/**
 * Worker Entry Point - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * This file exports the Worker handlers for Cloudflare Workers:
 * - fetch: HTTP request handler
 * - scheduled: Cron trigger handler
 * - queue: Queue message handler
 */

import app from "./index";
import type { HadesBindings } from "./types";

// ============================================
// Worker Exports
// ============================================

export default {
  /**
   * HTTP request handler
   */
  async fetch(
    request: Request,
    env: HadesBindings,
    ctx: ExecutionContext
  ): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  /**
   * Scheduled task handler (Cron Triggers)
   */
  async scheduled(
    event: ScheduledEvent,
    env: HadesBindings,
    ctx: ExecutionContext
  ): Promise<void> {
    // Import the scheduled handler from index
    const { scheduled } = await import("./index");
    if (scheduled) {
      await scheduled(event, env, ctx);
    }
  },

  /**
   * Queue message handler (Cloudflare Queues)
   */
  async queue(
    batch: MessageBatch<unknown>,
    env: HadesBindings,
    ctx: ExecutionContext
  ): Promise<void> {
    // Import the queue handler from index
    const { queue } = await import("./index");
    if (queue) {
      await queue(batch, env, ctx);
    }
  },
};
