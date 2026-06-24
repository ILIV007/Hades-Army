
/**
 * Alert Service - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Alert management:
 * - Alert creation and tracking
 * - Threshold-based alerting
 * - Notification routing
 * - Alert acknowledgment and resolution
 * - Escalation policies
 */

import { eq, desc, and } from "drizzle-orm";
import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import { alerts } from "../database/schema";
import { createDb } from "../database/client";
import type { HadesBindings, AlertSeverity, AlertStatus } from "../types";

// ============================================
// Types
// ============================================

export interface AlertRule {
  id: string;
  name: string;
  severity: AlertSeverity;
  metric: string;
  threshold: number;
  operator: "gt" | "lt" | "eq" | "gte" | "lte";
  duration: number; // seconds
  message: string;
  enabled: boolean;
}

export interface AlertNotification {
  alertId: string;
  channels: string[]; // telegram, email, webhook
  sentAt: string;
  status: "sent" | "failed" | "pending";
}

// ============================================
// Alert Service
// ============================================

export class AlertService {
  private rules: Map<string, AlertRule> = new Map();
  private cooldowns: Map<string, number> = new Map(); // ruleId -> lastTriggerTime

  constructor() {
    this.registerDefaultRules();
  }

  // ============================================
  // Rule Management
  // ============================================

  registerRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
    logger.info(`Alert rule registered: ${rule.name} (${rule.id})`);
  }

  unregisterRule(ruleId: string): boolean {
    const removed = this.rules.delete(ruleId);
    if (removed) {
      logger.info(`Alert rule unregistered: ${ruleId}`);
    }
    return removed;
  }

  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  getRule(id: string): AlertRule | undefined {
    return this.rules.get(id);
  }

  private registerDefaultRules(): void {
    // High error rate
    this.registerRule({
      id: "high-error-rate",
      name: "High Error Rate",
      severity: "critical",
      metric: "http_errors_total",
      threshold: 10,
      operator: "gt",
      duration: 300,
      message: "Error rate exceeds 10 errors per minute",
      enabled: true,
    });

    // High latency
    this.registerRule({
      id: "high-latency",
      name: "High Response Latency",
      severity: "warning",
      metric: "http_request_duration_ms",
      threshold: 1000,
      operator: "gt",
      duration: 180,
      message: "Average response latency exceeds 1000ms",
      enabled: true,
    });

    // Database connectivity
    this.registerRule({
      id: "db-connectivity",
      name: "Database Connectivity Issue",
      severity: "critical",
      metric: "database_health",
      threshold: 0,
      operator: "eq",
      duration: 60,
      message: "Database connectivity check failed",
      enabled: true,
    });

    // KV connectivity
    this.registerRule({
      id: "kv-connectivity",
      name: "KV Cache Connectivity Issue",
      severity: "critical",
      metric: "kv_health",
      threshold: 0,
      operator: "eq",
      duration: 60,
      message: "KV cache connectivity check failed",
      enabled: true,
    });

    // High CPU usage
    this.registerRule({
      id: "high-cpu",
      name: "High CPU Usage",
      severity: "warning",
      metric: "system_cpu_usage",
      threshold: 80,
      operator: "gt",
      duration: 300,
      message: "CPU usage exceeds 80%",
      enabled: true,
    });

    // High memory usage
    this.registerRule({
      id: "high-memory",
      name: "High Memory Usage",
      severity: "warning",
      metric: "system_memory_usage",
      threshold: 85,
      operator: "gt",
      duration: 300,
      message: "Memory usage exceeds 85%",
      enabled: true,
    });
  }

  // ============================================
  // Alert Creation
  // ============================================

  async createAlert(
    env: HadesBindings,
    params: {
      name: string;
      severity: AlertSeverity;
      message: string;
      source: string;
      metric: string;
      threshold: number;
      currentValue: number;
    }
  ): Promise<string> {
    const db = createDb(env.HADES_DB);
    const id = generateId("alert");

    await db.insert(alerts).values({
      id,
      name: params.name,
      severity: params.severity,
      status: "active",
      message: params.message,
      source: params.source,
      metric: params.metric,
      threshold: params.threshold,
      currentValue: params.currentValue,
      createdAt: new Date().toISOString(),
    });

    logger.warn(`Alert created: ${params.name} (${params.severity})`, {
      alertId: id,
      metric: params.metric,
      currentValue: params.currentValue,
      threshold: params.threshold,
    });

    return id;
  }

  // ============================================
  // Alert Management
  // ============================================

  async getActiveAlerts(env: HadesBindings): Promise<unknown[]> {
    const db = createDb(env.HADES_DB);
    return db
      .select()
      .from(alerts)
      .where(eq(alerts.status, "active"))
      .orderBy(desc(alerts.createdAt));
  }

  async getTopAlerts(env: HadesBindings, limit: number = 10): Promise<unknown[]> {
    const db = createDb(env.HADES_DB);
    return db
      .select()
      .from(alerts)
      .orderBy(desc(alerts.createdAt))
      .limit(limit);
  }

  async acknowledgeAlert(
    env: HadesBindings,
    alertId: string,
    acknowledgedBy: string
  ): Promise<void> {
    const db = createDb(env.HADES_DB);
    await db
      .update(alerts)
      .set({
        status: "acknowledged",
        acknowledgedAt: new Date().toISOString(),
        acknowledgedBy,
      })
      .where(eq(alerts.id, alertId));

    logger.info(`Alert acknowledged: ${alertId} by ${acknowledgedBy}`);
  }

  async resolveAlert(
    env: HadesBindings,
    alertId: string,
    resolvedBy: string,
    resolution?: string
  ): Promise<void> {
    const db = createDb(env.HADES_DB);
    await db
      .update(alerts)
      .set({
        status: "resolved",
        resolvedAt: new Date().toISOString(),
        resolvedBy,
        resolution,
      })
      .where(eq(alerts.id, alertId));

    logger.info(`Alert resolved: ${alertId} by ${resolvedBy}`);
  }

  async muteAlert(env: HadesBindings, alertId: string): Promise<void> {
    const db = createDb(env.HADES_DB);
    await db
      .update(alerts)
      .set({ status: "muted" })
      .where(eq(alerts.id, alertId));

    logger.info(`Alert muted: ${alertId}`);
  }

  // ============================================
  // Evaluation
  // ============================================

  async evaluateAndTrigger(env: HadesBindings): Promise<void> {
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      // Check cooldown
      const lastTrigger = this.cooldowns.get(rule.id);
      if (lastTrigger && Date.now() - lastTrigger < rule.duration * 1000) {
        continue;
      }

      // Evaluate rule (simplified - in production, fetch actual metric values)
      const shouldTrigger = await this.evaluateRule(env, rule);

      if (shouldTrigger) {
        await this.createAlert(env, {
          name: rule.name,
          severity: rule.severity,
          message: rule.message,
          source: "auto-evaluation",
          metric: rule.metric,
          threshold: rule.threshold,
          currentValue: 0, // Would be actual value
        });

        this.cooldowns.set(rule.id, Date.now());
      }
    }
  }

  private async evaluateRule(env: HadesBindings, rule: AlertRule): Promise<boolean> {
    // In production, fetch actual metric value and compare
    // For now, return false (no auto-triggering in demo)
    return false;
  }

  // ============================================
  // Statistics
  // ============================================

  async getAlertStats(env: HadesBindings): Promise<{
    total: number;
    active: number;
    acknowledged: number;
    resolved: number;
    muted: number;
    bySeverity: Record<string, number>;
  }> {
    const db = createDb(env.HADES_DB);
    const allAlerts = await db.select().from(alerts);

    const bySeverity: Record<string, number> = {};
    for (const alert of allAlerts) {
      bySeverity[alert.severity] = (bySeverity[alert.severity] || 0) + 1;
    }

    return {
      total: allAlerts.length,
      active: allAlerts.filter((a) => a.status === "active").length,
      acknowledged: allAlerts.filter((a) => a.status === "acknowledged").length,
      resolved: allAlerts.filter((a) => a.status === "resolved").length,
      muted: allAlerts.filter((a) => a.status === "muted").length,
      bySeverity,
    };
  }
}

export const alertService = new AlertService();
