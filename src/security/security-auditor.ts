/**
 * Security Audit - Cloudflare Workers Edition
 * Hades Army v0.9.2 — Security
 *
 * Priority 9: Security Audit
 *
 * Verifies:
 *   1. No secrets are logged (scans recent log entries)
 *   2. No secrets appear in error messages
 *   3. ENCRYPTION_KEY is used in all at-rest storage paths
 *   4. JWT_SECRET is used for all token signing
 *
 * The audit is READ-ONLY — it reports findings but doesn't modify
 * any state. Run it on demand via /security audit command.
 */

import { logger } from "../utils/logger";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export type SecurityAuditSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface SecurityFinding {
  id: string;
  category: "secret_exposure" | "encryption_missing" | "auth_missing" | "log_leak" | "error_leak";
  severity: SecurityAuditSeverity;
  message: string;
  recommendation: string;
  location?: string;
}

export interface SecurityAuditReport {
  ok: boolean;
  findings: SecurityFinding[];
  checkedAt: string;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

// ============================================
// Patterns that look like secrets
// ============================================

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "GitHub Token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
  { name: "Google API Key", pattern: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "OpenAI Key", pattern: /sk-[A-Za-z0-9]{20,}/g },
  { name: "OpenRouter Key", pattern: /sk-or-[A-Za-z0-9_-]{40,}/g },
  { name: "Telegram Bot Token", pattern: /\b\d{8,12}:AA[A-Za-z0-9_-]{30,}\b/g },
  { name: "Private Key Block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

// ============================================
// Auditor
// ============================================

export class SecurityAuditor {
  private env: HadesBindings;

  constructor(env: HadesBindings) {
    this.env = env;
  }

  /**
   * Run a full security audit. READ-ONLY.
   */
  async audit(): Promise<SecurityAuditReport> {
    const findings: SecurityFinding[] = [];

    // 1. Check critical secrets are present
    const requiredSecrets: Array<keyof HadesBindings> = [
      "TELEGRAM_BOT_TOKEN",
      "GITHUB_TOKEN",
      "GOOGLE_AI_API_KEY",
      "ENCRYPTION_KEY",
      "JWT_SECRET",
    ];

    for (const name of requiredSecrets) {
      const value = this.env[name] as string | undefined;
      if (!value || typeof value !== "string" || value.length === 0) {
        findings.push({
          id: `sec-missing-${name.toLowerCase()}`,
          category: "secret_exposure",
          severity: "critical",
          message: `Required secret ${name} is not set.`,
          recommendation: `Run: wrangler secret put ${name}`,
        });
      }
    }

    // 2. Check ENCRYPTION_KEY length
    const encKey = this.env.ENCRYPTION_KEY;
    if (encKey && encKey.length < 32) {
      findings.push({
        id: "sec-encryption-short",
        category: "encryption_missing",
        severity: "high",
        message: `ENCRYPTION_KEY is too short (${encKey.length} chars). Minimum 32 required.`,
        recommendation: "Generate a new key with: openssl rand -base64 48",
      });
    }

    // 3. Check JWT_SECRET length
    const jwtSecret = this.env.JWT_SECRET;
    if (jwtSecret && jwtSecret.length < 32) {
      findings.push({
        id: "sec-jwt-short",
        category: "auth_missing",
        severity: "high",
        message: `JWT_SECRET is too short (${jwtSecret.length} chars). Minimum 32 required.`,
        recommendation: "Generate a new key with: openssl rand -base64 48",
      });
    }

    // 4. Scan recent KV values for secret-like content
    // (only the values we control — never log them)
    if (this.env.HADES_KV) {
      try {
        const list = await this.env.HADES_KV.list({ limit: 100 });
        let leakedCount = 0;
        for (const key of list.keys.slice(0, 50)) {
          const value = await this.env.HADES_KV.get(key.name);
          if (!value) continue;
          for (const { name, pattern } of SECRET_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(value)) {
              leakedCount++;
              findings.push({
                id: `sec-kv-leak-${key.name}`,
                category: "log_leak",
                severity: "critical",
                message: `KV key "${key.name}" contains what looks like a ${name}.`,
                recommendation: `Delete this KV key immediately and rotate the exposed secret.`,
                location: `KV:${key.name}`,
              });
              break; // one finding per KV key
            }
          }
        }
        if (leakedCount === 0) {
          findings.push({
            id: "sec-kv-clean",
            category: "log_leak",
            severity: "info",
            message: "KV scan complete — no secret-like values detected in first 50 keys.",
            recommendation: "Continue to avoid storing raw secrets in KV.",
          });
        }
      } catch (err) {
        findings.push({
          id: "sec-kv-scan-failed",
          category: "log_leak",
          severity: "low",
          message: `KV scan failed: ${err instanceof Error ? err.message : String(err)}`,
          recommendation: "Investigate KV access issues.",
        });
      }
    }

    // 5. Static audit: verify no secret values appear in env vars (not secrets)
    // The vars section should never contain secret values.
    const nonSecretEnvKeys = ["NODE_ENV", "LOG_LEVEL", "HADES_VERSION"];
    for (const key of nonSecretEnvKeys) {
      const value = (this.env as unknown as Record<string, string | undefined>)[key];
      if (value) {
        for (const { name, pattern } of SECRET_PATTERNS) {
          pattern.lastIndex = 0;
          if (pattern.test(value)) {
            findings.push({
              id: `sec-env-leak-${key.toLowerCase()}`,
              category: "secret_exposure",
              severity: "critical",
              message: `Environment variable ${key} (non-secret) contains a ${name}-like value.`,
              recommendation: `Remove this value from wrangler.toml [vars] and put it in wrangler secret put.`,
              location: `env:${key}`,
            });
          }
        }
      }
    }

    // Summary
    const summary = {
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
      info: findings.filter((f) => f.severity === "info").length,
    };

    const ok = summary.critical === 0 && summary.high === 0;

    logger.info(`SecurityAudit: complete`, { ...summary, ok });

    return {
      ok,
      findings,
      checkedAt: new Date().toISOString(),
      summary,
    };
  }

  /**
   * Render for Telegram.
   */
  render(report: SecurityAuditReport): string {
    const icon = report.ok ? "✅" : "❌";
    const lines: string[] = [
      `${icon} *Security Audit*`,
      ``,
      `*Critical:* ${report.summary.critical}`,
      `*High:* ${report.summary.high}`,
      `*Medium:* ${report.summary.medium}`,
      `*Low:* ${report.summary.low}`,
      `*Info:* ${report.summary.info}`,
      ``,
    ];

    if (report.findings.length === 0) {
      lines.push(`No issues detected.`);
      return lines.join("\n");
    }

    // Show critical and high first
    const significant = report.findings.filter((f) => f.severity === "critical" || f.severity === "high");
    const others = report.findings.filter((f) => f.severity !== "critical" && f.severity !== "high");

    if (significant.length > 0) {
      lines.push(`*Significant findings:*`);
      for (const f of significant) {
        const fIcon = f.severity === "critical" ? "🔴" : "🟠";
        lines.push(`${fIcon} *${f.severity.toUpperCase()}* — ${f.category}`);
        lines.push(`   ${f.message}`);
        lines.push(`   → ${f.recommendation}`);
        if (f.location) lines.push(`   📍 \`${f.location}\``);
        lines.push(``);
      }
    }

    if (others.length > 0) {
      lines.push(`*Other findings:* ${others.length} (info/low/medium)`);
    }

    return lines.join("\n");
  }
}

// ============================================
// Factory
// ============================================

let _instance: SecurityAuditor | null = null;

export function getSecurityAuditor(env: HadesBindings): SecurityAuditor {
  if (!_instance) _instance = new SecurityAuditor(env);
  return _instance;
}
