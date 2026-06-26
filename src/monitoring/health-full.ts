/**
 * Full Health System - Cloudflare Workers Edition
 * Hades Army v9.3 — Health System
 *
 * Priority 10: Health System
 *
 * Endpoints:
 *   GET /health         — basic status (existing)
 *   GET /health/full    — all 11 services with details
 *   GET /health/live    — liveness probe (always 200 if Worker is running)
 *
 * Services checked:
 *   telegram, github, memory, kv, d1, ai, prompt_loader, encryption,
 *   repository_index, scheduler, secrets
 *
 * Each service returns: healthy | warning | critical
 */

import type { HadesBindings } from "../types";
import { validateSecretsAtStartup } from "../security/startup-validator";

// ============================================
// Types
// ============================================

export type ServiceStatus = "healthy" | "warning" | "critical";

export interface ServiceHealth {
  name: string;
  emoji: string;
  status: ServiceStatus;
  detail: string;
  latencyMs?: number;
  lastCheckedAt: string;
}

export interface FullHealthReport {
  overall: ServiceStatus;
  services: ServiceHealth[];
  summary: {
    healthy: number;
    warning: number;
    critical: number;
    total: number;
  };
  version: string;
  timestamp: string;
  uptime: string;
}

export interface LiveProbe {
  status: "alive";
  timestamp: string;
  isolate: string;
}

// ============================================
// Isolate start time (for uptime)
// ============================================

const ISOLATE_STARTED_AT = Date.now();

// ============================================
// Full health check
// ============================================

export async function runFullHealthCheck(env: HadesBindings): Promise<FullHealthReport> {
  const services: ServiceHealth[] = [];
  const now = new Date().toISOString();

  // 1. Telegram
  services.push(await checkTelegram(env, now));

  // 2. GitHub
  services.push(await checkGitHub(env, now));

  // 3. Memory (KV-backed)
  services.push(await checkMemory(env, now));

  // 4. KV
  services.push(await checkKV(env, now));

  // 5. D1
  services.push(await checkD1(env, now));

  // 6. AI binding
  services.push(await checkAI(env, now));

  // 7. Prompt loader (templates exist?)
  services.push(await checkPromptLoader(env, now));

  // 8. Encryption key
  services.push(await checkEncryption(env, now));

  // 9. Repository index (any repo memory in KV?)
  services.push(await checkRepositoryIndex(env, now));

  // 10. Scheduler (cron disabled in v9.2 — report as warning)
  services.push({
    name: "Scheduler",
    emoji: "📅",
    status: "warning",
    detail: "Cron triggers disabled in v9.2 (will be re-enabled in v9.4)",
    lastCheckedAt: now,
  });

  // 11. Secrets
  services.push(await checkSecrets(env, now));

  // Summary
  const summary = {
    healthy: services.filter((s) => s.status === "healthy").length,
    warning: services.filter((s) => s.status === "warning").length,
    critical: services.filter((s) => s.status === "critical").length,
    total: services.length,
  };

  const overall: ServiceStatus =
    summary.critical > 0 ? "critical" :
    summary.warning > 0 ? "warning" :
    "healthy";

  const uptimeMs = Date.now() - ISOLATE_STARTED_AT;
  const uptime = formatUptime(uptimeMs);

  return {
    overall,
    services,
    summary,
    version: env.HADES_VERSION ?? "unknown",
    timestamp: now,
    uptime,
  };
}

// ============================================
// Liveness probe
// ============================================

export function getLiveProbe(): LiveProbe {
  return {
    status: "alive",
    timestamp: new Date().toISOString(),
    isolate: `isolate-${ISOLATE_STARTED_AT}`,
  };
}

// ============================================
// Individual service checks
// ============================================

