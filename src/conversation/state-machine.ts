/**
 * Conversation State Machine - Cloudflare Workers Edition
 * Hades Army v9.5 — Complete Architecture, UX, Workflow & Stability
 *
 * Priority 1+2: Fix Repository Wizard State Machine + Rewrite Telegram Conversation Engine
 *
 * Each user has a SINGLE conversation state at any time. The Message Router
 * checks the state BEFORE dispatching to handlers.
 */

import { logger } from "../utils/logger";
import type { HadesBindings } from "../types";
import { getConversationMemory } from "../memory/conversation-memory";

// ============================================
// Types
// ============================================

export type ConversationState =
  | "HOME"
  | "WAITING_REPO_URL"
  | "VALIDATING_REPO"
  | "PROJECT_CREATED"
  | "PLAN_MODE"
  | "BUILD_MODE"
  | "REVIEW_MODE"
  | "DEPLOY_MODE"
  | "WAITING_APPROVAL"
  | "WAITING_CLARIFICATION";

export interface StateContext {
  state: ConversationState;
  data?: Record<string, unknown>;
  enteredAt: string;
}

export interface StateTransitionResult {
  ok: boolean;
  fromState: ConversationState;
  toState: ConversationState;
  reason?: string;
}

// ============================================
// Valid transitions
// ============================================

const VALID_TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  HOME: ["WAITING_REPO_URL", "PLAN_MODE", "BUILD_MODE", "REVIEW_MODE", "PROJECT_CREATED", "HOME"],
  WAITING_REPO_URL: ["VALIDATING_REPO", "HOME", "WAITING_REPO_URL"],
  VALIDATING_REPO: ["PROJECT_CREATED", "WAITING_REPO_URL", "HOME", "VALIDATING_REPO"],
  PROJECT_CREATED: ["PLAN_MODE", "BUILD_MODE", "REVIEW_MODE", "HOME", "PROJECT_CREATED"],
  PLAN_MODE: ["BUILD_MODE", "HOME", "WAITING_APPROVAL", "WAITING_CLARIFICATION", "PLAN_MODE"],
  BUILD_MODE: ["REVIEW_MODE", "HOME", "WAITING_APPROVAL", "WAITING_CLARIFICATION", "BUILD_MODE"],
  REVIEW_MODE: ["DEPLOY_MODE", "HOME", "BUILD_MODE", "REVIEW_MODE"],
  DEPLOY_MODE: ["HOME", "PROJECT_CREATED", "DEPLOY_MODE"],
  WAITING_APPROVAL: ["DEPLOY_MODE", "HOME", "PLAN_MODE", "BUILD_MODE", "WAITING_APPROVAL"],
  WAITING_CLARIFICATION: ["PLAN_MODE", "BUILD_MODE", "HOME", "WAITING_CLARIFICATION"],
};

// ============================================
// State Machine
// ============================================

const STATE_KV_PREFIX = "conv-state:";
const STATE_DATA_KV_PREFIX = "conv-state-data:";

export class ConversationStateMachine {
  private env: HadesBindings;
  private convMem: ReturnType<typeof getConversationMemory>;

  constructor(env: HadesBindings) {
    this.env = env;
    this.convMem = getConversationMemory(env);
  }

  async getState(userId: string): Promise<StateContext> {
    try {
      if (this.env.HADES_KV) {
        const raw = await this.env.HADES_KV.get(`${STATE_KV_PREFIX}${userId}`);
        if (raw) {
          return JSON.parse(raw) as StateContext;
        }
      }
      // Fallback: derive from conversation memory
      const snap = await this.convMem.getSnapshot(userId);
      let state: ConversationState = "HOME";
      if (snap.activeWorkflow === "wizard:connect_repo") state = "WAITING_REPO_URL";
      else if (snap.activeRepository) state = "PROJECT_CREATED";
      else if (snap.activeMode === "plan") state = "PLAN_MODE";
      else if (snap.activeMode === "build") state = "BUILD_MODE";
      return { state, enteredAt: snap.lastInteractionAt };
    } catch (err) {
      logger.warn("CSM: getState failed, defaulting to HOME", { err });
      return { state: "HOME", enteredAt: new Date().toISOString() };
    }
  }

