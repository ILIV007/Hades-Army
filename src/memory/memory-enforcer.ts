/**
 * Memory Enforcer - Cloudflare Workers Edition
 * Hades Army v0.9.0 — Architecture Completion & Production Readiness
 *
 * Section 4: Repository Memory System
 *
 * Enforces that EVERY workflow reads and writes .hades/ before and
 * after execution. Repository Memory is the HIGHEST authority in
 * the memory hierarchy:
 *
 *   Repository Memory (.hades/)   ← source of truth
 *        ↓ (falls back to)
 *   D1 (project database)
 *        ↓ (falls back to)
 *   KV (ephemeral cache)
 *
 * This module is a GUARD around workflow execution — the
 * ManagerController MUST call:
 *   1. enforceBeforeWorkflow() — fails the workflow if .hades/ is missing
 *   2. enforceAfterWorkflow()  — records the workflow outcome in .hades/
 *
 * Failure to consult .hades/ before planning is a CRITICAL violation.
 */

import { logger } from "../utils/logger";
import { RepositoryMemory, HADES_PATHS } from "./repository-memory";
import type { HadesBindings } from "../types";
import type { RepositoryScanResult } from "./repository-scanner";

// ============================================
// Types
// ============================================

export interface MemoryEnforcementResult {
  ok: boolean;
  reason?: string;
  /** was .hades/ present before the workflow? */
  hadMemory: boolean;
  /** was .hades/ updated after the workflow? */
  updated: boolean;
  /** past failures loaded from .hades/failures/ */
  pastFailures: Array<{ id: string; summary: string; lesson: string }>;
  /** knowledge notes loaded from .hades/knowledge/ */
  knowledgeNotes: string[];
}

export interface WorkflowOutcome {
  workflowId: string;
  taskId: string;
  status: "completed" | "aborted";
  stage: string;
  prUrl?: string;
  mergeSha?: string;
  abortReason?: string;
  builderConfidence?: number;
  reviewScore?: number;
  costUsd?: number;
  elapsedMs?: number;
}

// ============================================
// Memory Enforcer
// ============================================

export class MemoryEnforcer {
  private env: HadesBindings;
  private memory: RepositoryMemory;

  constructor(env: HadesBindings) {
    this.env = env;
    this.memory = new RepositoryMemory(env);
  }

  // ============================================
  // Pre-workflow enforcement
  // ============================================

  /**
   * MUST be called at the START of every workflow.
   *
   * Verifies that .hades/ exists for the project. If it doesn't,
   * the workflow is BLOCKED — onboarding must complete first.
   *
   * Returns the loaded memory context (failures + knowledge) so the
   * Manager can consult it during planning.
   */
  async enforceBeforeWorkflow(
    projectId: string,
    scan: RepositoryScanResult,
  ): Promise<MemoryEnforcementResult> {
    this.memory.setProjectContext(projectId);

    const isInitialized = await this.memory.isInitialized(projectId);
    if (!isInitialized) {
      logger.error(`MemoryEnforcer: BLOCKED — .hades/ not initialized for project ${projectId}`, { projectId });
      return {
        ok: false,
        reason: `Repository memory (.hades/) is not initialized. Complete onboarding first.`,
        hadMemory: false,
        updated: false,
        pastFailures: [],
        knowledgeNotes: [],
      };
    }

    // Load memory context (past failures + knowledge notes) so the
    // Manager can consult them during planning.
    const memoryContext = await this.memory.buildMemoryContext(projectId, scan);

    logger.info(`MemoryEnforcer: pre-workflow ok for ${projectId}`, {
      pastFailures: memoryContext.pastFailures.length,
      knowledgeNotes: memoryContext.knowledgeNotes.length,
    });

    return {
      ok: true,
      hadMemory: true,
      updated: false,
      pastFailures: memoryContext.pastFailures,
      knowledgeNotes: memoryContext.knowledgeNotes,
    };
  }

  // ============================================
  // Post-workflow enforcement
  // ============================================

