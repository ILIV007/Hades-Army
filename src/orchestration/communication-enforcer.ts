/**
 * Agent Communication Enforcer - Cloudflare Workers Edition
 * Hades Army v0.9.0 — Architecture Completion & Production Readiness
 *
 * Section 3: Agent Communication Protocol
 *
 * Enforces that EVERY interaction between agents goes through the
 * structured Agent Communication Protocol. No direct shortcuts.
 * No bypasses. Everything auditable.
 *
 * This module wraps the v0.8.5 agent-communication module with
 * enforcement guards:
 *   - Verifies the sender has the right to send the message kind
 *   - Records every message to D1 (agent_messages table) for audit
 *   - Throws on protocol violations
 */

import { logger } from "../utils/logger";
import {
  AgentMessageBuilder,
  validateMessage,
  agentMessageLog,
  type AgentMessage,
  type ManagerToBuilderPayload,
  type BuilderToReviewerPayload,
  type ReviewerToManagerPayload,
  type ManagerToReviewerPayload,
  type ManagerToBuilderAckPayload,
  type SystemPayload,
  type MessageKind,
  type AgentRole,
} from "../orchestration/agent-communication";
import type { HadesBindings } from "../types";

// ============================================
// Enforcer
// ============================================

export class AgentCommunicationEnforcer {
  private env: HadesBindings;

  constructor(env: HadesBindings) {
    this.env = env;
  }

  // ============================================
  // Send (with audit persistence)
  // ============================================

  async send(message: AgentMessage): Promise<AgentMessage> {
    // Validate
    const errors = validateMessage(message);
    if (errors.length > 0) {
      throw new Error(`AgentCommunication protocol violation: ${errors.join("; ")}`);
    }

    // Mark delivered
    message.deliveredAt = new Date().toISOString();
    message.status = "delivered";

    // Record to in-memory log
    agentMessageLog.record(message);

    // Persist to D1 for audit
    await this.persistToD1(message);

    logger.info(`AgentComms: ${message.kind} ${message.from}->${message.to} task=${message.taskId}`, {
      messageId: message.id,
    });

    return message;
  }

  // ============================================
  // Typed senders — enforce sender role
  // ============================================

  async sendFromManagerToBuilder(payload: ManagerToBuilderPayload): Promise<AgentMessage> {
    return this.send(AgentMessageBuilder.managerToBuilder(payload));
  }

  async sendFromManagerToReviewer(payload: ManagerToReviewerPayload): Promise<AgentMessage> {
    return this.send(AgentMessageBuilder.managerToReviewer(payload));
  }

  async sendFromManagerToBuilderAck(payload: ManagerToBuilderAckPayload): Promise<AgentMessage> {
    return this.send(AgentMessageBuilder.managerToBuilderAck(payload));
  }

  async sendFromBuilderToReviewer(payload: BuilderToReviewerPayload): Promise<AgentMessage> {
    return this.send(AgentMessageBuilder.builderToReviewer(payload));
  }

  async sendFromReviewerToManager(payload: ReviewerToManagerPayload): Promise<AgentMessage> {
    return this.send(AgentMessageBuilder.reviewerToManager(payload));
  }

  async sendSystem(payload: SystemPayload): Promise<AgentMessage> {
    return this.send(AgentMessageBuilder.system(payload));
  }

  // ============================================
  // Audit queries
  // ============================================

  async getAuditTrail(taskId: string): Promise<AgentMessage[]> {
    // Try D1 first
    try {
      const db = this.env.HADES_DB;
      const result = await db
        .prepare("SELECT * FROM agent_messages WHERE task_id = ? ORDER BY sent_at ASC")
        .bind(taskId)
        .all();
      if (result.results && result.results.length > 0) {
        return result.results as unknown as AgentMessage[];
      }
    } catch (err) {
      logger.debug(`AgentComms: D1 audit query failed, falling back to in-memory`, { err });
    }
    // Fallback to in-memory log
    return agentMessageLog.getByTask(taskId);
  }

  async countMessagesByKind(kind: MessageKind): Promise<number> {
    try {
      const result = await this.env.HADES_DB
        .prepare("SELECT COUNT(*) as count FROM agent_messages WHERE kind = ?")
        .bind(kind)
        .first<{ count: number }>();
      return result?.count ?? 0;
    } catch {
      return agentMessageLog.getByKind(kind).length;
    }
  }

  // ============================================
  // Sender verification
  // ============================================

  /**
   * Verifies that a given agent role has the right to send a message
   * of the given kind. Throws on violation.
   */
  assertCanSend(sender: AgentRole, kind: MessageKind): void {
    const allowed: Record<MessageKind, AgentRole> = {
      MANAGER_TO_BUILDER: "manager",
      MANAGER_TO_REVIEWER: "manager",
      MANAGER_TO_BUILDER_ACK: "manager",
      BUILDER_TO_REVIEWER: "builder",
      REVIEWER_TO_MANAGER: "reviewer",
      SYSTEM: "system",
    };
    if (allowed[kind] !== sender) {
      throw new Error(`AgentComms: role "${sender}" cannot send message kind "${kind}" (allowed: "${allowed[kind]}")`);
    }
  }

  // ============================================
  // Private: D1 persistence
  // ============================================

  private async persistToD1(message: AgentMessage): Promise<void> {
    try {
      await this.env.HADES_DB
        .prepare(
          `INSERT INTO agent_messages (id, kind, from_role, to_role, task_id, project_id, payload, status, sent_at, delivered_at, acknowledged_at, parent_message_id, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          message.id,
          message.kind,
          message.from,
          message.to,
          message.taskId,
          message.projectId ?? null,
          JSON.stringify(message.payload),
          message.status,
          message.sentAt,
          message.deliveredAt ?? null,
          message.acknowledgedAt ?? null,
          message.parentMessageId ?? null,
          message.metadata ? JSON.stringify(message.metadata) : null,
        )
        .run();
    } catch (err) {
      // Don't fail the workflow if D1 is unavailable — log and continue.
      // The in-memory log still has the audit record for the current request.
      logger.warn(`AgentComms: D1 persistence failed (continuing with in-memory log)`, {
        messageId: message.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ============================================
// Factory
// ============================================

export function getAgentCommunicationEnforcer(env: HadesBindings): AgentCommunicationEnforcer {
  return new AgentCommunicationEnforcer(env);
}
