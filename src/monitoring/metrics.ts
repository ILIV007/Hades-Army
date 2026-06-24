
/**
 * Metrics Service - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Metrics collection, storage, and analysis:
 * - Time-series metrics in D1
 * - Counter, gauge, and histogram types
 * - Aggregation and querying
 * - Export capabilities
 */

import { eq, desc, gte, and } from "drizzle-orm";
import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import { metrics } from "../database/schema";
import { createDb } from "../database/client";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export type MetricType = "counter" | "gauge" | "histogram";

export interface MetricValue {
  name: string;
  type: MetricType;
  value: number;
  labels?: Record<string, string>;
  timestamp?: string;
}

export interface MetricSeries {
  name: string;
  type: MetricType;
  values: Array<{ value: number; timestamp: string; labels: Record<string, string> }>;
}

export interface MetricAggregation {
  name: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  last: number;
}

export interface CurrentMetrics {
  requestsPerMinute: number;
  averageLatency: number;
  errorRate: number;
  cpuUsage: number;
  memoryUsage: number;
}

// ============================================
// Metrics Service
// ============================================

export class MetricsService {
  private inMemoryMetrics: Map<string, MetricValue[]> = new Map();

  // ============================================
  // Recording
  // ============================================

  async record(env: HadesBindings, metric: MetricValue): Promise<void> {
    const db = createDb(env.HADES_DB);
    const id = generateId("metric");
    const timestamp = metric.timestamp || new Date().toISOString();

    await db.insert(metrics).values({
      id,
      name: metric.name,
      type: metric.type,
      value: metric.value,
      labels: JSON.stringify(metric.labels || {}),
      timestamp,
    });

    // Also keep in memory for fast access
    const key = this.getMetricKey(metric.name, metric.labels);
    const values = this.inMemoryMetrics.get(key) || [];
    values.push({ ...metric, timestamp });
    this.inMemoryMetrics.set(key, values);

    // Trim in-memory cache
    if (values.length > 1000) {
      this.inMemoryMetrics.set(key, values.slice(-500));
    }
  }

  async incrementCounter(
    env: HadesBindings,
    name: string,
    value: number = 1,
    labels?: Record<string, string>
  ): Promise<void> {
    await this.record(env, { name, type: "counter", value, labels });
  }

  async setGauge(
    env: HadesBindings,
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void> {
    await this.record(env, { name, type: "gauge", value, labels });
  }

  async recordHistogram(
    env: HadesBindings,
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void> {
    await this.record(env, { name, type: "histogram", value, labels });
  }

  // ============================================
  // Collection
  // ============================================

  async collectAll(env: HadesBindings): Promise<void> {
    const startTime = Date.now();

    try {
      // Collect system metrics
      await this.collectSystemMetrics(env);

      // Collect application metrics
      await this.collectApplicationMetrics(env);

      logger.debug(`Metrics collected in ${Date.now() - startTime}ms`);
    } catch (err) {
      logger.error("Metrics collection failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async collectSystemMetrics(env: HadesBindings): Promise<void> {
    // CPU usage (simulated for Workers)
    await this.setGauge(env, "system_cpu_usage", Math.random() * 100, { unit: "percent" });

    // Memory usage (simulated for Workers)
    await this.setGauge(env, "system_memory_usage", Math.random() * 100, { unit: "percent" });
  }

  private async collectApplicationMetrics(env: HadesBindings): Promise<void> {
    // These would be populated by middleware or other services
    // For now, just ensure the metrics exist
    await this.setGauge(env, "app_active_agents", 5, {});
    await this.setGauge(env, "app_pending_tasks", 12, {});
    await this.setGauge(env, "app_pending_reviews", 3, {});
  }

  // ============================================
  // Querying
  // ============================================

  async getMetrics(
    env: HadesBindings,
    options: {
      name?: string;
      type?: MetricType;
      from?: string;
      to?: string;
      limit?: number;
    } = {}
  ): Promise<MetricSeries[]> {
    const db = createDb(env.HADES_DB);
    const limit = options.limit || 1000;

    let query = db.select().from(metrics).orderBy(desc(metrics.timestamp)).limit(limit);

    // Build conditions
    const conditions = [];
    if (options.name) {
      conditions.push(eq(metrics.name, options.name));
    }
    if (options.type) {
      conditions.push(eq(metrics.type, options.type));
    }
    if (options.from) {
      conditions.push(gte(metrics.timestamp, options.from));
    }

    const result = conditions.length > 0
      ? await db.select().from(metrics).where(and(...conditions)).orderBy(desc(metrics.timestamp)).limit(limit)
      : await query;

    // Group by name
    const grouped = new Map<string, MetricSeries>();

    for (const row of result) {
      if (!grouped.has(row.name)) {
        grouped.set(row.name, {
          name: row.name,
          type: row.type as MetricType,
          values: [],
        });
      }

      grouped.get(row.name)!.values.push({
        value: row.value,
        timestamp: row.timestamp,
        labels: JSON.parse(row.labels),
      });
    }

    return Array.from(grouped.values());
  }

  async getMetricAggregation(
    env: HadesBindings,
    name: string,
    from?: string,
    to?: string
  ): Promise<MetricAggregation | null> {
    const series = await this.getMetrics(env, { name, from, to });

    if (series.length === 0 || series[0].values.length === 0) {
      return null;
    }

    const values = series[0].values.map((v) => v.value);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      name,
      count: values.length,
      sum,
      avg: sum / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      last: values[values.length - 1],
    };
  }

  async getCurrentMetrics(env: HadesBindings): Promise<CurrentMetrics> {
    const [requestsMetric, latencyMetric, errorMetric] = await Promise.all([
      this.getMetricAggregation(env, "http_requests_total"),
      this.getMetricAggregation(env, "http_request_duration_ms"),
      this.getMetricAggregation(env, "http_errors_total"),
    ]);

    return {
      requestsPerMinute: requestsMetric?.last || 0,
      averageLatency: latencyMetric?.avg || 0,
      errorRate: errorMetric?.last || 0,
      cpuUsage: Math.random() * 100,
      memoryUsage: Math.random() * 100,
    };
  }

  async getRecentMetrics(env: HadesBindings, minutes: number = 60): Promise<MetricSeries[]> {
    const from = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    return this.getMetrics(env, { from });
  }

  // ============================================
  // Cleanup
  // ============================================

  async cleanupOldMetrics(env: HadesBindings, retentionDays: number = 30): Promise<number> {
    const db = createDb(env.HADES_DB);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    // Note: In production, use a proper DELETE query
    // For now, just log the cleanup
    logger.info(`Cleaning up metrics older than ${cutoff}`);
    return 0;
  }

  // ============================================
  // Export
  // ============================================

  async exportToPrometheus(env: HadesBindings): Promise<string> {
    const allMetrics = await this.getMetrics(env, { limit: 10000 });
    let output = "";

    for (const series of allMetrics) {
      const sanitizedName = series.name.replace(/[^a-zA-Z0-9_]/g, "_");
      output += `# TYPE ${sanitizedName} ${series.type}\n`;

      for (const value of series.values) {
        const labels = Object.entries(value.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(",");
        const labelStr = labels ? `{${labels}}` : "";
        output += `${sanitizedName}${labelStr} ${value.value} ${new Date(value.timestamp).getTime()}\n`;
      }

      output += "\n";
    }

    return output;
  }

  // ============================================
  // Helpers
  // ============================================

  private getMetricKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return `${name}{${labelStr}}`;
  }
}

export const metricsService = new MetricsService();
