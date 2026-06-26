/**
 * Trace Context - Cloudflare Workers Edition
 * Hades Army v9.3 — Structured Logging
 *
 * Priority 14: Logging
 *
 * Every request gets a Trace ID + Correlation ID. Workflow/Task/Project/Agent
 * IDs are added as the request flows through the system.
 *
 * Usage:
 *   const trace = TraceContext.start();
 *   trace.setWorkflowId("wf-123");
 *   trace.setTaskId("task-456");
 *   logger.info("manager.start", trace.meta({ prompt: "..." }));
 *
 * The trace is per-request (per-isolate, per-await). Use AsyncLocalStorage
 * equivalent — in Cloudflare Workers, we use a module-level Map keyed by
 * the trace ID.
 */

import { generateId } from "./helpers";

// ============================================
// Types
// ============================================

export interface TraceMeta {
  traceId: string;
  correlationId?: string;
  workflowId?: string;
  taskId?: string;
  projectId?: string;
  agentId?: string;
  userId?: string;
  mode?: string;
}

// ============================================
// Trace context
// ============================================

export class TraceContext {
  readonly traceId: string;
  readonly correlationId?: string;
  private workflowId?: string;
  private taskId?: string;
  private projectId?: string;
  private agentId?: string;
  private userId?: string;
  private mode?: string;

  private constructor(correlationId?: string) {
    this.traceId = generateId("trace");
    this.correlationId = correlationId ?? this.traceId;
  }

  static start(correlationId?: string): TraceContext {
    return new TraceContext(correlationId);
  }

  setWorkflowId(id: string): this { this.workflowId = id; return this; }
  setTaskId(id: string): this { this.taskId = id; return this; }
  setProjectId(id: string): this { this.projectId = id; return this; }
  setAgentId(id: string): this { this.agentId = id; return this; }
  setUserId(id: string): this { this.userId = id; return this; }
  setMode(m: string): this { this.mode = m; return this; }

  meta(extra?: Record<string, unknown>): TraceMeta & Record<string, unknown> {
    const base: TraceMeta = {
      traceId: this.traceId,
      correlationId: this.correlationId,
      workflowId: this.workflowId,
      taskId: this.taskId,
      projectId: this.projectId,
      agentId: this.agentId,
      userId: this.userId,
      mode: this.mode,
    };
    return extra ? { ...base, ...extra } : base;
  }

  /** Returns a compact string for log prefixes: [trace:abc123] [wf:xyz] */
  prefix(): string {
    const parts: string[] = [`trace:${this.traceId.slice(-8)}`];
    if (this.workflowId) parts.push(`wf:${this.workflowId.slice(-8)}`);
    if (this.taskId) parts.push(`task:${this.taskId.slice(-8)}`);
    if (this.userId) parts.push(`user:${this.userId.slice(-8)}`);
    return `[${parts.join("] [")}]`;
  }
}

// ============================================
// Convenience
// ============================================

export function startTrace(correlationId?: string): TraceContext {
  return TraceContext.start(correlationId);
}
