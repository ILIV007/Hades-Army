/**
 * Operation Modes - Cloudflare Workers Edition
 * Hades Army v0.9.0 — Architecture Completion & Production Readiness
 *
 * Section 7: Telegram UX Redesign — Operation Modes
 *
 * Three operation modes that change Manager behavior:
 *
 *   PLAN mode    → Manager behaves as ARCHITECT (think, don't act)
 *   BUILD mode   → Manager behaves as EXECUTOR  (act, don't challenge)
 *   EXPLORE mode → Manager behaves as ANALYST   (understand, don't change)
 *
 * Mode switching is enforced at the ManagerController level. The
 * ManagerPersonality module reads the active mode and adapts its
 * prompts and behavior accordingly.
 *
 * Modes are PER-USER (each Telegram user has their own active mode).
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export type OperationMode = "plan" | "build" | "explore";

export interface ModeCapabilities {
  /** Can the Manager generate code in this mode? */
  codeGeneration: boolean;
  /** Can the Manager create branches? */
  branchCreation: boolean;
  /** Can the Manager create PRs? */
  prCreation: boolean;
  /** Can the Manager modify the repository? */
  repoModification: boolean;
  /** Can the Manager challenge the user's request? */
  challengeUser: boolean;
  /** Can the Manager ask clarifying questions? */
  askQuestions: boolean;
  /** Can the Manager analyze the repository? */
  repoAnalysis: boolean;
  /** Can the Manager generate roadmaps? */
  roadmapGeneration: boolean;
  /** Can the Manager estimate cost? */
  costEstimation: boolean;
}

export interface ModeDescriptor {
  mode: OperationMode;
  emoji: string;
  label: string;
  tagline: string;
  description: string;
  capabilities: ModeCapabilities;
  managerRole: "architect" | "executor" | "analyst";
}

// ============================================
// Mode definitions
// ============================================

export const MODES: Record<OperationMode, ModeDescriptor> = {
  plan: {
    mode: "plan",
    emoji: "🧠",
    label: "Plan",
    tagline: "Think before acting",
    description: "Architecture review, risk analysis, cost estimation, roadmap generation, task breakdown. No code generation. No branches. No PRs. No repository changes.",
    capabilities: {
      codeGeneration: false,
      branchCreation: false,
      prCreation: false,
      repoModification: false,
      challengeUser: true,
      askQuestions: true,
      repoAnalysis: true,
      roadmapGeneration: true,
      costEstimation: true,
    },
    managerRole: "architect",
  },
  build: {
    mode: "build",
    emoji: "⚔️",
    label: "Build",
    tagline: "Execute approved plans",
    description: "Builder execution, Reviewer validation, PR creation. Only starts after an approved plan exists in Plan mode.",
    capabilities: {
      codeGeneration: true,
      branchCreation: true,
      prCreation: true,
      repoModification: true,
      challengeUser: false,
      askQuestions: false,
      repoAnalysis: false,
      roadmapGeneration: false,
      costEstimation: true,
    },
    managerRole: "executor",
  },
  explore: {
    mode: "explore",
    emoji: "🔍",
    label: "Explore",
    tagline: "Understand the repository",
    description: "Architecture reports, dependency graphs, technical debt reports, hotspot detection, repository insights. No code generation.",
    capabilities: {
      codeGeneration: false,
      branchCreation: false,
      prCreation: false,
      repoModification: false,
      challengeUser: true,
      askQuestions: true,
      repoAnalysis: true,
      roadmapGeneration: false,
      costEstimation: false,
    },
    managerRole: "analyst",
  },
};

// ============================================
// Mode Manager (per-user state)
// ============================================

export class ModeManager {
  private env: HadesBindings;
  /** Per-user active mode */
  private userModes: Map<string, OperationMode> = new Map();
  /** Per-user pending approved plan (for Build mode) */
  private approvedPlans: Map<string, unknown> = new Map();

  constructor(env: HadesBindings) {
    this.env = env;
  }

  /** Get the user's active mode (default: plan) */
  getMode(userId: string): OperationMode {
    return this.userModes.get(userId) ?? "plan";
  }

  /** Set the user's active mode */
  setMode(userId: string, mode: OperationMode): { ok: boolean; reason?: string } {
    // Build mode requires an approved plan
    if (mode === "build" && !this.approvedPlans.has(userId)) {
      return {
        ok: false,
        reason: "Build mode requires an approved plan. Switch to Plan mode first, generate a plan, and get it approved.",
      };
    }
    this.userModes.set(userId, mode);
    logger.info(`ModeManager: user ${userId} switched to ${mode} mode`);
    return { ok: true };
  }

  /** Get the user's capabilities (based on their active mode) */
  getCapabilities(userId: string): ModeCapabilities {
    return MODES[this.getMode(userId)].capabilities;
  }

