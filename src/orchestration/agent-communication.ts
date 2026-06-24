/**
 * Agent Communication Protocol - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Priority 1: Real Agent Orchestration
 *
 * Defines the structured, auditable communication protocol
 * between Manager ↔ Builder ↔ Reviewer.
 *
 * All inter-agent messages MUST go through this module.
 * No agent may directly call another agent's methods — they send
 * typed messages that are recorded in D1 for auditability.
 *
 * Message types:
 *   - MANAGER_TO_BUILDER     : task assignment + repo/memory context
 *   - BUILDER_TO_REVIEWER    : patch + changed files + rationale
 *   - REVIEWER_TO_MANAGER    : status + issues + recommendation
 *   - MANAGER_TO_REVIEWER    : direct review request (e.g. for architecture)
 *   - MANAGER_TO_BUILDER_ACK : ack / clarification / abort
 *   - SYSTEM                 : lifecycle events (timeout, retry, abort)
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";

// ============================================
// Core Protocol Types
// ============================================

export type AgentRole = "manager" | "builder" | "reviewer" | "system";

export type MessageKind =
  | "MANAGER_TO_BUILDER"
  | "BUILDER_TO_REVIEWER"
  | "REVIEWER_TO_MANAGER"
  | "MANAGER_TO_REVIEWER"
  | "MANAGER_TO_BUILDER_ACK"
  | "SYSTEM";

export type MessageStatus = "sent" | "delivered" | "acknowledged" | "failed";

// ============================================
// Payloads (exact shapes from spec)
// ============================================

/**
 * Manager → Builder
 * Carries the task assignment plus the repository and memory context
 * that the Builder needs to generate a patch. The Builder MUST NOT
 * fetch repository or memory data directly — it consumes only what
 * the Manager provides here.
 */
export interface ManagerToBuilderPayload {
  taskId: string;
  projectId: string;
  objective: string;
  repositoryContext: RepositoryContext;
  memoryContext: MemoryContext;
  constraints?: {
    maxFiles?: number;
    maxLines?: number;
    forbiddenPaths?: string[];
    requiredTests?: boolean;
  };
}

/**
 * Builder → Reviewer
 * Carries the patch produced by the Builder plus the rationale.
 * The Reviewer MUST NOT call GitHub or read files outside this
 * payload — it validates only what the Builder provides.
 */
export interface BuilderToReviewerPayload {
  taskId: string;
  patch: PatchArtifact;
  changedFiles: ChangedFile[];
  rationale: string;
  confidence: number;
  estimatedRisk: "low" | "medium" | "high";
}

/**
 * Reviewer → Manager
 * Carries the review verdict back to the Manager. The Manager is
 * the sole decider of whether the patch proceeds to GitHub.
 */
export interface ReviewerToManagerPayload {
  taskId: string;
  status: "approved" | "rejected" | "changes_requested";
  issues: ReviewIssue[];
  recommendation: string;
  score: number;
}

/**
 * Manager → Reviewer (direct, e.g. for architecture or pre-build review)
 */
export interface ManagerToReviewerPayload {
  taskId: string;
  projectId: string;
  reviewType: "architecture" | "pre_build" | "post_merge" | "hotfix";
  target: string;
  context: Record<string, unknown>;
}

/**
 * Manager → Builder ack / clarification / abort
 */
export interface ManagerToBuilderAckPayload {
  taskId: string;
  action: "proceed" | "clarify" | "abort";
  feedback?: string;
  clarificationQuestions?: string[];
}

/**
 * System lifecycle messages (timeouts, retries, aborts)
 */
export interface SystemPayload {
  taskId: string;
  event: "timeout" | "retry" | "abort" | "queue_full";
  reason: string;
  attempt?: number;
}

// ============================================
// Supporting Types
// ============================================

export interface RepositoryContext {
  repositoryId: string;
  fullName: string;
  defaultBranch: string;
  targetBranch: string;
  architecture: {
    languages: string[];
    frameworks: string[];
    style: string;
    conventions: string[];
  };
  relevantFiles: Array<{
    path: string;
    content: string;
    reason: string;
  }>;
}

export interface MemoryContext {
  projectMemory: {
    architecture: unknown;
    roadmap: unknown;
    conventions: string[];
  };
  relevantDecisions: Array<{ id: string; title: string; rationale: string }>;
  pastFailures: Array<{ id: string; summary: string; lesson: string }>;
  knowledgeNotes: string[];
}

export interface PatchArtifact {
  format: "unified_diff" | "file_replacement" | "new_file";
  content: string;
  baseSha: string;
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
}

export interface ReviewIssue {
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

// ============================================
// Envelope
// ============================================

export interface AgentMessage<T = unknown> {
  id: string;
  kind: MessageKind;
  from: AgentRole;
  to: AgentRole;
  taskId: string;
  projectId?: string;
  payload: T;
  status: MessageStatus;
  sentAt: string;
  deliveredAt?: string;
  acknowledgedAt?: string;
  parentMessageId?: string;
  metadata?: Record<string, unknown>;
}

// ============================================
// Builder
// ============================================

export class AgentMessageBuilder {
  static managerToBuilder(
    payload: ManagerToBuilderPayload,
    metadata?: Record<string, unknown>,
  ): AgentMessage<ManagerToBuilderPayload> {
    return this.build("MANAGER_TO_BUILDER", "manager", "builder", payload.taskId, payload.projectId, payload, metadata);
  }

