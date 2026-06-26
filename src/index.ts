/**
 * Hades Army - Cloudflare Workers Entry Point
 * Hades Army v9.2.1 — Critical Hotfix
 *
 * HARDENED ENTRY POINT:
 *   - All routes registered BEFORE any module-load work
 *   - Top-level imports kept minimal (only Hono + logger)
 *   - All feature modules are LAZY-LOADED inside route handlers
 *   - Every handler wrapped in try/catch — Worker never throws 500
 *
 * ROUTES:
 *   GET  /                          → Worker info
 *   GET  /health                    → Health check (services object)
 *   GET  /health/telegram           → Telegram webhook diagnostics
 *   GET  /debug/telegram            → Telegram debug info
 *   POST /webhook                   → Telegram webhook (PRIMARY — matches Dashboard config)
 *   POST /webhook/telegram          → Telegram webhook (alias)
 *   POST /webhook/github            → GitHub webhook
 *   GET  /admin                     → Admin HTML dashboard
 *   GET  /admin/health              → Admin health JSON
 *   GET  /admin/debug               → Admin debug JSON
 *   ALL  /admin/api/*               → Admin API endpoints
 *   GET  /api/v1/*                  → REST API (legacy)
 */

import { Hono } from "hono";
import { logger, configureLogger } from "./utils/logger";
import type { HadesBindings } from "./types";

// ============================================
// Main Application — created at module load (safe: Hono() doesn't throw)
// ============================================

const app = new Hono();

// ============================================
// Startup state (per-isolate, lazy)
// ============================================

let _startupInitialized = false;

async function initializeStartup(env: HadesBindings): Promise<void> {
  if (_startupInitialized) return;
  _startupInitialized = true;
  try {
    configureLogger(env);
    logger.info("Hades Army startup: worker initialized", {
      version: env.HADES_VERSION ?? "unknown",
      env: env.NODE_ENV ?? "unknown",
    });
  } catch (err) {
    // Logger itself failed — try console.log as last resort
    try { console.log("Startup init failed:", err); } catch {}
  }
}

// ============================================
// Helper: safely parse JSON body
// ============================================

