
/**
 * Health Service - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Comprehensive health checking:
 * - D1 Database connectivity
 * - KV Cache connectivity
 * - AI provider availability
 * - External API health
 * - Custom health checks
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings, HealthCheckResult, HealthReport, HealthStatus } from "../types";

// ============================================
// Types
// ============================================

export interface HealthCheck {
  name: string;
  check: (env: HadesBindings) => Promise<HealthCheckResult>;
  critical: boolean;
  timeout: number;
}

export interface DetailedHealthReport extends HealthReport {
  checks: Record<string, HealthCheckResult & { name: string; critical: boolean }>;
  slowChecks: string[];
  failedChecks: string[];
}

// ============================================
// Health Service
// ============================================

export class HealthService {
  private checks: Map<string, HealthCheck> = new Map();
  private lastReport: HealthReport | null = null;

  constructor() {
    this.registerDefaultChecks();
  }

  // ============================================
  // Check Registration
  // ============================================

  registerCheck(check: HealthCheck): void {
    this.checks.set(check.name, check);
    logger.info(`Health check registered: ${check.name}`);
  }

  unregisterCheck(name: string): boolean {
    const removed = this.checks.delete(name);
    if (removed) {
      logger.info(`Health check unregistered: ${name}`);
    }
    return removed;
  }

  private registerDefaultChecks(): void {
    // D1 Database check
    this.registerCheck({
      name: "database",
      critical: true,
      timeout: 5000,
      check: async (env) => {
        const start = Date.now();
        try {
          const db = env.HADES_DB;
          // Simple query to test connectivity
          await db.prepare("SELECT 1").first();
          return {
            status: "healthy",
            latency: Date.now() - start,
            critical: true,
          };
        } catch (err) {
          return {
            status: "unhealthy",
            message: err instanceof Error ? err.message : String(err),
            latency: Date.now() - start,
            critical: true,
          };
        }
      },
    });

    // KV Cache check
    this.registerCheck({
      name: "kv",
      critical: true,
      timeout: 3000,
      check: async (env) => {
        const start = Date.now();
        try {
          const kv = env.HADES_KV;
          const testKey = `health_${Date.now()}`;
          await kv.put(testKey, "ok", { expirationTtl: 60 });
          const value = await kv.get(testKey);
          await kv.delete(testKey);

          if (value === "ok") {
            return {
              status: "healthy",
              latency: Date.now() - start,
              critical: true,
            };
          }
          return {
            status: "degraded",
            message: "KV read/write inconsistency",
            latency: Date.now() - start,
            critical: true,
          };
        } catch (err) {
          return {
            status: "unhealthy",
            message: err instanceof Error ? err.message : String(err),
            latency: Date.now() - start,
            critical: true,
          };
        }
      },
    });

    // Workers AI check
    this.registerCheck({
      name: "ai",
      critical: false,
      timeout: 10000,
      check: async (env) => {
        const start = Date.now();
        try {
          const ai = env.AI;
          if (!ai) {
            return {
              status: "degraded",
              message: "AI binding not configured",
              latency: Date.now() - start,
              critical: false,
            };
          }
          // Note: Actual AI inference would be tested here
          return {
            status: "healthy",
            latency: Date.now() - start,
            critical: false,
          };
        } catch (err) {
          return {
            status: "degraded",
            message: err instanceof Error ? err.message : String(err),
            latency: Date.now() - start,
            critical: false,
          };
        }
      },
    });

    // R2 Storage check
    this.registerCheck({
      name: "r2",
      critical: false,
      timeout: 5000,
      check: async (env) => {
        const start = Date.now();
        try {
          const r2 = env.HADES_R2;
          if (!r2) {
            return {
              status: "degraded",
              message: "R2 binding not configured",
              latency: Date.now() - start,
              critical: false,
            };
          }
          // List objects to test connectivity
          await r2.list({ limit: 1 });
          return {
            status: "healthy",
            latency: Date.now() - start,
            critical: false,
          };
        } catch (err) {
          return {
            status: "degraded",
            message: err instanceof Error ? err.message : String(err),
            latency: Date.now() - start,
            critical: false,
          };
        }
      },
    });

    // GitHub API check
    this.registerCheck({
      name: "github",
      critical: false,
      timeout: 10000,
      check: async (env) => {
        const start = Date.now();
        try {
          const token = env.GITHUB_TOKEN;
          if (!token) {
            return {
              status: "degraded",
              message: "GitHub token not configured",
              latency: Date.now() - start,
              critical: false,
            };
          }
          const response = await fetch("https://api.github.com/rate_limit", {
            headers: {
              Authorization: `Bearer ${token}`,
              "User-Agent": "Hades-Army/0.8.0",
            },
          });

          if (response.ok) {
            return {
              status: "healthy",
              latency: Date.now() - start,
              critical: false,
            };
          }
          return {
            status: "degraded",
            message: `GitHub API returned ${response.status}`,
            latency: Date.now() - start,
            critical: false,
          };
        } catch (err) {
          return {
            status: "degraded",
            message: err instanceof Error ? err.message : String(err),
            latency: Date.now() - start,
            critical: false,
          };
        }
      },
    });

    // Telegram API check
    this.registerCheck({
      name: "telegram",
      critical: false,
      timeout: 5000,
      check: async (env) => {
        const start = Date.now();
        try {
          const token = env.TELEGRAM_BOT_TOKEN;
          if (!token) {
            return {
              status: "degraded",
              message: "Telegram bot token not configured",
              latency: Date.now() - start,
              critical: false,
            };
          }
          const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
          if (response.ok) {
            return {
              status: "healthy",
              latency: Date.now() - start,
              critical: false,
            };
          }
          return {
            status: "degraded",
            message: `Telegram API returned ${response.status}`,
            latency: Date.now() - start,
            critical: false,
          };
        } catch (err) {
          return {
            status: "degraded",
            message: err instanceof Error ? err.message : String(err),
            latency: Date.now() - start,
            critical: false,
          };
        }
      },
    });
  }

  // ============================================
  // Health Checks
  // ============================================

  async runCheck(name: string, env: HadesBindings): Promise<HealthCheckResult | null> {
    const check = this.checks.get(name);
    if (!check) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), check.timeout);

    try {
      const result = await Promise.race([
        check.check(env),
        new Promise<HealthCheckResult>((_, reject) => {
          setTimeout(() => reject(new Error("Health check timeout")), check.timeout);
        }),
      ]);
      clearTimeout(timeoutId);
      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      return {
        status: "unhealthy",
        message: err instanceof Error ? err.message : "Health check timeout",
        latency: check.timeout,
        critical: check.critical,
      };
    }
  }

  async runAllChecks(env: HadesBindings): Promise<Record<string, HealthCheckResult>> {
    const results: Record<string, HealthCheckResult> = {};
    const promises: Promise<void>[] = [];

    for (const [name, check] of this.checks) {
      promises.push(
        (async () => {
          results[name] = await this.runCheck(name, env);
        })()
      );
    }

    await Promise.all(promises);
    return results;
  }

  // ============================================
  // Health Reports
  // ============================================

  async getHealthReport(env: HadesBindings): Promise<HealthReport> {
    const results = await this.runAllChecks(env);
    return this.buildReport(results);
  }

  async getDetailedHealthReport(env: HadesBindings): Promise<DetailedHealthReport> {
    const results = await this.runAllChecks(env);
    const report = this.buildReport(results);

    const slowChecks: string[] = [];
    const failedChecks: string[] = [];

    for (const [name, result] of Object.entries(results)) {
      if (result.latency > 1000) {
        slowChecks.push(name);
      }
      if (result.status === "unhealthy") {
        failedChecks.push(name);
      }
    }

    return {
      ...report,
      checks: Object.fromEntries(
        Object.entries(results).map(([name, result]) => [
          name,
          { ...result, name, critical: this.checks.get(name)?.critical || false },
        ])
      ),
      slowChecks,
      failedChecks,
    };
  }

  private buildReport(results: Record<string, HealthCheckResult>): HealthReport {
    let status: HealthStatus = "healthy";
    let hasDegraded = false;
    let hasUnhealthy = false;

    for (const result of Object.values(results)) {
      if (result.status === "unhealthy" && result.critical) {
        hasUnhealthy = true;
      } else if (result.status === "degraded" || (result.status === "unhealthy" && !result.critical)) {
        hasDegraded = true;
      }
    }

    if (hasUnhealthy) {
      status = "unhealthy";
    } else if (hasDegraded) {
      status = "degraded";
    }

    const summary = {
      total: Object.keys(results).length,
      healthy: Object.values(results).filter((r) => r.status === "healthy").length,
      degraded: Object.values(results).filter((r) => r.status === "degraded").length,
      unhealthy: Object.values(results).filter((r) => r.status === "unhealthy").length,
    };

    const report: HealthReport = {
      status,
      timestamp: new Date().toISOString(),
      uptime: Date.now(), // In Workers, uptime is per-request
      version: "0.8.0",
      checks: results,
      summary,
    };

    this.lastReport = report;
    return report;
  }

  // ============================================
  // Metrics
  // ============================================

  async getMetrics(): Promise<Record<string, unknown>> {
    return {
      totalChecks: this.checks.size,
      lastReport: this.lastReport,
      registeredChecks: Array.from(this.checks.keys()),
    };
  }
}

export const healthService = new HealthService();