  async transition(
    userId: string,
    toState: ConversationState,
    data?: Record<string, unknown>,
  ): Promise<StateTransitionResult> {
    const current = await this.getState(userId);
    const fromState = current.state;

    const allowed = VALID_TRANSITIONS[fromState] ?? [];
    if (!allowed.includes(toState) && fromState !== toState) {
      logger.warn("CSM: invalid transition", { userId, fromState, toState });
      return { ok: false, fromState, toState, reason: `Invalid transition: ${fromState} → ${toState}` };
    }

    const newContext: StateContext = {
      state: toState,
      data,
      enteredAt: new Date().toISOString(),
    };

    try {
      if (this.env.HADES_KV) {
        await this.env.HADES_KV.put(`${STATE_KV_PREFIX}${userId}`, JSON.stringify(newContext));
        if (data) {
          await this.env.HADES_KV.put(`${STATE_DATA_KV_PREFIX}${userId}`, JSON.stringify(data));
        } else {
          await this.env.HADES_KV.delete(`${STATE_DATA_KV_PREFIX}${userId}`);
        }
      }
    } catch (err) {
      logger.warn("CSM: KV persist failed", { err });
    }

    // Sync to conversation memory for backward compat
    try {
      if (toState === "WAITING_REPO_URL") {
        await this.convMem.setActiveWorkflow(userId, "wizard:connect_repo");
      } else if (toState === "HOME" || toState === "PROJECT_CREATED") {
        await this.convMem.clearWorkflow(userId);
      }
    } catch {}

    logger.info("CSM: transition", { userId, fromState, toState });
    return { ok: true, fromState, toState };
  }

  async getStateData(userId: string): Promise<Record<string, unknown> | undefined> {
    try {
      if (!this.env.HADES_KV) return undefined;
      const raw = await this.env.HADES_KV.get(`${STATE_DATA_KV_PREFIX}${userId}`);
      return raw ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  }

  async reset(userId: string): Promise<void> {
    await this.transition(userId, "HOME");
  }

  async isInState(userId: string, state: ConversationState): Promise<boolean> {
    const current = await this.getState(userId);
    return current.state === state;
  }

  async canTransition(userId: string, toState: ConversationState): Promise<boolean> {
    const current = await this.getState(userId);
    const allowed = VALID_TRANSITIONS[current.state] ?? [];
    return allowed.includes(toState) || current.state === toState;
  }
}

// ============================================
// Factory
// ============================================

let _instance: ConversationStateMachine | null = null;

export function getConversationStateMachine(env: HadesBindings): ConversationStateMachine {
  if (!_instance) _instance = new ConversationStateMachine(env);
  return _instance;
}

// ============================================
// State metadata (for UI)
// ============================================

export const STATE_METADATA: Record<ConversationState, { emoji: string; label: string; description: string }> = {
  HOME: { emoji: "🏠", label: "Home", description: "Main menu" },
  WAITING_REPO_URL: { emoji: "🔗", label: "Waiting for Repository URL", description: "Send your GitHub repository URL" },
  VALIDATING_REPO: { emoji: "⏳", label: "Validating Repository", description: "Manager is checking the repository" },
  PROJECT_CREATED: { emoji: "✅", label: "Project Ready", description: "Repository connected, project created" },
  PLAN_MODE: { emoji: "🧠", label: "Plan Mode", description: "Analysis and planning only — no code changes" },
  BUILD_MODE: { emoji: "⚒️", label: "Build Mode", description: "Executing approved plan — code changes allowed" },
  REVIEW_MODE: { emoji: "🛡️", label: "Review Mode", description: "Reviewing code or PR" },
  DEPLOY_MODE: { emoji: "🚀", label: "Deploy Mode", description: "Deploying changes" },
  WAITING_APPROVAL: { emoji: "⏳", label: "Waiting for Approval", description: "Approve or reject the proposed changes" },
  WAITING_CLARIFICATION: { emoji: "❓", label: "Waiting for Clarification", description: "Manager asked a question — please answer" },
};