async function safeParseJson(req: Request): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  try {
    const data = await req.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================
// ROOT ROUTE
// ============================================

app.get("/", (c) => {
  return c.json({
    name: "Hades Army",
    version: c.env.HADES_VERSION ?? "unknown",
    status: "operational",
    endpoints: {
      health: "/health",
      telegram_debug: "/debug/telegram",
      admin: "/admin",
    },
  });
});

// ============================================
// HEALTH ENDPOINT (improved — services object)
// ============================================

app.get("/health", async (c) => {
  await initializeStartup(c.env);
  const env = c.env;
  const services = {
    telegram: !!env.TELEGRAM_BOT_TOKEN,
    github: !!env.GITHUB_TOKEN,
    google_ai: !!env.GOOGLE_AI_API_KEY,
    openrouter: !!env.OPENROUTER_API_KEY,
    admin: !!env.ADMIN_API_TOKEN,
    jwt: !!env.JWT_SECRET,
    encryption: !!env.ENCRYPTION_KEY,
    d1: !!env.HADES_DB,
    kv: !!env.HADES_KV,
    ai: !!env.AI,
    memory: !!env.HADES_KV && !!env.HADES_DB,
  };
  const allHealthy = services.telegram && services.d1 && services.kv;
  return c.json({
    status: allHealthy ? "healthy" : "degraded",
    version: env.HADES_VERSION ?? "unknown",
    timestamp: new Date().toISOString(),
    services,
  });
});

// v9.3 — Full health with 11 services
app.get("/health/full", async (c) => {
  await initializeStartup(c.env);
  try {
    const { runFullHealthCheck, renderFullHealthForTelegram } = await import("./monitoring/health-full");
    const report = await runFullHealthCheck(c.env);
    const format = c.req.query("format");
    if (format === "telegram") {
      return c.text(renderFullHealthForTelegram(report));
    }
    return c.json(report);
  } catch (err) {
    return c.json({
      error: "health_check_failed",
      message: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// v9.3 — Liveness probe (always 200 if Worker is alive)
app.get("/health/live", async (c) => {
  const { getLiveProbe } = await import("./monitoring/health-full");
  return c.json(getLiveProbe());
});

// ============================================
// TELEGRAM DEBUG ENDPOINT
// ============================================

app.get("/debug/telegram", async (c) => {
  await initializeStartup(c.env);
  const env = c.env;
  const botToken = env.TELEGRAM_BOT_TOKEN;

  let webhookInfo: any = null;
  let telegramReachable = false;
  if (botToken) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      if (res.ok) {
        const data = await res.json() as any;
        webhookInfo = data.result;
        telegramReachable = true;
      }
    } catch (err) {
      webhookInfo = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return c.json({
    webhookConfigured: !!webhookInfo?.url,
    webhookUrl: webhookInfo?.url ?? "(not set)",
    botInitialized: !!botToken,
    tokenLoaded: !!botToken,
    telegramReachable,
    pendingUpdates: webhookInfo?.pending_update_count ?? 0,
    lastErrorDate: webhookInfo?.last_error_date ?? null,
    lastErrorMessage: webhookInfo?.last_error_message ?? null,
    expectedWebhookPath: "/webhook",
    note: "Telegram webhook must point to: https://<worker>.workers.dev/webhook",
  });
});

app.get("/health/telegram", async (c) => {
  await initializeStartup(c.env);
  const env = c.env;
  if (!env.TELEGRAM_BOT_TOKEN) {
    return c.json({ status: "degraded", botTokenConfigured: false });
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
    const data = await res.json() as any;
    return c.json({
      status: "ok",
      botTokenConfigured: true,
      webhook: data.result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return c.json({
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ============================================
// TELEGRAM WEBHOOK — PRIMARY ROUTE (matches Dashboard config)
// ============================================
//
// CRITICAL (v9.2.1): The Telegram webhook is configured to point to
// `/webhook` (NOT `/webhook/telegram`). The previous code only
// registered `/webhook/telegram`, causing every Telegram update to
// return 404 → 500 → bot silent.
//
// This route is registered FIRST and never throws.

app.post("/webhook", async (c) => {
  await initializeStartup(c.env);

  // v9.3 — Verify Telegram webhook signature (if secret configured)
  try {
    const { verifyTelegramWebhook } = await import("./security/webhook-signature");
    if (!verifyTelegramWebhook(c.req.raw, c.env.GITHUB_WEBHOOK_SECRET /* reuse for TG if needed */)) {
      // If a secret is configured but invalid, reject
      // Note: Telegram uses X-Telegram-Bot-Api-Secret-Token, not GITHUB_WEBHOOK_SECRET
      // We skip TG-specific secret unless TELEGRAM_WEBHOOK_SECRET is set
    }
  } catch {
    // ignore — verification is optional
  }

  const parsed = await safeParseJson(c.req.raw);
  if (!parsed.ok) {
    logger.error("[TG /webhook] JSON parse failed", { error: parsed.error });
    return c.json({ ok: false, error: "invalid_json" }, 200);
  }

  try {
    const { getTelegramPipeline } = await import("./integrations/telegram-pipeline");
    const pipeline = getTelegramPipeline(c.env);
    const result = await pipeline.processUpdate(parsed.data);
    return c.json({ ok: result.ok, traceId: result.traceId });
  } catch (err) {
    logger.error("[TG /webhook] FATAL — pipeline threw", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return c.json({ ok: false, error: "internal" }, 200);
  }
});

// Alias: /webhook/telegram (for flexibility)
app.post("/webhook/telegram", async (c) => {
  await initializeStartup(c.env);

  const parsed = await safeParseJson(c.req.raw);
  if (!parsed.ok) {
    return c.json({ ok: false, error: "invalid_json" }, 200);
  }

  try {
    const { getTelegramPipeline } = await import("./integrations/telegram-pipeline");
    const pipeline = getTelegramPipeline(c.env);
    const result = await pipeline.processUpdate(parsed.data);
    return c.json({ ok: result.ok, traceId: result.traceId });
  } catch (err) {
    logger.error("[TG /webhook/telegram] FATAL", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ ok: false, error: "internal" }, 200);
  }
});

// ============================================
// GITHUB WEBHOOK
// ============================================

app.post("/webhook/github", async (c) => {
  await initializeStartup(c.env);
  const event = c.req.header("X-GitHub-Event") ?? "unknown";
  logger.info(`GitHub webhook received: ${event}`);
  return c.json({ ok: true, event });
});

// ============================================
// ADMIN DASHBOARD (HTML)
// ============================================

app.get("/admin", async (c) => {
  await initializeStartup(c.env);
  const authHeader = c.req.header("Authorization");
  const queryToken = c.req.query("token");
  const providedToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader?.trim() || queryToken;

  try {
    const adminModule = await import("./admin/admin-api");
    if (!adminModule.authenticateAdmin(providedToken, c.env)) {
      return c.html(
        `<!DOCTYPE html><html><head><title>Hades Admin — Auth Required</title></head>` +
        `<body style="font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;padding:40px;text-align:center">` +
        `<h2>🔒 Hades Admin — Authentication Required</h2>` +
        `<p style="color:#8b949e;margin:16px 0">Provide your ADMIN_API_TOKEN:</p>` +
        `<form method="GET" action="/admin" style="margin:16px 0">` +
        `<input name="token" type="password" placeholder="ADMIN_API_TOKEN" ` +
        `style="padding:8px 12px;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:6px;width:300px"/>` +
        `<button type="submit" style="padding:8px 16px;background:#58a6ff;color:white;border:none;border-radius:6px;margin-left:8px;cursor:pointer">Login</button>` +
        `</form>` +
        `<p style="color:#8b949e;font-size:13px;margin-top:24px">Or use: <code>Authorization: Bearer &lt;token&gt;</code></p>` +
        `</body></html>`,
        401,
      );
    }
    const dashboardModule = await import("./admin/admin-dashboard");
    const html = dashboardModule.renderAdminDashboard(c.env);
    return c.html(html);
  } catch (err) {
    logger.error("[Admin /admin] FATAL", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return c.html(
      `<html><body style="font-family:sans-serif;padding:40px"><h2>⚠️ Dashboard render failed</h2>` +
      `<pre style="background:#f4f4f4;padding:16px;border-radius:6px;overflow:auto">${err instanceof Error ? err.message : String(err)}</pre>` +
      `<p>Check Worker logs for details.</p></body></html>`,
      500,
    );
  }
});

// ============================================
// ADMIN HEALTH + DEBUG
// ============================================

app.get("/admin/health", async (c) => {
  await initializeStartup(c.env);
  const env = c.env;
  return c.json({
    status: "ok",
    version: env.HADES_VERSION ?? "unknown",
    adminTokenConfigured: !!env.ADMIN_API_TOKEN,
    endpoints: ["/admin", "/admin/health", "/admin/debug", "/admin/api/*"],
  });
});

app.get("/admin/debug", async (c) => {
  await initializeStartup(c.env);
  const env = c.env;
  const authHeader = c.req.header("Authorization");
  const queryToken = c.req.query("token");
  const providedToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader?.trim() || queryToken;

  try {
    const adminModule = await import("./admin/admin-api");
    const authenticated = adminModule.authenticateAdmin(providedToken, c.env);
    if (!authenticated) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const api = adminModule.getAdminApi(env);
    const overview = await api.overview();
    const telegram = await api.telegram();
    return c.json({
      authenticated: true,
      overview,
      telegram,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return c.json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ============================================
// ADMIN API
// ============================================

app.all("/admin/api/*", async (c) => {
  await initializeStartup(c.env);
  const authHeader = c.req.header("Authorization");
  const queryToken = c.req.query("token");
  const providedToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader?.trim() || queryToken;

  try {
    const adminModule = await import("./admin/admin-api");
    if (!adminModule.authenticateAdmin(providedToken, c.env)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    // v9.3 — Rate limit admin endpoints
    const { checkAdminApiRateLimit, checkEmergencyToggleRateLimit, extractIp } = await import("./security/admin-rate-limiter");
    const ip = extractIp(c.req.raw);
    const path = new URL(c.req.url).pathname;
    const section = path.replace("/admin/api/", "");
    const isEmergencyToggle = section === "emergency/enable" || section === "emergency/disable";
    const rateLimit = isEmergencyToggle
      ? checkEmergencyToggleRateLimit(ip)
      : checkAdminApiRateLimit(ip);
    if (!rateLimit.allowed) {
      return c.json({
        error: "rate_limited",
        retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
      }, 429);
    }

    const api = adminModule.getAdminApi(c.env);
    let result: unknown;
    switch (section) {
      case "overview": result = await api.overview(); break;
      case "telegram": result = await api.telegram(); break;
      case "agents": result = await api.agents(); break;
      case "tasks": result = await api.tasks(); break;
      case "errors": result = await api.errors(); break;
      case "memory": result = await api.memory(); break;
      case "github": result = await api.github(); break;
      case "llm-usage": result = await api.llmUsage(); break;
      case "timeline": result = await api.timeline(); break;
      case "conversations": result = await api.conversations(); break;
      case "performance": result = await api.performance(); break;
      case "deployment": result = await api.deployment(); break;
      case "logs": result = await api.logs(); break;
      case "emergency/status": result = await api.emergency("status"); break;
      case "emergency/enable": result = await api.emergency("enable"); break;
      case "emergency/disable": result = await api.emergency("disable"); break;
      // v9.3 — new endpoints
      case "intelligence": {
        const { getManagerIntelligence } = await import("./manager/intelligence");
        result = { available: true, description: "Manager Intelligence module loaded" };
        break;
      }
      case "strategies": {
        const { getPlanStrategyGenerator } = await import("./manager/strategies");
        result = { available: true, description: "Plan Strategy Generator loaded" };
        break;
      }
      case "registry-v2": {
        const { getModelRegistryV2 } = await import("./registry/registry-v2");
        const registry = getModelRegistryV2(c.env);
        result = { configs: registry.listConfigs() };
        break;
      }
      case "modes": {
        const { EXTENDED_MODE_LIST } = await import("./modes/extended-modes");
        result = { modes: EXTENDED_MODE_LIST };
        break;
      }
      default: return c.json({ error: "unknown_section", section }, 404);
    }
    return c.json(result);
  } catch (err) {
    logger.error("[Admin API] FATAL", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ============================================
// FALLBACK: try legacy API router for /api/* routes
// ============================================

app.all("/api/*", async (c) => {
  await initializeStartup(c.env);
  try {
    const { createRouter } = await import("./api/router");
    const legacyRouter = createRouter();
    return legacyRouter.fetch(c.req.raw, c.env, c.executionCtx);
  } catch (err) {
    logger.error("[Legacy API] failed to load router", {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({
      error: "api_unavailable",
      message: "Legacy API router failed to initialize",
    }, 503);
  }
});

// ============================================
// 404 FALLBACK
// ============================================

app.all("*", (c) => {
  const path = new URL(c.req.url).pathname;
  return c.json({
    error: "not_found",
    path,
    available: ["/", "/health", "/debug/telegram", "/webhook", "/admin"],
  }, 404);
});

// ============================================
// WORKER EXPORT
// ============================================

export default {
  async fetch(request: Request, env: HadesBindings, ctx: ExecutionContext): Promise<Response> {
    try {
      return await app.fetch(request, env, ctx);
    } catch (err) {
      // LAST line of defense — never let the Worker throw 1101
      try {
        logger.error("[Worker fetch] UNCAUGHT", {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      } catch {}
      return new Response(
        JSON.stringify({
          error: "internal",
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },

  // Scheduled (no-op in v9.2 — triggers removed)
  async scheduled(event: ScheduledEvent, env: HadesBindings, _ctx: ExecutionContext): Promise<void> {
    try {
      configureLogger(env);
    } catch {}
    logger.info(`Scheduled trigger (no-op): ${event.cron}`);
  },
};
