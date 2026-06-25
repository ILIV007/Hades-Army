
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

function initializeStartup(env: HadesBindings): SecretValidationResult {
  if (!_startupInitialized) {
    configureLogger(env);
    _startupValidation = validateSecretsAtStartup(env);
    _startupInitialized = true;

    // Log the startup result (without leaking secret values)
    if (_startupValidation.ok) {
      logger.info("Hades Army startup: all critical secrets present", {
        version: env.HADES_VERSION ?? "unknown",
        checked: _startupValidation.checked.length,
      });
    } else {
      logger.warn("Hades Army startup: missing critical secrets — running in degraded mode", {
        missing: _startupValidation.missing,
        warnings: _startupValidation.warnings,
      });
    }
  }
  return _startupValidation!;
}

// Run startup init on every request (cheap — cached after first call)
app.use("*", async (c, next) => {
  initializeStartup(c.env);
  await next();
});

// ============================================
// Telegram Webhook Route
// ============================================

app.post("/webhook/telegram", async (c) => {
  const bot = createTelegramBot(c.env);
  if (!bot) {
    return c.json({ error: "Telegram bot not configured" }, 503);
  }
  return bot.handleWebhook(c.req.raw);
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
  async scheduled(
    event: ScheduledEvent,
    env: Record<string, unknown>,
    ctx: ExecutionContext
  ): Promise<void> {
    // Initialize logger + validate secrets (cron may fire before any HTTP request)
    initializeStartup(env as HadesBindings);
    logger.info(`Scheduled task triggered: ${event.cron}`);

    ctx.waitUntil(
      (async () => {
        try {
          switch (event.cron) {
            case "*/5 * * * *":
              // Every 5 minutes: Health check
              await healthService.getHealthReport(env as Record<string, unknown>);
              break;

            case "0 * * * *":
              // Every hour: Metrics collection
              await metricsService.collectAll(env as Record<string, unknown>);
              break;

            case "0 0 * * *":
              // Daily: Cleanup expired data
              await memoryManager.cleanupExpired(env as Record<string, unknown>);
              await approvalManager.processExpiredRequests(env as Record<string, unknown>);
              break;

            default:
              logger.info(`Unknown cron schedule: ${event.cron}`);
          }
        } catch (err) {
          logger.error("Scheduled task error", { error: err instanceof Error ? err.message : String(err) });
        }
      })()
    );
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
