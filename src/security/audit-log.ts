/**
 * Audit Log - Cloudflare Workers Edition
 * Hades Army v0.9.0 — Architecture Completion & Production Readiness
 *
 * Section 9: Security — Audit Log
 *
 * Records ALL significant platform events:
 *   - Repository connections
 *   - Agent decisions (Manager / Builder / Reviewer)
 *   - PR actions (create / merge / rollback)
 *   - Memory changes (.hades/ writes)
 *   - Mode switches
 *   - Secret scanner blocks
 *
 * Storage: D1 (audit_log table) with KV cache for recent queries.
 *
 * Every record is IMMUTABLE — once written, it cannot be modified.
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export type AuditCategory =
  | "repository_connection"
  | "repository_scan"
  | "agent_decision"
  | "builder_patch"
  | "reviewer_verdict"
  | "manager_decision"
  | "pr_action"
  | "merge"
  | "rollback"
  | "memory_change"
  | "mode_switch"
  | "secret_block"
  | "approval_request"
  | "approval_decision"
  | "system_event";

export type AuditSeverity = "info" | "warning" | "critical";

export interface AuditEntry {
  id: string;
  category: AuditCategory;
  severity: AuditSeverity;
  actor: string;       // user id, "manager", "builder", "reviewer", "system"
  action: string;      // specific action, e.g. "create_pr", "merge_pr"
  projectId?: string;
  workflowId?: string;
  taskId?: string;
  repositoryFullName?: string;
  details: Record<string, unknown>;
  timestamp: string;
  /** optional related audit entry id (for chaining) */
  parentId?: string;
}

export interface AuditQuery {
  category?: AuditCategory;
  severity?: AuditSeverity;
  actor?: string;
  projectId?: string;
  workflowId?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
}

// ============================================
// Audit Log Service
// ============================================

export class AuditLog {
  private env: HadesBindings;
  private recentCache: AuditEntry[] = [];

  constructor(env: HadesBindings) {
    this.env = env;
  }

  // ============================================
  // Record (immutable)
  // ============================================

