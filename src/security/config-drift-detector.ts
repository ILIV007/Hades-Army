/**
 * Config Drift Detector - Cloudflare Workers Edition
 * Hades Army v0.9.2 — Stability
 *
 * Priority 1: Deployment Stability — Config Drift
 *
 * Detects drift between local wrangler.toml and the Cloudflare
 * Dashboard's remote Worker configuration. Drift happens when:
 *   - Someone edits vars in the Dashboard UI but doesn't update wrangler.toml
 *   - An older Worker deploy left stale vars (like the v0.2.1 leftovers
 *     DEFAULT_BUILDER_MODEL, DEFAULT_MANAGER_MODEL, DEFAULT_REVIEWER_MODEL)
 *
 * Drift detection is passive — it returns warnings the user can act on.
 * It does NOT block the Worker from running.
 *
 * Source-of-truth policy (v0.9.2):
 *   - wrangler.toml is the SOLE source for [vars] (non-secret config)
 *   - Cloudflare Dashboard is the SOLE source for secrets
 *   - Any var that exists on the Dashboard but NOT in wrangler.toml is
 *     "stale" and should be deleted from the Dashboard
 */

import { logger } from "../utils/logger";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export interface ConfigVar {
  name: string;
  value: string;
  source: "local" | "remote";
}

export interface DriftItem {
  name: string;
  issue: "missing_locally" | "missing_remotely" | "value_mismatch";
  localValue?: string;
  remoteValue?: string;
  recommendation: string;
}

export interface DriftReport {
  ok: boolean;
  hasDrift: boolean;
  driftCount: number;
  items: DriftItem[];
  checkedAt: string;
}

// ============================================
// Expected vars (from wrangler.toml [vars] section)
// ============================================

/**
 * The set of [vars] that wrangler.toml declares. Anything NOT in
 * this list that appears on the Cloudflare Dashboard is "stale"
 * and should be removed via the Dashboard UI.
 *
 * Update this list whenever you add a new var to wrangler.toml.
 */
export const EXPECTED_LOCAL_VARS: Record<string, string> = {
  NODE_ENV: "production",
  LOG_LEVEL: "info",
  HADES_VERSION: "9.4",
};

/**
 * Vars that are LEGACY (from older Hades versions) and should be
 * deleted from the Cloudflare Dashboard if they appear there.
 */
export const LEGACY_REMOTE_VARS: string[] = [
  "DEFAULT_BUILDER_MODEL",
  "DEFAULT_MANAGER_MODEL",
  "DEFAULT_REVIEWER_MODEL",
  "GITHUB_API_BASE_URL",
  "OPENROUTER_BASE_URL",
  // Old Hades versions used HADES_D1 binding instead of HADES_DB
  "HADES_D1",
];

// ============================================
// Detector
// ============================================

export class ConfigDriftDetector {
  /**
   * Compare local expected vars vs what's actually in env at runtime.
   * The env passed to the Worker IS the remote config — so any var
   * present in env but NOT in EXPECTED_LOCAL_VARS is "stale remote".
   * Any var in EXPECTED_LOCAL_VARS but not in env is "missing remote".
   */
  detect(env: HadesBindings): DriftReport {
    const items: DriftItem[] = [];

    // 1. Check expected vars are present and match
    for (const [name, expectedValue] of Object.entries(EXPECTED_LOCAL_VARS)) {
      const actualValue = (env as unknown as Record<string, string | undefined>)[name];
      if (actualValue === undefined) {
        items.push({
          name,
          issue: "missing_remotely",
          localValue: expectedValue,
          recommendation: `Redeploy with wrangler deploy — wrangler.toml has ${name}=${expectedValue} but the Dashboard is missing it.`,
        });
      } else if (actualValue !== expectedValue) {
        items.push({
          name,
          issue: "value_mismatch",
          localValue: expectedValue,
          remoteValue: actualValue,
          recommendation: `Redeploy to overwrite. Local: ${expectedValue} | Remote: ${actualValue}`,
        });
      }
    }

    // 2. Check for stale remote vars (legacy or extra)
    const knownVarNames = new Set([
      ...Object.keys(EXPECTED_LOCAL_VARS),
      // These are bindings (not vars) — they appear in env but shouldn't trigger drift
      "HADES_DB", "HADES_KV", "HADES_R2", "AI",
      // These are secrets — they appear in env when set, but aren't in [vars]
      "TELEGRAM_BOT_TOKEN", "GITHUB_TOKEN", "GOOGLE_AI_API_KEY", "OPENROUTER_API_KEY",
      "ADMIN_API_TOKEN", "API_KEYS", "JWT_SECRET", "ENCRYPTION_KEY",
      "GITHUB_WEBHOOK_SECRET", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
    ]);

    for (const legacyName of LEGACY_REMOTE_VARS) {
      const value = (env as unknown as Record<string, string | undefined>)[legacyName];
      if (value !== undefined) {
        items.push({
          name: legacyName,
          issue: "missing_locally",
          remoteValue: value,
          recommendation: `STALE legacy var detected on Dashboard. Delete "${legacyName}" from Cloudflare Dashboard → Workers → hades-army → Settings → Variables.`,
        });
      }
    }

    // 3. Check for any other unexpected vars
    const envKeys = Object.keys(env as unknown as Record<string, unknown>);
    for (const key of envKeys) {
      if (knownVarNames.has(key)) continue;
      if (LEGACY_REMOTE_VARS.includes(key)) continue;
      // Unknown var — possibly stale
      const value = (env as unknown as Record<string, string | undefined>)[key];
      if (typeof value === "string" && value.length > 0) {
        items.push({
          name: key,
          issue: "missing_locally",
          remoteValue: value,
          recommendation: `Unknown var "${key}" on Dashboard — not in wrangler.toml. If not intentional, delete it from the Dashboard.`,
        });
      }
    }

    const hasDrift = items.length > 0;
    const report: DriftReport = {
      ok: !hasDrift,
      hasDrift,
      driftCount: items.length,
      items,
      checkedAt: new Date().toISOString(),
    };

    if (hasDrift) {
      logger.warn(`ConfigDrift: ${items.length} drift item(s) detected`, {
        items: items.map((i) => `${i.name} (${i.issue})`),
      });
    } else {
      logger.info("ConfigDrift: no drift detected");
    }

    return report;
  }

  /**
   * Render the drift report as a Markdown message for Telegram.
   */
  render(report: DriftReport): string {
    if (!report.hasDrift) {
      return [
        `✅ *Config Drift Check*`,
        ``,
        `No drift detected. Local wrangler.toml and Cloudflare Dashboard are in sync.`,
      ].join("\n");
    }

    const lines: string[] = [
      `⚠️ *Config Drift Detected* (${report.driftCount} item${report.driftCount === 1 ? "" : "s"})`,
      ``,
    ];

    for (const item of report.items) {
      const icon =
        item.issue === "missing_locally" ? "🗑" :
        item.issue === "missing_remotely" ? "❓" :
        "🔄";
      lines.push(`${icon} *${item.name}* (${item.issue})`);
      if (item.localValue !== undefined) lines.push(`   Local: \`${item.localValue}\``);
      if (item.remoteValue !== undefined) lines.push(`   Remote: \`${item.remoteValue}\``);
      lines.push(`   → ${item.recommendation}`);
      lines.push(``);
    }

    return lines.join("\n");
  }
}

// ============================================
// Factory
// ============================================

let _instance: ConfigDriftDetector | null = null;

export function getConfigDriftDetector(): ConfigDriftDetector {
  if (!_instance) _instance = new ConfigDriftDetector();
  return _instance;
}
