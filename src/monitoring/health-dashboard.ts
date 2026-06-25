/**
 * Health Dashboard v0.9.1 - Cloudflare Workers Edition
 * Hades Army v0.9.1
 *
 * Priority 9: Deployment Health
 *
 * Renders the /health command output for Telegram and the REST API:
 *   - Telegram bot status
 *   - GitHub connectivity
 *   - D1 database
 *   - KV namespace
 *   - AI Provider availability
 *   - Memory Sync status
 *
 * Each component gets a status:
 *   ✅ Healthy | ⚠️ Warning | ❌ Failed
 */

import type { HadesBindings } from "../types";
import { validateSecretsAtStartup } from "../security/startup-validator";
import { ModelRegistry } from "../registry/model-registry";
import { getMemorySyncEngine } from "../memory/memory-sync.service";
import { getAIFactoryAdapter } from "../integrations/ai-factory-adapter";

// ============================================
// Types
// ============================================

export type HealthStatus = "healthy" | "warning" | "failed";

export interface ComponentHealth {
  name: string;
  emoji: string;
  status: HealthStatus;
  detail: string;
  latencyMs?: number;
}

export interface HealthReport {
  overall: HealthStatus;
  components: ComponentHealth[];
  checkedAt: string;
  version: string;
}

// ============================================
// Health check runner
// ============================================

export async function runHealthCheck(env: HadesBindings): Promise<HealthReport> {
  const components: ComponentHealth[] = [];

  // 1. Telegram bot token
  components.push({
    name: "Telegram Bot",
    emoji: "🤖",
    status: env.TELEGRAM_BOT_TOKEN ? "healthy" : "failed",
    detail: env.TELEGRAM_BOT_TOKEN ? "Token configured" : "TELEGRAM_BOT_TOKEN missing",
  });

  // 2. GitHub token
  components.push({
    name: "GitHub",
    emoji: "🐙",
    status: env.GITHUB_TOKEN ? "healthy" : "failed",
    detail: env.GITHUB_TOKEN ? "Token configured" : "GITHUB_TOKEN missing",
  });

  // 3. D1 database
  let d1Latency = 0;
  let d1Status: HealthStatus = "healthy";
  let d1Detail = "OK";
  try {
    const start = Date.now();
    await env.HADES_DB.prepare("SELECT 1").run();
    d1Latency = Date.now() - start;
  } catch (err) {
    d1Status = "failed";
    d1Detail = err instanceof Error ? err.message : String(err);
  }
  components.push({
    name: "D1 Database",
    emoji: "🗄️",
    status: d1Status,
    detail: d1Detail,
    latencyMs: d1Latency,
  });

  // 4. KV namespace
  let kvStatus: HealthStatus = "healthy";
  let kvDetail = "OK";
  try {
    if (!env.HADES_KV) {
      kvStatus = "failed";
      kvDetail = "Binding missing";
    } else {
      await env.HADES_KV.get("__hades_health_check__");
    }
  } catch (err) {
    kvStatus = "failed";
    kvDetail = err instanceof Error ? err.message : String(err);
  }
  components.push({
    name: "KV Namespace",
    emoji: "⚡",
    status: kvStatus,
    detail: kvDetail,
  });

  // 5. AI Providers
  try {
    const adapter = getAIFactoryAdapter(env);
    const health = await adapter.healthCheck();
    const available = health.registry.providers.filter((p) => p.available);
    components.push({
      name: "AI Providers",
      emoji: "🧠",
      status: available.length >= 2 ? "healthy" : available.length === 1 ? "warning" : "failed",
      detail: `${available.length}/${health.registry.providers.length} providers available: ${available.map((p) => p.name).join(", ") || "none"}`,
    });
  } catch (err) {
    components.push({
      name: "AI Providers",
      emoji: "🧠",
      status: "failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 6. Memory Sync
  try {
    const sync = getMemorySyncEngine(env);
    const memoryHealth = await sync.getHealth();
    const hasWarnings = memoryHealth.warnings.length > 0;
    const allDown = !memoryHealth.repoMemoryAvailable && !memoryHealth.d1Available && !memoryHealth.kvAvailable;
    components.push({
      name: "Memory Sync",
      emoji: "🔄",
      status: allDown ? "failed" : hasWarnings ? "warning" : "healthy",
      detail: hasWarnings
        ? `Warnings: ${memoryHealth.warnings.join("; ")}`
        : `Last sync: ${memoryHealth.lastSyncAt ?? "never"}`,
    });
  } catch (err) {
    components.push({
      name: "Memory Sync",
      emoji: "🔄",
      status: "warning",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 7. Secrets
  try {
    const secretResult = validateSecretsAtStartup(env);
    components.push({
      name: "Secrets",
      emoji: "🔐",
      status: secretResult.missing.length > 0
        ? "failed"
        : secretResult.warnings.length > 0
          ? "warning"
          : "healthy",
      detail: secretResult.missing.length > 0
        ? `Missing critical: ${secretResult.missing.join(", ")}`
        : secretResult.warnings.length > 0
          ? `Missing recommended: ${secretResult.warnings.join(", ")}`
          : `All ${secretResult.checked.length} secrets valid`,
    });
  } catch (err) {
    components.push({
      name: "Secrets",
      emoji: "🔐",
      status: "warning",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // Overall
  const hasFailed = components.some((c) => c.status === "failed");
  const hasWarning = components.some((c) => c.status === "warning");
  const overall: HealthStatus = hasFailed ? "failed" : hasWarning ? "warning" : "healthy";

  return {
    overall,
    components,
    checkedAt: new Date().toISOString(),
    version: env.HADES_VERSION ?? "unknown",
  };
}

// ============================================
// Telegram renderer
// ============================================

export function renderHealthReport(report: HealthReport): string {
  const emoji = report.overall === "healthy" ? "✅" : report.overall === "warning" ? "⚠️" : "❌";
  const lines: string[] = [
    `${emoji} *Health Dashboard* — ${report.overall.toUpperCase()}`,
    ``,
    `*Version:* ${report.version}`,
    `*Checked:* ${new Date(report.checkedAt).toLocaleString()}`,
    ``,
    `*Components:*`,
  ];
  for (const c of report.components) {
    const statusIcon = c.status === "healthy" ? "✅" : c.status === "warning" ? "⚠️" : "❌";
    const latency = c.latencyMs !== undefined ? ` (${c.latencyMs}ms)` : "";
    lines.push(`${c.emoji} ${statusIcon} *${c.name}*${latency}`);
    lines.push(`   ${c.detail}`);
  }
  return lines.join("\n");
}