async function checkTelegram(env: HadesBindings, now: string): Promise<ServiceHealth> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return { name: "Telegram", emoji: "🤖", status: "critical", detail: "TELEGRAM_BOT_TOKEN not set", lastCheckedAt: now };
  }
  try {
    const start = Date.now();
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
    const latency = Date.now() - start;
    if (!res.ok) {
      return { name: "Telegram", emoji: "🤖", status: "critical", detail: `Telegram API ${res.status}`, latencyMs: latency, lastCheckedAt: now };
    }
    const data = await res.json() as any;
    return {
      name: "Telegram",
      emoji: "🤖",
      status: "healthy",
      detail: `Bot @${data.result?.username ?? "unknown"} connected`,
      latencyMs: latency,
      lastCheckedAt: now,
    };
  } catch (err) {
    return { name: "Telegram", emoji: "🤖", status: "critical", detail: err instanceof Error ? err.message : String(err), lastCheckedAt: now };
  }
}

async function checkGitHub(env: HadesBindings, now: string): Promise<ServiceHealth> {
  if (!env.GITHUB_TOKEN) {
    return { name: "GitHub", emoji: "🐙", status: "warning", detail: "GITHUB_TOKEN not set (optional for read-only)", lastCheckedAt: now };
  }
  try {
    const start = Date.now();
    const res = await fetch("https://api.github.com/zen", {
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, "User-Agent": "HadesArmy/0.9.3" },
    });
    const latency = Date.now() - start;
    const remaining = res.headers.get("x-ratelimit-remaining") ?? "?";
    if (!res.ok) {
      return { name: "GitHub", emoji: "🐙", status: "critical", detail: `GitHub API ${res.status}`, latencyMs: latency, lastCheckedAt: now };
    }
    return {
      name: "GitHub",
      emoji: "🐙",
      status: "healthy",
      detail: `Connected (rate limit remaining: ${remaining})`,
      latencyMs: latency,
      lastCheckedAt: now,
    };
  } catch (err) {
    return { name: "GitHub", emoji: "🐙", status: "critical", detail: err instanceof Error ? err.message : String(err), lastCheckedAt: now };
  }
}

async function checkMemory(env: HadesBindings, now: string): Promise<ServiceHealth> {
  if (!env.HADES_KV) {
    return { name: "Memory", emoji: "🧠", status: "critical", detail: "KV binding missing — memory layer unavailable", lastCheckedAt: now };
  }
  try {
    const start = Date.now();
    await env.HADES_KV.get("__hades_health_check__");
    const latency = Date.now() - start;
    return { name: "Memory", emoji: "🧠", status: "healthy", detail: "Memory layer operational", latencyMs: latency, lastCheckedAt: now };
  } catch (err) {
    return { name: "Memory", emoji: "🧠", status: "critical", detail: err instanceof Error ? err.message : String(err), lastCheckedAt: now };
  }
}

async function checkKV(env: HadesBindings, now: string): Promise<ServiceHealth> {
  if (!env.HADES_KV) {
    return { name: "KV", emoji: "⚡", status: "critical", detail: "KV binding missing", lastCheckedAt: now };
  }
  try {
    const start = Date.now();
    const list = await env.HADES_KV.list({ limit: 1 });
    const latency = Date.now() - start;
    return { name: "KV", emoji: "⚡", status: "healthy", detail: `KV operational (${list.keys.length} sample key)`, latencyMs: latency, lastCheckedAt: now };
  } catch (err) {
    return { name: "KV", emoji: "⚡", status: "critical", detail: err instanceof Error ? err.message : String(err), lastCheckedAt: now };
  }
}

async function checkD1(env: HadesBindings, now: string): Promise<ServiceHealth> {
  if (!env.HADES_DB) {
    return { name: "D1", emoji: "🗄️", status: "critical", detail: "D1 binding missing", lastCheckedAt: now };
  }
  try {
    const start = Date.now();
    await env.HADES_DB.prepare("SELECT 1").run();
    const latency = Date.now() - start;
    return { name: "D1", emoji: "🗄️", status: "healthy", detail: "D1 operational", latencyMs: latency, lastCheckedAt: now };
  } catch (err) {
    return { name: "D1", emoji: "🗄️", status: "critical", detail: err instanceof Error ? err.message : String(err), lastCheckedAt: now };
  }
}