  /**
   * MUST be called at the END of every workflow — whether it
   * completed successfully, was aborted, or failed.
   *
   * Records the outcome in .hades/:
   *   - On success: moves task from open to closed, updates metrics
   *   - On failure: records a failure entry with root cause + lesson
   *   - Always: bumps task/review counters
   */
  async enforceAfterWorkflow(
    projectId: string,
    outcome: WorkflowOutcome,
  ): Promise<MemoryEnforcementResult> {
    this.memory.setProjectContext(projectId);

    let updated = false;

    if (outcome.status === "completed") {
      // Record task completion
      await this.memory.recordTaskCompletion(projectId, {
        workflowId: outcome.workflowId,
        mergedSha: outcome.mergeSha ?? "",
        completedAt: new Date().toISOString(),
      });

      // Record review (if a score is present)
      if (outcome.reviewScore !== undefined) {
        await this.memory.recordReview(projectId, {
          taskId: outcome.taskId,
          score: outcome.reviewScore,
          status: "approved",
          findings: [],
          summary: `Auto-recorded after merge. Builder confidence: ${outcome.builderConfidence ?? "n/a"}`,
        });
      }

      updated = true;
      logger.info(`MemoryEnforcer: post-workflow ok (completed) for ${projectId}`, {
        workflowId: outcome.workflowId,
      });
    } else {
      // Aborted — record a failure so future planning can learn
      const stage = outcome.stage || "unknown";
      const rootCause = outcome.abortReason ?? "Workflow aborted without reason";
      const lesson = this.deriveLesson(stage, rootCause);

      await this.memory.recordTaskFailure(projectId, {
        taskId: outcome.taskId,
        stage,
        summary: `Workflow ${outcome.workflowId} aborted at ${stage}`,
        rootCause,
        lesson,
        preventionRule: this.derivePreventionRule(stage),
      });

      updated = true;
      logger.warn(`MemoryEnforcer: post-workflow ok (failed) for ${projectId}`, {
        workflowId: outcome.workflowId,
        stage,
        rootCause,
      });
    }

    return {
      ok: true,
      hadMemory: true,
      updated,
      pastFailures: [],
      knowledgeNotes: [],
    };
  }

  // ============================================
  // Helpers: derive lessons from failures
  // ============================================

  private deriveLesson(stage: string, rootCause: string): string {
    const templates: Record<string, string> = {
      PATCH_GENERATION: `Builder failed to produce a valid patch. Lesson: ${rootCause}. Improve context provided to Builder.`,
      REVIEWER_VALIDATION: `Reviewer rejected the patch. Lesson: ${rootCause}. Pre-validate patches against constraints before submission.`,
      MANAGER_DECISION: `Manager could not decide. Lesson: ${rootCause}. Improve review output structure.`,
      GITHUB_PR: `GitHub PR creation failed. Lesson: ${rootCause}. Validate permissions and branch state before PR.`,
      MERGE: `Merge failed. Lesson: ${rootCause}. Check for merge conflicts before approval.`,
    };
    return templates[stage] ?? `Failure at ${stage}. Lesson: ${rootCause}.`;
  }

  private derivePreventionRule(stage: string): string {
    const rules: Record<string, string> = {
      PATCH_GENERATION: "Require Builder to output structured JSON with confidence > 0.5",
      REVIEWER_VALIDATION: "Require Reviewer to score > 60 before Manager can proceed",
      MANAGER_DECISION: "Require Reviewer verdict before Manager decision",
      GITHUB_PR: "Pre-scan patch for secrets and forbidden paths before PR creation",
      MERGE: "Check PR mergeable state before requesting user approval",
    };
    return rules[stage] ?? `Add validation gate before ${stage}`;
  }

  // ============================================
  // Public: assert memory hierarchy integrity
  // ============================================

  /**
   * Verifies the memory hierarchy is intact. Returns warnings if any
   * layer is unavailable (does not throw — degraded mode is allowed).
   */
  async checkHierarchy(projectId: string): Promise<{
    repoMemory: boolean;
    d1: boolean;
    kv: boolean;
    warnings: string[];
  }> {
    const warnings: string[] = [];

    // Repository memory
    const project = await this.memory.getProject(projectId);
    const repoMemory = !!project;
    if (!repoMemory) warnings.push(".hades/project.json missing — onboarding incomplete");

    // D1
    let d1 = true;
    try {
      await this.env.HADES_DB.prepare("SELECT 1").run();
    } catch {
      d1 = false;
      warnings.push("D1 unavailable — structured audit tables will not persist");
    }

    // KV
    let kv = true;
    try {
      if (this.env.HADES_KV) {
        await this.env.HADES_KV.get("__hades_health_check__");
      } else {
        kv = false;
        warnings.push("KV binding missing — cost tracker and agent metrics will not persist");
      }
    } catch {
      kv = false;
      warnings.push("KV access failed");
    }

    return { repoMemory, d1, kv, warnings };
  }

  // ============================================
  // Public: get a snapshot of all .hades/ paths
  // ============================================

  getRequiredPaths(): string[] {
    return Object.values(HADES_PATHS);
  }
}

// ============================================
// Factory
// ============================================

export function getMemoryEnforcer(env: HadesBindings): MemoryEnforcer {
  return new MemoryEnforcer(env);
}
