/**
 * Hades Army Workflow Definition - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Priority 1: Real Agent Orchestration
 *
 * Canonical Hades Army workflow:
 *
 *   User Request
 *     ↓
 *   Manager Analysis
 *     ↓
 *   Repository Analysis
 *     ↓
 *   Task Planning
 *     ↓
 *   Builder Assignment
 *     ↓
 *   Patch Generation
 *     ↓
 *   Reviewer Validation
 *     ↓
 *   Manager Decision
 *     ↓
 *   GitHub PR
 *     ↓
 *   User Approval
 *     ↓
 *   Merge
 *
 * This file declares the workflow as DATA (stages + transitions),
 * so the Manager controller can drive it generically. No stage
 * may be skipped. The only allowed backward transitions are:
 *   - REVIEWER → BUILDER (changes_requested)
 *   - MANAGER_DECISION → BUILDER (replan)
 *   - USER_APPROVAL → MANAGER_DECISION (user rejects, manager replans)
 */

import { logger } from "../utils/logger";

// ============================================
// Stage enum
// ============================================

export type WorkflowStage =
  | "USER_REQUEST"
  | "MANAGER_ANALYSIS"
  | "REPOSITORY_ANALYSIS"
  | "TASK_PLANNING"
  | "BUILDER_ASSIGNMENT"
  | "PATCH_GENERATION"
  | "REVIEWER_VALIDATION"
  | "MANAGER_DECISION"
  | "GITHUB_PR"
  | "USER_APPROVAL"
  | "MERGE"
  | "COMPLETED"
  | "ABORTED";

export interface StageDefinition {
  stage: WorkflowStage;
  owner: "manager" | "builder" | "reviewer" | "user" | "system";
  description: string;
  /** stages this stage may transition FORWARD to */
  next: WorkflowStage[];
  /** stages this stage may transition BACKWARD to (rework) */
  reworkTo: WorkflowStage[];
  /** whether GitHub operations are allowed at this stage (Manager only) */
  githubAllowed: boolean;
  /** whether Builder is allowed to write files */
  builderCanWrite: boolean;
  /** whether Reviewer is allowed to validate */
  reviewerCanValidate: boolean;
}

// ============================================
// Stage table
// ============================================

export const WORKFLOW_STAGES: Record<WorkflowStage, StageDefinition> = {
  USER_REQUEST: {
    stage: "USER_REQUEST",
    owner: "user",
    description: "User submits a request through Telegram or API",
    next: ["MANAGER_ANALYSIS", "ABORTED"],
    reworkTo: [],
    githubAllowed: false,
    builderCanWrite: false,
    reviewerCanValidate: false,
  },
  MANAGER_ANALYSIS: {
    stage: "MANAGER_ANALYSIS",
    owner: "manager",
    description: "Manager parses intent, classifies request, estimates scope",
    next: ["REPOSITORY_ANALYSIS", "ABORTED"],
    reworkTo: [],
    githubAllowed: false,
    builderCanWrite: false,
    reviewerCanValidate: false,
  },
  REPOSITORY_ANALYSIS: {
    stage: "REPOSITORY_ANALYSIS",
    owner: "manager",
    description: "Manager scans repo, loads .hades/ memory, builds context",
    next: ["TASK_PLANNING"],
    reworkTo: ["MANAGER_ANALYSIS"],
    githubAllowed: true, // read-only scanning
    builderCanWrite: false,
    reviewerCanValidate: false,
  },
  TASK_PLANNING: {
    stage: "TASK_PLANNING",
    owner: "manager",
    description: "Manager decomposes work into atomic builder tasks",
    next: ["BUILDER_ASSIGNMENT"],
    reworkTo: ["REPOSITORY_ANALYSIS"],
    githubAllowed: false,
    builderCanWrite: false,
    reviewerCanValidate: false,
  },
  BUILDER_ASSIGNMENT: {
    stage: "BUILDER_ASSIGNMENT",
    owner: "manager",
    description: "Manager sends ManagerToBuilder message with context",
    next: ["PATCH_GENERATION"],
    reworkTo: ["TASK_PLANNING"],
    githubAllowed: false,
    builderCanWrite: false,
    reviewerCanValidate: false,
  },
  PATCH_GENERATION: {
    stage: "PATCH_GENERATION",
    owner: "builder",
    description: "Builder produces patch using ONLY provided context",
    next: ["REVIEWER_VALIDATION"],
    reworkTo: [],
    githubAllowed: false, // Builder NEVER touches GitHub
    builderCanWrite: true,
    reviewerCanValidate: false,
  },
  REVIEWER_VALIDATION: {
    stage: "REVIEWER_VALIDATION",
    owner: "reviewer",
    description: "Reviewer validates patch against criteria",
    next: ["MANAGER_DECISION"],
    reworkTo: ["PATCH_GENERATION"], // changes_requested
    githubAllowed: false, // Reviewer NEVER touches GitHub
    builderCanWrite: false,
    reviewerCanValidate: true,
  },
  MANAGER_DECISION: {
    stage: "MANAGER_DECISION",
    owner: "manager",
    description: "Manager decides: proceed to PR, replan, or abort",
    next: ["GITHUB_PR", "PATCH_GENERATION", "ABORTED"],
    reworkTo: ["PATCH_GENERATION"],
    githubAllowed: false,
    builderCanWrite: false,
    reviewerCanValidate: false,
  },
  GITHUB_PR: {
    stage: "GITHUB_PR",
    owner: "manager",
    description: "Manager creates branch, commits patch, opens PR",
    next: ["USER_APPROVAL", "ABORTED"],
    reworkTo: ["MANAGER_DECISION"],
    githubAllowed: true, // Manager-only GitHub writes
    builderCanWrite: false,
    reviewerCanValidate: false,
  },
  USER_APPROVAL: {
    stage: "USER_APPROVAL",
    owner: "user",
    description: "User approves or rejects the PR via Telegram",
    next: ["MERGE", "MANAGER_DECISION"],
    reworkTo: ["MANAGER_DECISION"],
    githubAllowed: false,
    builderCanWrite: false,
    reviewerCanValidate: false,
  },
  MERGE: {
    stage: "MERGE",
    owner: "manager",
    description: "Manager merges PR and updates .hades/ memory",
    next: ["COMPLETED"],
    reworkTo: [],
    githubAllowed: true,
    builderCanWrite: false,
    reviewerCanValidate: false,
  },
  COMPLETED: {
    stage: "COMPLETED",
    owner: "system",
    description: "Workflow finished successfully",
    next: [],
    reworkTo: [],
    githubAllowed: false,
    builderCanWrite: false,
    reviewerCanValidate: false,
  },
  ABORTED: {
    stage: "ABORTED",
    owner: "system",
    description: "Workflow aborted (manager decision, user cancel, or system)",
    next: [],
    reworkTo: [],
    githubAllowed: false,
    builderCanWrite: false,
    reviewerCanValidate: false,
  },
};