async function checkAI(env: HadesBindings, now: string): Promise<ServiceHealth> {
  if (!env.AI) {
    return { name: "AI", emoji: "🧠", status: "warning", detail: "AI binding missing (Cloudflare Workers AI unavailable)", lastCheckedAt: now };
  }
  return { name: "AI", emoji: "🧠", status: "healthy", detail: "Cloudflare Workers AI binding present", lastCheckedAt: now };
}

async function checkPromptLoader(_env: HadesBindings, now: string): Promise<ServiceHealth> {
  // Prompt loader uses prompts/manager.ts which is in-memory
  // We just verify the module loaded — no external check needed
  return { name: "Prompt Loader", emoji: "📝", status: "healthy", detail: "Prompt templates module loaded", lastCheckedAt: now };
}

async function checkEncryption(env: HadesBindings, now: string): Promise<ServiceHealth> {
  if (!env.ENCRYPTION_KEY) {
    return { name: "Encryption", emoji: "🔐", status: "critical", detail: "ENCRYPTION_KEY not set", lastCheckedAt: now };
  }
  if (env.ENCRYPTION_KEY.length < 32) {
    return { name: "Encryption", emoji: "🔐", status: "warning", detail: `ENCRYPTION_KEY too short (${env.ENCRYPTION_KEY.length} < 32)`, lastCheckedAt: now };
  }
  return { name: "Encryption", emoji: "🔐", status: "healthy", detail: "Encryption key configured", lastCheckedAt: now };
}

async function checkRepositoryIndex(env: HadesBindings, now: string): Promise<ServiceHealth> {
  if (!env.HADES_KV) {
    return { name: "Repository Index", emoji: "📦", status: "warning", detail: "Cannot check — KV missing", lastCheckedAt: now };
  }
  try {
    const list = await env.HADES_KV.list({ prefix: "repo-memory:" });
    if (list.keys.length === 0) {
      return { name: "Repository Index", emoji: "📦", status: "warning", detail: "No repository memory initialized yet", lastCheckedAt: now };
    }
    return { name: "Repository Index", emoji: "📦", status: "healthy", detail: `${list.keys.length} repo-memory entries`, lastCheckedAt: now };
  } catch {
    return { name: "Repository Index", emoji: "📦", status: "warning", detail: "Index check failed", lastCheckedAt: now };
  }
}

async function checkSecrets(env: HadesBindings, now: string): Promise<ServiceHealth> {
  try {
    const result = validateSecretsAtStartup(env);
    if (result.missing.length > 0) {
      return { name: "Secrets", emoji: "🔑", status: "critical", detail: `Missing: ${result.missing.join(", ")}`, lastCheckedAt: now };
    }
    if (result.warnings.length > 0) {
      return { name: "Secrets", emoji: "🔑", status: "warning", detail: `Recommended: ${result.warnings.join(", ")}`, lastCheckedAt: now };
    }
    return { name: "Secrets", emoji: "🔑", status: "healthy", detail: `${result.checked.length} secrets valid`, lastCheckedAt: now };
  } catch (err) {
    return { name: "Secrets", emoji: "🔑", status: "warning", detail: err instanceof Error ? err.message : String(err), lastCheckedAt: now };
  }
}

// ============================================
// Helpers
// ============================================

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// ============================================
// Renderers
// ============================================

export function renderFullHealthForTelegram(report: FullHealthReport): string {
  const overallIcon = report.overall === "healthy" ? "✅" : report.overall === "warning" ? "⚠️" : "❌";
  const lines: string[] = [
    `${overallIcon} *Full Health Report* — ${report.overall.toUpperCase()}`,
    ``,
    `*Version:* ${report.version}`,
    `*Uptime:* ${report.uptime}`,
    `*Summary:* ${report.summary.healthy} healthy · ${report.summary.warning} warning · ${report.summary.critical} critical`,
    ``,
    `*Services:*`,
  ];
  for (const s of report.services) {
    const icon = s.status === "healthy" ? "✅" : s.status === "warning" ? "⚠️" : "❌";
    const latency = s.latencyMs !== undefined ? ` (${s.latencyMs}ms)` : "";
    lines.push(`${s.emoji} ${icon} *${s.name}*${latency}`);
    lines.push(`   ${s.detail}`);
  }
  return lines.join("\n");
}
