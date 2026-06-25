/**
 * Admin Debug Center Backend - Cloudflare Workers Edition
 * Hades Army v9.2 — Admin Debug Center
 *
 * Provides JSON API endpoints for the Admin Debug Center dashboard.
 * ALL endpoints require authentication via ADMIN_API_TOKEN.
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";
import { runHealthCheck } from "../monitoring/health-dashboard";
import { getRecentTelegramEvents, getTelegramService } from "../integrations/telegram-service";
import { getAgentDiagnostics } from "../orchestration/agent-diagnostics";
import { getAgentLogger, getTaskTimelineTracker } from "../monitoring/task-timeline";
import { getMemorySyncEngine } from "../memory/memory-sync.service";
import { ModelRegistry } from "../registry/model-registry";
import { getCostTracker } from "../monitoring/cost-tracker";
import { getAgentMetrics } from "../monitoring/agent-metrics";
import { getControlledCrashValidator } from "../security/controlled-crash-validator";
import { getConfigDriftDetector } from "../security/config-drift-detector";

// ============================================
// Emergency mode (in-memory, per-isolate)
// ============================================

let _emergencyMode = false;

export function isEmergencyMode(): boolean {
  return _emergencyMode;
}

export function setEmergencyMode(enabled: boolean): void {
  _emergencyMode = enabled;
  logger.warn(`Admin: Emergency Mode ${enabled ? "ENABLED" : "DISABLED"}`);
  if (enabled) {
    logger.warn("Admin: Emergency Mode — Builder, Reviewer, GitHub Actions, Background Jobs are DISABLED");
  }
}

// ============================================
// Error log (in-memory, per-isolate)
// ============================================

export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  component: "telegram" | "manager" | "builder" | "reviewer" | "memory" | "database" | "github" | "llm" | "deployment" | "unknown";
  severity: "info" | "warning" | "error" | "critical";
  message: string;
  stack?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

const errorLog: ErrorLogEntry[] = [];
const MAX_ERRORS = 500;

export function recordError(entry: Omit<ErrorLogEntry, "id" | "timestamp">): ErrorLogEntry {
  const full: ErrorLogEntry = {
    ...entry,
    id: generateId("err"),
    timestamp: new Date().toISOString(),
  };
  errorLog.push(full);
  if (errorLog.length > MAX_ERRORS) errorLog.splice(0, errorLog.length - MAX_ERRORS);
  return full;
}

export function getErrorLog(limit = 100, severity?: ErrorLogEntry["severity"]): ErrorLogEntry[] {
  const filtered = severity ? errorLog.filter((e) => e.severity === severity) : errorLog;
  return filtered.slice(-limit).reverse();
}

// ============================================
// Auth
// ============================================

export function authenticateAdmin(authHeader: string | undefined, env: HadesBindings): boolean {
  if (!env.ADMIN_API_TOKEN) return false;
  if (!authHeader) return false;
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.trim();
  return token === env.ADMIN_API_TOKEN;
}

// ============================================
// Admin API
// ============================================

export class AdminApi {
  private env: HadesBindings;

  constructor(env: HadesBindings) {
    this.env = env;
  }

  async overview(): Promise<unknown> {
    const health = await runHealthCheck(this.env);
    const drift = getConfigDriftDetector().detect(this.env);
    const crashValidator = getControlledCrashValidator();
    const startupCheck = crashValidator.check(this.env);

    return {
      worker: {
        status: health.overall,
        version: this.env.HADES_VERSION ?? "unknown",
        environment: this.env.NODE_ENV ?? "unknown",
        compatibilityDate: "2024-06-14",
        buildTimestamp: new Date().toISOString(),
      },
      components: health.components.map((c) => ({
        name: c.name,
        emoji: c.emoji,
        status: c.status,
        detail: c.detail,
        latencyMs: c.latencyMs,
      })),
      secrets: {
        ok: startupCheck.ok,
        blockingWorkflow: startupCheck.blockingWorkflow,
        missing: startupCheck.result.missing,
        warnings: startupCheck.result.warnings,
      },
      configDrift: {
        hasDrift: drift.hasDrift,
        driftCount: drift.driftCount,
        items: drift.items,
      },
      emergencyMode: isEmergencyMode(),
      checkedAt: new Date().toISOString(),
    };
  }

  async telegram(): Promise<unknown> {
    const events = getRecentTelegramEvents(50);
    const service = getTelegramService(this.env);
    let webhookInfo: any = null;
    if (service) {
      const info = await service.getWebhookInfo();
      webhookInfo = info.info;
    }
    const lastReceived = events.find((e) => e.kind === "update_received");
    const lastSent = events.find((e) => e.kind === "sent");
    const lastFailed = events.find((e) => e.kind === "failed");
    const sentCount = events.filter((e) => e.kind === "sent").length;
    const failedCount = events.filter((e) => e.kind === "failed").length;
    const successRate = sentCount + failedCount > 0
      ? Math.round((sentCount / (sentCount + failedCount)) * 100)
      : 100;
    return {
      webhook: {
        active: !!webhookInfo && !webhookInfo?.pending_update_count,
        url: webhookInfo?.url ?? "(not set)",
        pendingUpdates: webhookInfo?.pending_update_count ?? 0,
        lastErrorDate: webhookInfo?.last_error_date ?? null,
        lastErrorMessage: webhookInfo?.last_error_message ?? null,
      },
      lastUpdate: lastReceived
        ? { timestamp: lastReceived.timestamp, userId: lastReceived.userId, chatId: lastReceived.chatId, text: lastReceived.text }
        : null,
      lastResponse: lastSent
        ? { timestamp: lastSent.timestamp, preview: lastSent.responsePreview, durationMs: lastSent.durationMs }
        : null,
      lastFailure: lastFailed
        ? { timestamp: lastFailed.timestamp, preview: lastFailed.responsePreview, error: lastFailed.error }
        : null,
      stats: { totalEvents: events.length, sentCount, failedCount, successRate },
      recentEvents: events.slice(0, 20),
      botTokenConfigured: !!this.env.TELEGRAM_BOT_TOKEN,
    };
  }

  async agents(): Promise<unknown> {
    const diagnostics = await getAgentDiagnostics(this.env).run();
    const metrics = getAgentMetrics(this.env).getSummary();
    return {
      agents: diagnostics.agents.map((a) => ({
        role: a.role,
        provider: a.provider,
        model: a.model,
        available: a.available,
        status: a.status,
        detail: a.detail,
        stats: a.role === "manager" ? metrics.manager : a.role === "builder" ? metrics.builder : metrics.reviewer,
      })),
      registryCompliant: diagnostics.registryCompliant,
      hardcodedModelViolations: diagnostics.hardcodedModelViolations,
    };
  }

  async tasks(): Promise<unknown> {
    return {
      activeTasks: [],
      recentWorkflows: [],
      message: "Task monitor — populate from D1 workflows table in production",
    };
  }

  async errors(): Promise<unknown> {
    return {
      recent: getErrorLog(50),
      critical: getErrorLog(20, "critical"),
      warnings: getErrorLog(20, "warning"),
      stats: {
        total: errorLog.length,
        critical: errorLog.filter((e) => e.severity === "critical").length,
        error: errorLog.filter((e) => e.severity === "error").length,
        warning: errorLog.filter((e) => e.severity === "warning").length,
        info: errorLog.filter((e) => e.severity === "info").length,
      },
    };
  }

  async memory(): Promise<unknown> {
    const sync = getMemorySyncEngine(this.env);
    const health = await sync.getHealth();
    return {
      kv: { available: health.kvAvailable, keysCount: health.kvKeysCount },
      d1: { available: health.d1Available, tablesCount: health.d1TablesCount },
      repository: { available: health.repoMemoryAvailable, filesCount: health.repoMemoryFilesCount },
      sync: { lastSyncAt: health.lastSyncAt, lastSyncOk: health.lastSyncOk, warnings: health.warnings },
    };
  }

  async github(): Promise<unknown> {
    return {
      tokenConfigured: !!this.env.GITHUB_TOKEN,
      connectedRepositories: 0,
      lastCommit: null,
      lastPR: null,
      branchCount: 0,
      openPRs: 0,
      failedOperations: 0,
      rateLimitStatus: "unknown",
    };
  }

  async llmUsage(): Promise<unknown> {
    const costTracker = getCostTracker(this.env);
    const agentLogger = getAgentLogger(this.env);
    const summary = await agentLogger.getSummary();
    const todayCost = costTracker.getSummary("today");
    const monthCost = costTracker.getSummary("month");
    return {
      today: {
        totalCostUsd: todayCost.totalCostUsd,
        totalTokensIn: todayCost.totalInputTokens,
        totalTokensOut: todayCost.totalOutputTokens,
        byAgent: todayCost.byAgent,
        byProvider: todayCost.byProvider,
      },
      month: {
        totalCostUsd: monthCost.totalCostUsd,
        totalTokensIn: monthCost.totalInputTokens,
        totalTokensOut: monthCost.totalOutputTokens,
      },
      agentCalls: summary,
    };
  }

  async timeline(): Promise<unknown> {
    const events = getRecentTelegramEvents(30).map((e) => ({
      timestamp: e.timestamp,
      kind: e.kind,
      chatId: e.chatId,
      userId: e.userId,
      text: e.text,
      error: e.error,
    }));
    return { events };
  }

  async conversations(): Promise<unknown> {
    return {
      message: "Conversation inspector — query conversation_states table",
      privacy: { systemPromptsHidden: true, secretsHidden: true, chainOfThoughtHidden: true },
    };
  }

  async performance(): Promise<unknown> {
    const agentLogger = getAgentLogger(this.env);
    const summary = await agentLogger.getSummary();
    return {
      averageResponseTimeMs: summary.avgResponseMs,
      agentDurations: summary.byAgent.map((a) => ({ agent: a.role, avgResponseMs: a.avgResponseMs })),
      memorySyncTime: "n/a",
      databaseQueryTime: "n/a",
      githubApiLatency: "n/a",
      telegramApiLatency: "n/a",
    };
  }

  async deployment(): Promise<unknown> {
    const drift = getConfigDriftDetector().detect(this.env);
    return {
      version: this.env.HADES_VERSION ?? "unknown",
      environment: this.env.NODE_ENV ?? "unknown",
      compatibilityDate: "2024-06-14",
      buildTimestamp: new Date().toISOString(),
      bindings: {
        d1: !!this.env.HADES_DB,
        kv: !!this.env.HADES_KV,
        ai: !!this.env.AI,
        r2: !!this.env.HADES_R2,
      },
      configDrift: drift,
      triggers: "disabled (v9.2)",
    };
  }

  async emergency(action: "enable" | "disable" | "status"): Promise<unknown> {
    if (action === "enable") setEmergencyMode(true);
    else if (action === "disable") setEmergencyMode(false);
    return {
      emergencyMode: isEmergencyMode(),
      disabledWhenEmergency: ["builder", "reviewer", "github_actions", "background_jobs"],
      keptAliveWhenEmergency: ["telegram", "health", "logs", "admin_dashboard"],
      lastChangedAt: new Date().toISOString(),
    };
  }

  async logs(): Promise<unknown> {
    const events = getRecentTelegramEvents(100);
    const errors = getErrorLog(50);
    return {
      recent: events.map((e) => ({
        timestamp: e.timestamp,
        level: e.kind === "failed" ? "error" : "info",
        component: "telegram",
        message: e.kind,
        chatId: e.chatId,
        userId: e.userId,
        text: e.text,
        error: e.error,
      })),
      errors: errors.map((e) => ({
        timestamp: e.timestamp,
        level: e.severity,
        component: e.component,
        message: e.message,
        traceId: e.traceId,
      })),
    };
  }
}

export function getAdminApi(env: HadesBindings): AdminApi {
  return new AdminApi(env);
}
