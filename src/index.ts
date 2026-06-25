
/**
 * Hades Army - Cloudflare Workers Entry Point
 * Hades Army v0.8.0
 *
 * Hono-based HTTP server with:
 * - REST API
 * - Telegram webhook
 * - GitHub webhook
 * - Health checks
 * - Scheduled tasks (Cron Triggers)
 */

import { Hono } from "hono";
import { createRouter } from "./api/router";
import { createTelegramBot } from "./integrations/telegram-bot";
import { createGitHubClient } from "./integrations/github";
import { monitoringService } from "./monitoring/service";
import { healthService } from "./monitoring/health";
import { metricsService } from "./monitoring/metrics";
import { alertService } from "./monitoring/alerts";
import { securityManager } from "./security/manager";
import { memoryManager } from "./memory/manager";
import { approvalManager } from "./approval/manager";
import { rollbackManager } from "./rollback/manager";
import { promptManager } from "./prompts/manager";
import { workersManager } from "./workers/manager";
import { schedulerManager } from "./scheduler/manager";
import { logger, configureLogger } from "./utils/logger";
import { validateSecretsAtStartup, type SecretValidationResult } from "./security/startup-validator";
import { getControlledCrashValidator, type StartupCheckResult } from "./security/controlled-crash-validator";
import { getConfigDriftDetector } from "./security/config-drift-detector";
import { generateId } from "./utils/helpers";
import { appManager } from "./core/application";
import type { HadesContext, HadesBindings } from "./types";

// ============================================
// Main Application
// ============================================

const app = createRouter();

// ============================================
// Startup Initialization (per-Worker, cached)
// ============================================
//
// Cloudflare Workers are stateless across isolates, but each isolate
// handles many requests. We configure the logger and validate secrets
// ONCE per isolate, on the first request it sees. Subsequent requests
// reuse the cached configuration.

let _startupInitialized = false;
let _startupValidation: SecretValidationResult | null = null;
let _startupCheck: StartupCheckResult | null = null;

function initializeStartup(env: HadesBindings): StartupCheckResult {
  if (!_startupInitialized) {
    configureLogger(env);
    const crashValidator = getControlledCrashValidator();
    _startupCheck = crashValidator.check(env);
    _startupValidation = _startupCheck.result;
    _startupInitialized = true;

    // Log the startup result (without leaking secret values)
    if (_startupCheck.ok) {
      logger.info("Hades Army startup: all critical secrets present", {
        version: env.HADES_VERSION ?? "unknown",
        checked: _startupValidation.checked.length,
      });
    } else if (_startupCheck.blockingWorkflow) {
      logger.error("Hades Army startup: BLOCKED — missing workflow-critical secrets", {
        missing: _startupValidation.missing,
        blockedRoutes: _startupCheck.blockedRoutes,
      });
    } else {
      logger.warn("Hades Army startup: running in degraded mode", {
        warnings: _startupValidation.warnings,
      });
    }

    // Also check config drift (passive — warnings only)
    try {
      const driftDetector = getConfigDriftDetector();
      const drift = driftDetector.detect(env);
      if (drift.hasDrift) {
        logger.warn("Hades Army startup: config drift detected", {
          driftCount: drift.driftCount,
          items: drift.items.map((i) => `${i.name} (${i.issue})`),
        });
      }
    } catch (err) {
      logger.warn("Hades Army startup: drift check failed", { err });
    }
  }
  return _startupCheck!;
}

// Run startup init on every request (cheap — cached after first call)
// Also gate workflow-blocking routes when critical secrets are missing.
app.use("*", async (c, next) => {
  const check = initializeStartup(c.env);

  // If the Worker is in blocking mode, refuse workflow-related routes
  // with a clear 503 error. Health and static routes still work.
  if (check.blockingWorkflow) {
    const path = new URL(c.req.url).pathname;
    if (check.blockedRoutes.some((route) => path.startsWith(route))) {
      const validator = getControlledCrashValidator();
      const errBody = validator.renderBlockedResponse(check.result.missing);
      return c.json(errBody.body, errBody.status);
    }
  }

  await next();
});

// ============================================
// Telegram Webhook Route (v9.2 — uses hardened pipeline)
// ============================================
//
// CRITICAL FIX (v9.2): The webhook now routes through the new
// TelegramPipeline which guarantees:
//   1. Every update gets a response (no silent failures)
//   2. Manager startup failures are isolated
//   3. Memory failures are non-fatal
//   4. Mode defaults to "plan" if missing
//   5. Missing project → onboarding guidance (not silent return)
//   6. Mandatory fallback message on any error