  static builderToReviewer(
    payload: BuilderToReviewerPayload,
    metadata?: Record<string, unknown>,
  ): AgentMessage<BuilderToReviewerPayload> {
    return this.build("BUILDER_TO_REVIEWER", "builder", "reviewer", payload.taskId, payload.patch.baseSha ? payload.taskId : payload.taskId, undefined, payload, metadata);
  }

  static reviewerToManager(
    payload: ReviewerToManagerPayload,
    metadata?: Record<string, unknown>,
  ): AgentMessage<ReviewerToManagerPayload> {
    return this.build("REVIEWER_TO_MANAGER", "reviewer", "manager", payload.taskId, undefined, payload, metadata);
  }

  static managerToReviewer(
    payload: ManagerToReviewerPayload,
    metadata?: Record<string, unknown>,
  ): AgentMessage<ManagerToReviewerPayload> {
    return this.build("MANAGER_TO_REVIEWER", "manager", "reviewer", payload.taskId, payload.projectId, payload, metadata);
  }

  static managerToBuilderAck(
    payload: ManagerToBuilderAckPayload,
    metadata?: Record<string, unknown>,
  ): AgentMessage<ManagerToBuilderAckPayload> {
    return this.build("MANAGER_TO_BUILDER_ACK", "manager", "builder", payload.taskId, undefined, payload, metadata);
  }

  static system(
    payload: SystemPayload,
    metadata?: Record<string, unknown>,
  ): AgentMessage<SystemPayload> {
    return this.build("SYSTEM", "system", "manager", payload.taskId, undefined, payload, metadata);
  }

  private static build<T>(
    kind: MessageKind,
    from: AgentRole,
    to: AgentRole,
    taskId: string,
    projectId: string | undefined,
    payload: T,
    metadata?: Record<string, unknown>,
  ): AgentMessage<T> {
    return {
      id: generateId("msg"),
      kind,
      from,
      to,
      taskId,
      projectId,
      payload,
      status: "sent",
      sentAt: new Date().toISOString(),
      metadata,
    };
  }
}

// ============================================
// In-memory log (auditable)
// ============================================

/**
 * In-memory message log. In production, this MUST be mirrored to
 * the `agent_messages` D1 table (see sql/v0.8.5-additions.sql).
 */
export class AgentMessageLog {
  private log: AgentMessage[] = [];

  record(message: AgentMessage): void {
    this.log.push(message);
    logger.info(`AgentMessage ${message.kind} ${message.from}->${message.to} task=${message.taskId}`, {
      messageId: message.id,
      status: message.status,
    });
  }

  getByTask(taskId: string): AgentMessage[] {
    return this.log.filter((m) => m.taskId === taskId);
  }

  getByKind(kind: MessageKind): AgentMessage[] {
    return this.log.filter((m) => m.kind === kind);
  }

  recent(limit = 50): AgentMessage[] {
    return this.log.slice(-limit);
  }

  size(): number {
    return this.log.length;
  }

  clear(): void {
    this.log = [];
  }
}

export const agentMessageLog = new AgentMessageLog();

// ============================================
// Delivery (validation only — actual dispatch lives in orchestration)
// ============================================

export function validateMessage(message: AgentMessage): string[] {
  const errors: string[] = [];

  // From/to rules
  if (message.from === message.to) errors.push("from and to cannot be the same role");

  // Kind ↔ from/to consistency
  const expected: Record<MessageKind, { from: AgentRole; to: AgentRole }> = {
    MANAGER_TO_BUILDER: { from: "manager", to: "builder" },
    BUILDER_TO_REVIEWER: { from: "builder", to: "reviewer" },
    REVIEWER_TO_MANAGER: { from: "reviewer", to: "manager" },
    MANAGER_TO_REVIEWER: { from: "manager", to: "reviewer" },
    MANAGER_TO_BUILDER_ACK: { from: "manager", to: "builder" },
    SYSTEM: { from: "system", to: "manager" },
  };
  const exp = expected[message.kind];
  if (message.from !== exp.from || message.to !== exp.to) {
    errors.push(`kind ${message.kind} requires from=${exp.from}, to=${exp.to}`);
  }

  // Payload presence
  if (!message.payload) errors.push("payload is required");

  // taskId presence
  if (!message.taskId) errors.push("taskId is required");

  return errors;
}

export function deliver(message: AgentMessage): { ok: boolean; errors: string[] } {
  const errors = validateMessage(message);
  if (errors.length > 0) {
    logger.warn(`AgentMessage rejected: ${message.id}`, { errors });
    return { ok: false, errors };
  }
  message.deliveredAt = new Date().toISOString();
  message.status = "delivered";
  agentMessageLog.record(message);
  return { ok: true, errors: [] };
}
