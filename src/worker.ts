/**
 * Hades Army v0.2 — Cloudflare Worker Entry Point
 * Handles Telegram webhooks, health checks, webhook setup.
 * Pure ESM.
 */

import { validateEnv, type HadesEnv } from "./config/env";
import { Orchestrator } from "./core/orchestrator";
import type { TelegramUpdate } from "./types";

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext): Promise<Response> {
    try {
      const hadesEnv = validateEnv(env);
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok", version: hadesEnv.HADES_VERSION, timestamp: new Date().toISOString() }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.pathname === "/webhook" && request.method === "POST") {
        const update = await request.json() as TelegramUpdate;
        ctx.waitUntil(handleTelegramUpdate(update, hadesEnv));
        return new Response("OK", { status: 200 });
      }

      if (url.pathname === "/setup-webhook" && request.method === "GET") {
        const webhookUrl = `${url.origin}/webhook`;
        const { TelegramService } = await import("./services/telegram.service");
        const telegram = new TelegramService(hadesEnv);
        await telegram.setWebhook(webhookUrl);
        return new Response(`Webhook set: ${webhookUrl}`, { status: 200 });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Worker Error]", message);
      return new Response(`Error: ${message}`, { status: 500 });
    }
  },
};

async function handleTelegramUpdate(update: TelegramUpdate, env: HadesEnv): Promise<void> {
  const orchestrator = new Orchestrator(env);
  try {
    const { TelegramService } = await import("./services/telegram.service");
    const telegram = new TelegramService(env);
    const parsed = await telegram.handleUpdate(update);
    if (!parsed) return;
    await orchestrator.handleTelegramMessage(parsed.userId, parsed.chatId, parsed.text);
  } catch (error) {
    console.error("[Telegram Handler]", error instanceof Error ? error.message : String(error));
  }
}
