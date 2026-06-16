/**
 * Hades Army — Cloudflare Worker Entry Point
 * Handles all incoming requests: Telegram webhooks, health checks.
 */

import { validateEnv, type HadesEnv } from './config/env';
import { Orchestrator } from './core/orchestrator';
import type { TelegramUpdate } from './types';

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext): Promise<Response> {
    try {
      // Validate environment
      const hadesEnv = validateEnv(env);

      const url = new URL(request.url);

      // Health check
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({
          status: 'ok',
          version: hadesEnv.HADES_VERSION,
          timestamp: new Date().toISOString(),
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Telegram webhook
      if (url.pathname === '/webhook' && request.method === 'POST') {
        const update = await request.json() as TelegramUpdate;

        // Process asynchronously
        ctx.waitUntil(handleTelegramUpdate(update, hadesEnv));

        return new Response('OK', { status: 200 });
      }

      // Setup webhook endpoint
      if (url.pathname === '/setup-webhook' && request.method === 'GET') {
        const webhookUrl = `${url.origin}/webhook`;
        const telegram = new (await import('./services/telegram.service')).TelegramService(hadesEnv);
        await telegram.setWebhook(webhookUrl);
        return new Response(`Webhook set to: ${webhookUrl}`, { status: 200 });
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Worker Error]', message);
      return new Response(`Error: ${message}`, { status: 500 });
    }
  },
};

/**
 * Process Telegram update asynchronously.
 */
async function handleTelegramUpdate(update: TelegramUpdate, env: HadesEnv): Promise<void> {
  const orchestrator = new Orchestrator(env);

  try {
    const telegram = new (await import('./services/telegram.service')).TelegramService(env);
    const parsed = await telegram.handleUpdate(update);

    if (!parsed) return;

    const { chatId, text, userId } = parsed;

    await orchestrator.handleTelegramMessage(userId, chatId, text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Telegram Handler Error]', message);
  }
}
