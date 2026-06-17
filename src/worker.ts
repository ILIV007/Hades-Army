/**
 * Hades Army v0.2.1 — Cloudflare Worker Entry Point
 * Handles Telegram webhooks, health checks, webhook setup.
 * FIX MEDIUM #1: Boot Audit runs on every worker start.
 * Pure ESM.
 */

import { validateEnv, type HadesEnv } from "./config/env";
import { createAgentRegistry, validateRegistry } from "./config/agents.config";
import { Orchestrator } from "./core/orchestrator";
import type { TelegramUpdate } from "./types";

// FIX MEDIUM #1: Global boot audit result, computed once per worker start
let bootAuditResult: { ok: boolean; checks: Array<{ name: string; status: string; message: string }> } | null = null;

function runBootAudit(env: HadesEnv): { ok: boolean; checks: Array<{ name: string; status: string; message: string }> } {
  const registry = createAgentRegistry(env);
  return validateRegistry(registry);
}

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext): Promise<Response> {
    try {
      const hadesEnv = validateEnv(env);

      // FIX MEDIUM #1: Run boot audit on first request if not already done
      if (!bootAuditResult) {
        bootAuditResult = runBootAudit(hadesEnv);
      }

      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return new Response(JSON.stringify({
          status: bootAuditResult.ok ? "ok" : "degraded",
          version: hadesEnv.HADES_VERSION,
          audit: bootAuditResult.checks,
          timestamp: new Date().toISOString()
        }), {
          headers: { "Content-Type": "application/json" },
          status: bootAuditResult.ok ? 200 : 503,
        });
      }

      // FIX MEDIUM #1: If boot audit failed, reject all non-health requests
      if (!bootAuditResult.ok) {
        return new Response(JSON.stringify({
          error: "Boot audit failed",
          audit: bootAuditResult.checks,
        }), {
          headers: { "Content-Type": "application/json" },
          status: 503,
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