  /** Get the user's mode descriptor */
  getDescriptor(userId: string): ModeDescriptor {
    return MODES[this.getMode(userId)];
  }

  /** Record an approved plan (unlocks Build mode) */
  recordApprovedPlan(userId: string, plan: unknown): void {
    this.approvedPlans.set(userId, plan);
    logger.info(`ModeManager: approved plan recorded for user ${userId}`);
  }

  /** Consume the approved plan (called when Build mode starts) */
  consumeApprovedPlan(userId: string): unknown | undefined {
    const plan = this.approvedPlans.get(userId);
    if (plan) {
      this.approvedPlans.delete(userId);
    }
    return plan;
  }

  /** Has the user got an approved plan ready? */
  hasApprovedPlan(userId: string): boolean {
    return this.approvedPlans.has(userId);
  }

  // ============================================
  // Persistence (KV-backed)
  // ============================================

  async persist(userId: string): Promise<void> {
    if (!this.env.HADES_KV) return;
    const state = {
      mode: this.getMode(userId),
      hasPlan: this.approvedPlans.has(userId),
    };
    await this.env.HADES_KV.put(`mode:${userId}`, JSON.stringify(state));
  }

  async restore(userId: string): Promise<void> {
    if (!this.env.HADES_KV) return;
    const raw = await this.env.HADES_KV.get(`mode:${userId}`);
    if (!raw) return;
    try {
      const state = JSON.parse(raw) as { mode: OperationMode; hasPlan: boolean };
      this.userModes.set(userId, state.mode);
      // Note: approvedPlans are not persisted as full objects — they
      // must be regenerated. We only restore the mode flag.
    } catch {
      // ignore corrupted state
    }
  }

  // ============================================
  // Validation helpers
  // ============================================

  /** Throws if the user's current mode does not allow the given action */
  assertCan(userId: string, action: keyof ModeCapabilities): void {
    const caps = this.getCapabilities(userId);
    if (!caps[action]) {
      const mode = this.getMode(userId);
      throw new Error(
        `Action "${String(action)}" is not allowed in ${mode} mode. ` +
        `Switch to a mode that allows it (see /menu).`,
      );
    }
  }

  /** True if the user's current mode allows the given action */
  can(userId: string, action: keyof ModeCapabilities): boolean {
    return this.getCapabilities(userId)[action];
  }
}

// ============================================
// Factory
// ============================================

let _instance: ModeManager | null = null;

export function getModeManager(env: HadesBindings): ModeManager {
  if (!_instance) _instance = new ModeManager(env);
  return _instance;
}

// ============================================
// Mode switcher UI helper
// ============================================

export function renderModeSwitcher(currentMode: OperationMode): {
  text: string;
  replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
} {
  const text = [
    `🎛 *Operation Mode*`,
    ``,
    `Current: ${MODES[currentMode].emoji} *${MODES[currentMode].label}* — ${MODES[currentMode].tagline}`,
    ``,
    `Select a mode to switch:`,
  ].join("\n");

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = (Object.values(MODES) as ModeDescriptor[]).map((m) => {
    const isActive = m.mode === currentMode;
    return [{
      text: `${isActive ? "● " : "○ "}${m.emoji} ${m.label} — ${m.tagline}`,
      callback_data: `mode:switch:${m.mode}`,
    }];
  });

  keyboard.push([{ text: "🔙 Back", callback_data: "menu:main" }]);

  return { text, replyMarkup: { inline_keyboard: keyboard } };
}

export function renderModeDescription(mode: OperationMode): string {
  const m = MODES[mode];
  return [
    `${m.emoji} *${m.label} Mode*`,
    ``,
    `*Tagline:* ${m.tagline}`,
    ``,
    `*Description:*`,
    m.description,
    ``,
    `*Manager role:* ${m.managerRole}`,
    ``,
    `*Capabilities:*`,
    `- Code generation: ${m.capabilities.codeGeneration ? "✅" : "❌"}`,
    `- Branch creation: ${m.capabilities.branchCreation ? "✅" : "❌"}`,
    `- PR creation: ${m.capabilities.prCreation ? "✅" : "❌"}`,
    `- Repo modification: ${m.capabilities.repoModification ? "✅" : "❌"}`,
    `- Challenge user: ${m.capabilities.challengeUser ? "✅" : "❌"}`,
    `- Ask questions: ${m.capabilities.askQuestions ? "✅" : "❌"}`,
    `- Repo analysis: ${m.capabilities.repoAnalysis ? "✅" : "❌"}`,
    `- Roadmap generation: ${m.capabilities.roadmapGeneration ? "✅" : "❌"}`,
    `- Cost estimation: ${m.capabilities.costEstimation ? "✅" : "❌"}`,
  ].join("\n");
}
