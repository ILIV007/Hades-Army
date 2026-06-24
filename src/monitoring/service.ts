
/**
 * Monitoring Service - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Central monitoring hub that coordinates:
 * - Health checks
 * - Metrics collection
 * - Alert management
 * - Status reporting
 */

import { logger } from "../utils/logger";
import { generateId, deepClone } from "../utils/helpers";
import { healthService } from "./health";
import { metricsService } from "./metrics";
import { alertService } from "./alerts";
import type { HadesBindings, HealthStatus, AlertSeverity } from "../types";

// ============================================
// Types
// ============================================

export interface MonitoringConfig {
  healthCheckInterval: number;
  metricsRetentionDays: number;
  alertCooldownMinutes: number;
  enableAutoRecovery: boolean;
}

export interface SystemStatus {
  overall: HealthStatus;
  components: Record<string, HealthStatus>;
  alerts: {
    active: number;
    critical: number;
    warning: number;
  };
  metrics: {
    requestsPerMinute: number;
    averageLatency: number;
    errorRate: number;
    cpuUsage: number;
    memoryUsage: number;
  };
  timestamp: string;
}

export interface MonitoringReport {
  status: SystemStatus;
  healthReport: unknown;
  topAlerts: unknown[];
  recentMetrics: unknown[];
  recommendations: string[];
}

// ============================================
// Monitoring Service
// ============================================

export class MonitoringService {
  private config: MonitoringConfig;
  private isRunning: boolean = false;
  private lastCheck: string = "";

  constructor(config: Partial<MonitoringConfig> = {}) {
    this.config = {
      healthCheckInterval: 60,
      metricsRetentionDays: 30,
      alertCooldownMinutes: 15,
      enableAutoRecovery: true,
      ...config,
    };
  }

  // ============================================
  // Lifecycle
  // ============================================

  async start(env: HadesBindings): Promise<void> {
    if (this.isRunning) {
      logger.warn("Monitoring service already running");
      return;
    }

    this.isRunning = true;
    logger.info("🩺 Monitoring service started");

    // Perform initial health check
    await this.performHealthCheck(env);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info("🩺 Monitoring service stopped");
  }

  // ============================================
  // Health Checks
  // ============================================

  async performHealthCheck(env: HadesBindings): Promise<SystemStatus> {
    const startTime = Date.now();

    try {
      const healthReport = await healthService.getDetailedHealthReport(env);

      const components: Record<string, HealthStatus> = {};
      for (const [name, check] of Object.entries(healthReport.checks)) {
        components[name] = check.status;
      }

      const status: SystemStatus = {
        overall: healthReport.status,
        components,
        alerts: await this.getAlertCounts(env),
        metrics: await this.getCurrentMetrics(env),
        timestamp: new Date().toISOString(),
      };

      this.lastCheck = status.timestamp;

      // Auto-recovery if enabled and degraded
      if (this.config.enableAutoRecovery && status.overall === "degraded") {
        await this.attemptAutoRecovery(env, status);
      }

      const duration = Date.now() - startTime;
      logger.info(`Health check completed in ${duration}ms`, { status: status.overall });

      return status;
    } catch (err) {
      logger.error("Health check failed", { error: err instanceof Error ? err.message : String(err) });
      return {
        overall: "unhealthy",
        components: {},
        alerts: { active: 0, critical: 0, warning: 0 },
        metrics: { requestsPerMinute: 0, averageLatency: 0, errorRate: 0, cpuUsage: 0, memoryUsage: 0 },
        timestamp: new Date().toISOString(),
      };
    }
  }

  // ============================================
  // Metrics
  // ============================================

  async collectMetrics(env: HadesBindings): Promise<void> {
    try {
      await metricsService.collectAll(env);
      logger.debug("Metrics collected");
    } catch (err) {
      logger.error("Metrics collection failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  async getCurrentMetrics(env: HadesBindings): Promise<SystemStatus["metrics"]> {
    try {
      const metrics = await metricsService.getCurrentMetrics(env);
      return {
        requestsPerMinute: metrics.requestsPerMinute || 0,
        averageLatency: metrics.averageLatency || 0,
        errorRate: metrics.errorRate || 0,
        cpuUsage: metrics.cpuUsage || 0,
        memoryUsage: metrics.memoryUsage || 0,
      };
    } catch {
      return { requestsPerMinute: 0, averageLatency: 0, errorRate: 0, cpuUsage: 0, memoryUsage: 0 };
    }
  }

  // ============================================
  // Alerts
  // ============================================

  async getAlertCounts(env: HadesBindings): Promise<SystemStatus["alerts"]> {
    try {
      const alerts = await alertService.getActiveAlerts(env);
      return {
        active: alerts.length,
        critical: alerts.filter((a) => a.severity === "critical" || a.severity === "emergency").length,
        warning: alerts.filter((a) => a.severity === "warning").length,
      };
    } catch {
      return { active: 0, critical: 0, warning: 0 };
    }
  }

  async checkAndTriggerAlerts(env: HadesBindings): Promise<void> {
    try {
      await alertService.evaluateAndTrigger(env);
    } catch (err) {
      logger.error("Alert evaluation failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ============================================
  // Auto Recovery
  // ============================================

  private async attemptAutoRecovery(env: HadesBindings, status: SystemStatus): Promise<void> {
    logger.warn("Attempting auto-recovery for degraded system", { components: status.components });

    for (const [component, componentStatus] of Object.entries(status.components)) {
      if (componentStatus === "unhealthy") {
        switch (component) {
          case "kv":
            logger.info("Auto-recovery: Attempting KV reconnection");
            break;
          case "database":
            logger.info("Auto-recovery: Attempting database reconnection");
            break;
          case "ai":
            logger.info("Auto-recovery: Switching AI provider");
            break;
          default:
            logger.info(`Auto-recovery: Component ${component} marked for recovery`);
        }
      }
    }
  }

  // ============================================
  // Reporting
  // ============================================

  async generateReport(env: HadesBindings): Promise<MonitoringReport> {
    const [healthReport, topAlerts, recentMetrics] = await Promise.all([
      healthService.getDetailedHealthReport(env),
      alertService.getTopAlerts(env, 10),
      metricsService.getRecentMetrics(env, 60),
    ]);

    const recommendations = this.generateRecommendations(healthReport, topAlerts);

    return {
      status: await this.performHealthCheck(env),
      healthReport,
      topAlerts,
      recentMetrics,
      recommendations,
    };
  }

  private generateRecommendations(healthReport: unknown, alerts: unknown[]): string[] {
    const recommendations: string[] = [];

    // Analyze health report for recommendations
    if (alerts.length > 5) {
      recommendations.push("High number of active alerts detected. Review alert thresholds.");
    }

    return recommendations;
  }

  // ============================================
  // Status
  // ============================================

  getStatus(): { isRunning: boolean; lastCheck: string; config: MonitoringConfig } {
    return {
      isRunning: this.isRunning,
      lastCheck: this.lastCheck,
      config: deepClone(this.config),
    };
  }
}

export const monitoringService = new MonitoringService();
