
/**
 * Audit Service - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Security audit logging:
 * - Request auditing
 * - Authentication events
 * - Data change tracking
 * - Compliance reporting
 */

import { eq, desc, gte } from "drizzle-orm";
import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import { createDb } from "../database/client";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export interface AuditEvent {
  id: string;
  timestamp: string;
  action: string;
  userId: string;
  resource?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

export interface AuditQuery {
  userId?: string;
  action?: string;
  resource?: string;
  from?: string;
  to?: string;
  success?: boolean;
  limit?: number;
  offset?: number;
}

export interface AuditSummary {
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  uniqueUsers: number;
  uniqueActions: number;
  topActions: Array<{ action: string; count: number }>;
  topUsers: Array<{ userId: string; count: number }>;
}

// ============================================
// Audit Service
// ============================================

export class AuditService {
  private buffer: AuditEvent[] = [];
  private bufferSize: number = 100;
  private retentionDays: number = 90;

  // ============================================
  // Event Logging
  // ============================================

  async log(
    env: HadesBindings,
    event: {
      action: string;
      userId: string;
      resource?: string;
      resourceId?: string;
      details?: Record<string, unknown>;
      ipAddress?: string;
      userAgent?: string;
      success?: boolean;
      errorMessage?: string;
    }
  ): Promise<AuditEvent> {
    const auditEvent: AuditEvent = {
      id: generateId("audit"),
      timestamp: new Date().toISOString(),
      action: event.action,
      userId: event.userId,
      resource: event.resource,
      resourceId: event.resourceId,
      details: event.details,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      success: event.success ?? true,
      errorMessage: event.errorMessage,
    };

    // Add to buffer
    this.buffer.push(auditEvent);

    // Flush buffer if full
    if (this.buffer.length >= this.bufferSize) {
      await this.flush(env);
    }

    // Also log to system logger for real-time monitoring
    logger.info(`Audit: ${auditEvent.action} by ${auditEvent.userId}`, {
      auditId: auditEvent.id,
      resource: auditEvent.resource,
      success: auditEvent.success,
    });

    return auditEvent;
  }

  async flush(env: HadesBindings): Promise<void> {
    if (this.buffer.length === 0) return;

    try {
      // In production, store in D1 or KV
      // For now, just clear the buffer
      const events = [...this.buffer];
      this.buffer = [];

      logger.info(`Audit buffer flushed: ${events.length} events`);
    } catch (err) {
      logger.error("Audit buffer flush failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ============================================
  // Querying
  // ============================================

  async getLogs(env: HadesBindings, query: AuditQuery = {}): Promise<AuditEvent[]> {
    // In production, query from D1
    // For now, return buffered events that match
    let events = [...this.buffer];

    if (query.userId) {
      events = events.filter((e) => e.userId === query.userId);
    }
    if (query.action) {
      events = events.filter((e) => e.action === query.action);
    }
    if (query.resource) {
      events = events.filter((e) => e.resource === query.resource);
    }
    if (query.from) {
      events = events.filter((e) => e.timestamp >= query.from!);
    }
    if (query.to) {
      events = events.filter((e) => e.timestamp <= query.to!);
    }
    if (query.success !== undefined) {
      events = events.filter((e) => e.success === query.success);
    }

    // Apply pagination
    const offset = query.offset || 0;
    const limit = query.limit || 50;
    events = events.slice(offset, offset + limit);

    return events;
  }

  async getLogById(env: HadesBindings, id: string): Promise<AuditEvent | null> {
    // Check buffer first
    const fromBuffer = this.buffer.find((e) => e.id === id);
    if (fromBuffer) return fromBuffer;

    return null;
  }

  // ============================================
  // Summary
  // ============================================

  async getSummary(env: HadesBindings, from?: string, to?: string): Promise<AuditSummary> {
    const events = await this.getLogs(env, { from, to, limit: 10000 });

    const uniqueUsers = new Set(events.map((e) => e.userId));
    const uniqueActions = new Set(events.map((e) => e.action));

    const actionCounts = new Map<string, number>();
    const userCounts = new Map<string, number>();

    for (const event of events) {
      actionCounts.set(event.action, (actionCounts.get(event.action) || 0) + 1);
      userCounts.set(event.userId, (userCounts.get(event.userId) || 0) + 1);
    }

    const topActions = Array.from(actionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([action, count]) => ({ action, count }));

    const topUsers = Array.from(userCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([userId, count]) => ({ userId, count }));

    return {
      totalEvents: events.length,
      successfulEvents: events.filter((e) => e.success).length,
      failedEvents: events.filter((e) => !e.success).length,
      uniqueUsers: uniqueUsers.size,
      uniqueActions: uniqueActions.size,
      topActions,
      topUsers,
    };
  }

  // ============================================
  // Compliance
  // ============================================

  async generateComplianceReport(
    env: HadesBindings,
    options: {
      from: string;
      to: string;
      includeFailed?: boolean;
    }
  ): Promise<{
    period: { from: string; to: string };
    summary: AuditSummary;
    failedEvents: AuditEvent[];
    suspiciousEvents: AuditEvent[];
  }> {
    const events = await this.getLogs(env, {
      from: options.from,
      to: options.to,
      limit: 10000,
    });

    const failedEvents = events.filter((e) => !e.success);

    // Detect suspicious events (multiple failures from same user)
    const userFailures = new Map<string, number>();
    for (const event of failedEvents) {
      userFailures.set(event.userId, (userFailures.get(event.userId) || 0) + 1);
    }

    const suspiciousEvents = events.filter((e) => {
      const failures = userFailures.get(e.userId) || 0;
      return failures > 5;
    });

    return {
      period: { from: options.from, to: options.to },
      summary: await this.getSummary(env, options.from, options.to),
      failedEvents: options.includeFailed !== false ? failedEvents : [],
      suspiciousEvents,
    };
  }

  // ============================================
  // Cleanup
  // ============================================

  async cleanup(env: HadesBindings, retentionDays?: number): Promise<number> {
    const days = retentionDays || this.retentionDays;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // In production, delete old records from D1
    logger.info(`Audit cleanup: removing events before ${cutoff}`);
    return 0;
  }

  // ============================================
  // Configuration
  // ============================================

  setBufferSize(size: number): void {
    this.bufferSize = size;
  }

  setRetentionDays(days: number): void {
    this.retentionDays = days;
  }
}

export const auditService = new AuditService();