app.post("/webhook/telegram", async (c) => {
  // Initialize startup (logger + secret validation) — but NEVER
  // block the Telegram webhook. Even if critical secrets are
  // missing, the bot must respond with a clear message.
  try {
    initializeStartup(c.env);
  } catch {
    // ignore — startup validation may fail in degraded mode,
    // but Telegram must still respond
  }

  let update: any;
  try {
    update = await c.req.json();
  } catch (err) {
    logger.error("[TG Webhook] Failed to parse JSON body", {
      err: err instanceof Error ? err.message : String(err),
    });
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }

  // Delegate to the hardened pipeline — it NEVER throws
  const { getTelegramPipeline } = await import("./integrations/telegram-pipeline");
  const pipeline = getTelegramPipeline(c.env);
  const result = await pipeline.processUpdate(update);

  // Always return 200 OK so Telegram doesn't retry
  return c.json({ ok: result.ok, traceId: result.traceId });
});

// ============================================
// Health Endpoints (v9.2)
// ============================================

app.get("/health", async (c) => {
  return c.json({
    status: "ok",
    version: c.env.HADES_VERSION ?? "unknown",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health/telegram", async (c) => {
  const botToken = c.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return c.json({
      status: "degraded",
      botTokenConfigured: false,
      message: "TELEGRAM_BOT_TOKEN not set",
    });
  }

  try {
    const { getTelegramService } = await import("./integrations/telegram-service");
    const service = getTelegramService(c.env);
    if (!service) {
      return c.json({ status: "degraded", message: "Service initialization failed" });
    }
    const webhookInfo = await service.getWebhookInfo();
    return c.json({
      status: webhookInfo.ok ? "ok" : "degraded",
      botTokenConfigured: true,
      webhook: webhookInfo.info,
      error: webhookInfo.error,
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
// Admin Debug Center (v9.2)
// ============================================
//
// Protected by ADMIN_API_TOKEN. Normal users must never access this.
// Serves:
//   GET  /admin                → HTML dashboard
//   GET  /admin/api/<section>  → JSON data for each section
//   POST /admin/api/emergency/{enable|disable}

app.get("/admin", async (c) => {
  const authHeader = c.req.header("Authorization") ?? c.req.query("token");
  const { authenticateAdmin } = await import("./admin/admin-api");
  if (!authenticateAdmin(authHeader, c.env)) {
    return c.html(
      `<html><body style="font-family:sans-serif;padding:40px;text-align:center">
      <h2>🔒 Hades Admin — Authentication Required</h2>
      <p>Provide <code>Authorization: Bearer &lt;ADMIN_API_TOKEN&gt;</code> header or <code>?token=&lt;ADMIN_API_TOKEN&gt;</code> query parameter.</p>
      </body></html>`,
      401,
    );
  }
  const { renderAdminDashboard } = await import("./admin/admin-dashboard");
  return c.html(renderAdminDashboard(c.env));
});

app.all("/admin/api/*", async (c) => {
  const authHeader = c.req.header("Authorization") ?? c.req.query("token");
  const { authenticateAdmin, getAdminApi } = await import("./admin/admin-api");
  if (!authenticateAdmin(authHeader, c.env)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const path = new URL(c.req.url).pathname;
  const section = path.replace("/admin/api/", "");
  const api = getAdminApi(c.env);

  try {
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
      default: return c.json({ error: "unknown_section", section }, 404);
    }
    return c.json(result);
  } catch (err) {
    logger.error("Admin API error", { section, err: err instanceof Error ? err.message : String(err) });
    return c.json({ error: "internal", section, message: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ============================================
// GitHub Webhook Route
// ============================================

app.post("/webhook/github", async (c) => {
  const signature = c.req.header("X-Hub-Signature-256");
  const event = c.req.header("X-GitHub-Event");
  const delivery = c.req.header("X-GitHub-Delivery");

  const body = await c.req.text();

  logger.info(`GitHub webhook received: ${event} (${delivery})`);

  // In production, verify signature
  // const client = createGitHubClient(c.env);
  // if (client && signature) {
  //   const isValid = client.verifyWebhookSignature(body, signature, c.env.GITHUB_WEBHOOK_SECRET || "");
  //   if (!isValid) {
  //     return c.json({ error: "Invalid signature" }, 401);
  //   }
  // }

  try {
    const payload = JSON.parse(body);

    // Handle different GitHub events
    switch (event) {
      case "push":
        logger.info(`Push to ${payload.repository?.full_name}: ${payload.ref}`);
        break;
      case "pull_request":
        logger.info(`PR ${payload.action}: #${payload.pull_request?.number} ${payload.pull_request?.title}`);
        break;
      case "pull_request_review":
        logger.info(`PR Review ${payload.action}: #${payload.pull_request?.number}`);
        break;
      case "issues":
        logger.info(`Issue ${payload.action}: #${payload.issue?.number} ${payload.issue?.title}`);
        break;
      default:
        logger.info(`GitHub event: ${event}`);
    }

    return c.json({ received: true, event });
  } catch (err) {
    logger.error("GitHub webhook error", { error: err instanceof Error ? err.message : String(err) });
    return c.json({ received: true, error: "Invalid payload" });
  }
});

// ============================================
// Metrics Export Route (Prometheus)
// ============================================

app.get("/metrics", async (c) => {
  const prometheusMetrics = await metricsService.exportToPrometheus(c.env);
  return new Response(prometheusMetrics, {
    headers: { "Content-Type": "text/plain; version=0.0.4" },
  });
});

// ============================================
// Worker Export
// ============================================

export default {
  // HTTP request handler
  async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext): Promise<Response> {
    // Initialize logger + validate secrets on first request per isolate
    initializeStartup(env as HadesBindings);

    // Set up request context
    const requestId = generateId("req");
    const startTime = Date.now();

    logger.info(`Request started: ${request.method} ${request.url}`, { requestId });

    // Increment request counter
    appManager.incrementRequests();

    try {
      // Bind environment to Hono context
      const response = await app.fetch(request, env, ctx);

      const duration = Date.now() - startTime;
      logger.info(`Request completed: ${request.method} ${request.url}`, {
        requestId,
        duration: `${duration}ms`,
        status: response.status,
      });

      // Record metrics
      await metricsService.incrementCounter(env as Record<string, unknown>, "http_requests_total", 1, {
        method: request.method,
        status: String(response.status),
      });

      await metricsService.recordHistogram(
        env as Record<string, unknown>,
        "http_request_duration_ms",
        duration,
        { method: request.method }
      );

      return response;
    } catch (err) {
      appManager.incrementErrors();

      const duration = Date.now() - startTime;
      logger.error(`Request failed: ${request.method} ${request.url}`, {
        requestId,
        duration: `${duration}ms`,
        error: err instanceof Error ? err.message : String(err),
      });

      // Record error metric
      await metricsService.incrementCounter(env as Record<string, unknown>, "http_errors_total", 1, {
        method: request.method,
      });

      throw err;
    }
  },

  // Scheduled task handler (Cron Triggers)
  // ============================================
  // v0.9.2: Cron triggers are DISABLED in wrangler.toml because they
  // were failing to deploy. This handler is kept as a no-op so it
  // doesn't break the Worker export shape — once the background jobs
  // (memory cleanup, learning engine, queue processing) are properly
  // implemented, re-enable [triggers] in wrangler.toml and restore
  // the switch statement below.
  // ============================================
  async scheduled(
    event: ScheduledEvent,
    env: Record<string, unknown>,
    _ctx: ExecutionContext
  ): Promise<void> {
    try {
      initializeStartup(env as HadesBindings);
    } catch {
      // ignore — startup validation may fail in degraded mode
    }
    logger.info(`Scheduled task triggered (no-op in v0.9.2): ${event.cron}`);
    // No work performed — see comment above.
  },

  // Queue handler (for Cloudflare Queue)
  async queue(
    batch: MessageBatch<unknown>,
    env: Record<string, unknown>,
    ctx: ExecutionContext
  ): Promise<void> {
    logger.info(`Queue batch received: ${batch.queue} (${batch.messages.length} messages)`);

    for (const message of batch.messages) {
      ctx.waitUntil(
        (async () => {
          try {
            const payload = message.body as Record<string, unknown>;

            if (payload.type === "job") {
              await workersManager.processJob(
                env as Record<string, unknown>,
                payload.jobId as string
              );
            } else if (payload.type === "notification") {
              // Handle notification
              logger.info("Processing notification", payload);
            }

            message.ack();
          } catch (err) {
            logger.error("Queue message error", { error: err instanceof Error ? err.message : String(err) });
            message.retry();
          }
        })()
      );
    }
  },
};