// ============================================
// Ordered stage list (forward path)
// ============================================

export const FORWARD_ORDER: WorkflowStage[] = [
  "USER_REQUEST",
  "MANAGER_ANALYSIS",
  "REPOSITORY_ANALYSIS",
  "TASK_PLANNING",
  "BUILDER_ASSIGNMENT",
  "PATCH_GENERATION",
  "REVIEWER_VALIDATION",
  "MANAGER_DECISION",
  "GITHUB_PR",
  "USER_APPROVAL",
  "MERGE",
  "COMPLETED",
];

// ============================================
// Validation
// ============================================

export function isValidTransition(from: WorkflowStage, to: WorkflowStage): boolean {
  if (from === to) return false;
  const stage = WORKFLOW_STAGES[from];
  return stage.next.includes(to) || stage.reworkTo.includes(to);
}

export function assertTransition(from: WorkflowStage, to: WorkflowStage): void {
  if (!isValidTransition(from, to)) {
    throw new Error(`Invalid workflow transition: ${from} -> ${to}`);
  }
}

// ============================================
// Workflow instance state
// ============================================

export interface WorkflowState {
  workflowId: string;
  projectId: string;
  currentStage: WorkflowStage;
  history: Array<{
    stage: WorkflowStage;
    enteredAt: string;
    exitedAt?: string;
    note?: string;
  }>;
  startedAt: string;
  completedAt?: string;
  abortedAt?: string;
  abortReason?: string;
}

export function createWorkflowState(workflowId: string, projectId: string): WorkflowState {
  const now = new Date().toISOString();
  return {
    workflowId,
    projectId,
    currentStage: "USER_REQUEST",
    history: [{ stage: "USER_REQUEST", enteredAt: now }],
    startedAt: now,
  };
}

export function transition(state: WorkflowState, to: WorkflowStage, note?: string): WorkflowState {
  const from = state.currentStage;
  assertTransition(from, to);

  const now = new Date().toISOString();

  // close out current history entry
  const last = state.history[state.history.length - 1];
  if (last && !last.exitedAt) last.exitedAt = now;

  state.history.push({ stage: to, enteredAt: now, note });
  state.currentStage = to;

  if (to === "COMPLETED") state.completedAt = now;
  if (to === "ABORTED") {
    state.abortedAt = now;
    state.abortReason = note;
  }

  logger.info(`Workflow ${state.workflowId} transition: ${from} -> ${to}`, { note });
  return state;
}

// ============================================
// Convenience: progress percentage
// ============================================

export function progressPercent(state: WorkflowState): number {
  const idx = FORWARD_ORDER.indexOf(state.currentStage);
  if (idx < 0) return 0;
  return Math.round((idx / (FORWARD_ORDER.length - 1)) * 100);
}
