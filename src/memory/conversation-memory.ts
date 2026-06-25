/**
 * Conversation Memory - Cloudflare Workers Edition
 * Hades Army v0.9.1 — Production Readiness
 *
 * Priority 2: Memory Reliability
 *
 * The Manager must remember per-user conversation state:
 *   - current project
 *   - selected repository
 *   - current workflow
 *   - current mode (plan / build / explore)
 *   - previous approvals
 *   - previous clarifying-question answers
 *
 * The user should NEVER need to repeat context.
 *
 * Storage: KV (per-user, 30-day TTL) with D1 mirror for durability.
 * The Memory Sync Engine reconciles the two.
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";
import type { OperationMode } from "../modes/operation-modes";

// ============================================
// Types
// ============================================

export interface ConversationState {
  userId: string;
  activeProjectId?: string;
  activeRepository?: string;
  activeWorkflowId?: string;
  activeMode: OperationMode;
  recentApprovals: Array<{
    workflowId: string;
    decision: "approve" | "reject";
    at: string;
  }>;
  clarifyingAnswers: Record<string, string>;
  lastInteractionAt: string;
  createdAt: string;
}

export interface ConversationMemorySnapshot {
  state: ConversationState;
  /** true if state was loaded from KV (vs fresh) */
  restored: boolean;
}

// ============================================
// Conversation Memory
// ============================================

const KV_PREFIX = "conversation:";
const KV_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export class ConversationMemory {
  private env: HadesBindings;

  constructor(env: HadesBindings) {
    this.env = env;
  }

  // ============================================
  // Load (restore or create)
  // ============================================

  async load(userId: string): Promise<ConversationMemorySnapshot> {
    const existing = await this.readFromKv(userId);
    if (existing) {
      return { state: existing, restored: true };
    }
    const fresh: ConversationState = {
      userId,
      activeMode: "plan",
      recentApprovals: [],
      clarifyingAnswers: {},
      lastInteractionAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    await this.writeToKv(userId, fresh);
    return { state: fresh, restored: false };
  }

  // ============================================
  // Update fields
  // ============================================

  async setActiveProject(userId: string, projectId: string): Promise<void> {
    await this.update(userId, (s) => { s.activeProjectId = projectId; });
  }

  async setActiveRepository(userId: string, repositoryFullName: string): Promise<void> {
    await this.update(userId, (s) => { s.activeRepository = repositoryFullName; });
  }

  async setActiveWorkflow(userId: string, workflowId: string): Promise<void> {
    await this.update(userId, (s) => { s.activeWorkflowId = workflowId; });
  }

  async setMode(userId: string, mode: OperationMode): Promise<void> {
    await this.update(userId, (s) => { s.activeMode = mode; });
  }

  async recordApproval(
    userId: string,
    workflowId: string,
    decision: "approve" | "reject",
  ): Promise<void> {
    await this.update(userId, (s) => {
      s.recentApprovals.unshift({ workflowId, decision, at: new Date().toISOString() });
      // Keep last 10 approvals
      s.recentApprovals = s.recentApprovals.slice(0, 10);
    });
  }

  async recordClarifyingAnswer(userId: string, questionId: string, answer: string): Promise<void> {
    await this.update(userId, (s) => {
      s.clarifyingAnswers[questionId] = answer;
    });
  }

  async clearWorkflow(userId: string): Promise<void> {
    await this.update(userId, (s) => { s.activeWorkflowId = undefined; });
  }

  // ============================================
  // Reset (full clear — used by /reset command)
  // ============================================

  async reset(userId: string): Promise<void> {
    const fresh: ConversationState = {
      userId,
      activeMode: "plan",
      recentApprovals: [],
      clarifyingAnswers: {},
      lastInteractionAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    await this.writeToKv(userId, fresh);
    logger.info(`ConversationMemory: reset for user ${userId}`);
  }

  // ============================================
  // Snapshot for dashboard
  // ============================================

  async getSnapshot(userId: string): Promise<{
    activeProject: string | undefined;
    activeRepository: string | undefined;
    activeWorkflow: string | undefined;
    activeMode: OperationMode;
    recentApprovalsCount: number;
    lastInteractionAt: string;
  }> {
    const { state } = await this.load(userId);
    return {
      activeProject: state.activeProjectId,
      activeRepository: state.activeRepository,
      activeWorkflow: state.activeWorkflowId,
      activeMode: state.activeMode,
      recentApprovalsCount: state.recentApprovals.length,
      lastInteractionAt: state.lastInteractionAt,
    };
  }

  // ============================================
  // Private: KV read/write
  // ============================================

  private async readFromKv(userId: string): Promise<ConversationState | undefined> {
    if (!this.env.HADES_KV) return undefined;
    const raw = await this.env.HADES_KV.get(this.kvKey(userId));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as ConversationState;
    } catch {
      logger.warn(`ConversationMemory: corrupted state for user ${userId}, ignoring`);
      return undefined;
    }
  }

  private async writeToKv(userId: string, state: ConversationState): Promise<void> {
    if (!this.env.HADES_KV) return;
    await this.env.HADES_KV.put(this.kvKey(userId), JSON.stringify(state), {
      expirationTtl: KV_TTL_SECONDS,
    });
  }

  private async update(
    userId: string,
    fn: (state: ConversationState) => void,
  ): Promise<void> {
    const { state } = await this.load(userId);
    fn(state);
    state.lastInteractionAt = new Date().toISOString();
    await this.writeToKv(userId, state);
  }

  private kvKey(userId: string): string {
    return `${KV_PREFIX}${userId}`;
  }
}

// ============================================
// Factory
// ============================================

let _instance: ConversationMemory | null = null;

export function getConversationMemory(env: HadesBindings): ConversationMemory {
  if (!_instance) _instance = new ConversationMemory(env);
  return _instance;
}