  async record(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry> {
    const full: AuditEntry = {
      ...entry,
      id: generateId("audit"),
      timestamp: new Date().toISOString(),
    };

    // Push to in-memory cache (most recent 100)
    this.recentCache.push(full);
    if (this.recentCache.length > 100) this.recentCache = this.recentCache.slice(-100);

    // Persist to D1
    try {
      await this.env.HADES_DB
        .prepare(
          `INSERT INTO audit_log (id, category, severity, actor, action, project_id, workflow_id, task_id, repository_full_name, details, timestamp, parent_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          full.id,
          full.category,
          full.severity,
          full.actor,
          full.action,
          full.projectId ?? null,
          full.workflowId ?? null,
          full.taskId ?? null,
          full.repositoryFullName ?? null,
          JSON.stringify(full.details),
          full.timestamp,
          full.parentId ?? null,
        )
        .run();
    } catch (err) {
      // Audit log failures should not break the workflow — log and continue
      logger.error(`AuditLog: D1 write failed`, {
        auditId: full.id,
        category: full.category,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info(`AuditLog: ${full.category} ${full.action} by ${full.actor}`, {
      auditId: full.id,
      severity: full.severity,
    });

    return full;
  }

  // ============================================
  // Query
  // ============================================

  async query(q: AuditQuery): Promise<AuditEntry[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q.category) {
      conditions.push("category = ?");
      params.push(q.category);
    }
    if (q.severity) {
      conditions.push("severity = ?");
      params.push(q.severity);
    }
    if (q.actor) {
      conditions.push("actor = ?");
      params.push(q.actor);
    }
    if (q.projectId) {
      conditions.push("project_id = ?");
      params.push(q.projectId);
    }
    if (q.workflowId) {
      conditions.push("workflow_id = ?");
      params.push(q.workflowId);
    }
    if (q.startTime) {
      conditions.push("timestamp >= ?");
      params.push(q.startTime);
    }
    if (q.endTime) {
      conditions.push("timestamp <= ?");
      params.push(q.endTime);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(q.limit ?? 50, 500);

    try {
      const result = await this.env.HADES_DB
        .prepare(`SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ${limit}`)
        .bind(...params)
        .all();
      return (result.results ?? []).map((r) => this.rowToEntry(r));
    } catch (err) {
      logger.warn(`AuditLog: D1 query failed, returning cache`, { err });
      return this.recentCache
        .filter((e) => (!q.category || e.category === q.category) && (!q.actor || e.actor === q.actor))
        .slice(-limit);
    }
  }

  // ============================================
  // Convenience recorders
  // ============================================

  async recordRepositoryConnection(userId: string, repositoryFullName: string, success: boolean): Promise<void> {
    await this.record({
      category: "repository_connection",
      severity: success ? "info" : "warning",
      actor: userId,
      action: success ? "connect" : "connect_failed",
      repositoryFullName,
      details: { success },
    });
  }

  async recordAgentDecision(
    agent: "manager" | "builder" | "reviewer",
    action: string,
    workflowId: string,
    taskId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.record({
      category: agent === "manager" ? "manager_decision" : agent === "builder" ? "builder_patch" : "reviewer_verdict",
      severity: "info",
      actor: agent,
      action,
      workflowId,
      taskId,
      details,
    });
  }

  async recordPRAction(
    action: "create_pr" | "merge_pr" | "rollback",
    repositoryFullName: string,
    workflowId: string,
    details: Record<string, unknown>,
    severity: AuditSeverity = "info",
  ): Promise<void> {
    const category: AuditEntry["category"] = action === "merge_pr" ? "merge" : action === "rollback" ? "rollback" : "pr_action";
    await this.record({
      category,
      severity,
      actor: "manager",
      action,
      repositoryFullName,
      workflowId,
      details,
    });
  }

  async recordMemoryChange(
    actor: string,
    projectId: string,
    action: string,
    path: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await this.record({
      category: "memory_change",
      severity: "info",
      actor,
      action,
      projectId,
      details: { path, ...details },
    });
  }

  async recordModeSwitch(userId: string, from: string, to: string): Promise<void> {
    await this.record({
      category: "mode_switch",
      severity: "info",
      actor: userId,
      action: "mode_switch",
      details: { from, to },
    });
  }

  async recordSecretBlock(repositoryFullName: string, workflowId: string, findings: Array<{ rule: string; file: string }>): Promise<void> {
    await this.record({
      category: "secret_block",
      severity: "critical",
      actor: "system",
      action: "pr_blocked_by_secret_scanner",
      repositoryFullName,
      workflowId,
      details: { findingsCount: findings.length, findings: findings.slice(0, 10) },
    });
  }

  async recordApproval(userId: string, workflowId: string, decision: "approve" | "reject"): Promise<void> {
    await this.record({
      category: "approval_decision",
      severity: "info",
      actor: userId,
      action: decision,
      workflowId,
      details: { decision },
    });
  }

  // ============================================
  // Helpers
  // ============================================

  private rowToEntry(row: unknown): AuditEntry {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id ?? ""),
      category: String(r.category ?? "system_event") as AuditCategory,
      severity: String(r.severity ?? "info") as AuditSeverity,
      actor: String(r.actor ?? ""),
      action: String(r.action ?? ""),
      projectId: r.project_id ? String(r.project_id) : undefined,
      workflowId: r.workflow_id ? String(r.workflow_id) : undefined,
      taskId: r.task_id ? String(r.task_id) : undefined,
      repositoryFullName: r.repository_full_name ? String(r.repository_full_name) : undefined,
      details: r.details ? JSON.parse(String(r.details)) : {},
      timestamp: String(r.timestamp ?? ""),
      parentId: r.parent_id ? String(r.parent_id) : undefined,
    };
  }
}

// ============================================
// Factory
// ============================================

let _instance: AuditLog | null = null;

export function getAuditLog(env: HadesBindings): AuditLog {
  if (!_instance) _instance = new AuditLog(env);
  return _instance;
}
