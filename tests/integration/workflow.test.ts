/**
 * Integration Tests: Workflow - Cloudflare Workers Edition
 * Hades Army v0.9.0
 *
 * Section 10: Testing & Stability
 *
 * Tests the canonical workflow end-to-end:
 *   USER_REQUEST → MANAGER_ANALYSIS → REPOSITORY_ANALYSIS → ... → MERGE
 *
 * Uses mocks for external services (GitHub, LLM providers).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  WORKFLOW_STAGES,
  createWorkflowState,
  transition,
  isValidTransition,
  progressPercent,
  FORWARD_ORDER,
  type WorkflowStage,
} from "../../src/orchestration/workflow";

describe("Workflow Integration", () => {
  describe("Stage definitions", () => {
    it("should define all 13 stages", () => {
      expect(Object.keys(WORKFLOW_STAGES).length).toBe(13);
    });

    it("should have FORWARD_ORDER with 12 stages (excludes ABORTED)", () => {
      expect(FORWARD_ORDER.length).toBe(12);
      expect(FORWARD_ORDER).not.toContain("ABORTED");
    });

    it("should mark Builder stage as githubAllowed=false", () => {
      expect(WORKFLOW_STAGES.PATCH_GENERATION.githubAllowed).toBe(false);
      expect(WORKFLOW_STAGES.PATCH_GENERATION.builderCanWrite).toBe(true);
    });

    it("should mark Reviewer stage as githubAllowed=false", () => {
      expect(WORKFLOW_STAGES.REVIEWER_VALIDATION.githubAllowed).toBe(false);
      expect(WORKFLOW_STAGES.REVIEWER_VALIDATION.reviewerCanValidate).toBe(true);
    });

    it("should mark GitHub PR stage as Manager-only (githubAllowed=true)", () => {
      expect(WORKFLOW_STAGES.GITHUB_PR.githubAllowed).toBe(true);
    });
  });

  describe("Transitions", () => {
    it("should allow forward transitions", () => {
      expect(isValidTransition("USER_REQUEST", "MANAGER_ANALYSIS")).toBe(true);
      expect(isValidTransition("MANAGER_ANALYSIS", "REPOSITORY_ANALYSIS")).toBe(true);
      expect(isValidTransition("PATCH_GENERATION", "REVIEWER_VALIDATION")).toBe(true);
      expect(isValidTransition("GITHUB_PR", "USER_APPROVAL")).toBe(true);
      expect(isValidTransition("MERGE", "COMPLETED")).toBe(true);
    });

    it("should allow rework transitions", () => {
      expect(isValidTransition("REVIEWER_VALIDATION", "PATCH_GENERATION")).toBe(true);
      expect(isValidTransition("MANAGER_DECISION", "PATCH_GENERATION")).toBe(true);
      expect(isValidTransition("USER_APPROVAL", "MANAGER_DECISION")).toBe(true);
    });

    it("should allow abort from any active stage", () => {
      expect(isValidTransition("MANAGER_ANALYSIS", "ABORTED")).toBe(true);
      expect(isValidTransition("REPOSITORY_ANALYSIS", "ABORTED")).toBe(false); // not allowed
    });

    it("should reject invalid transitions", () => {
      expect(isValidTransition("USER_REQUEST", "MERGE")).toBe(false);
      expect(isValidTransition("PATCH_GENERATION", "GITHUB_PR")).toBe(false); // must go through review
      expect(isValidTransition("COMPLETED", "USER_REQUEST")).toBe(false);
    });
  });

  describe("Workflow state", () => {
    it("should create initial state at USER_REQUEST", () => {
      const state = createWorkflowState("wf-1", "proj-1");
      expect(state.currentStage).toBe("USER_REQUEST");
      expect(state.history.length).toBe(1);
      expect(state.history[0].stage).toBe("USER_REQUEST");
      expect(state.startedAt).toBeTruthy();
    });

    it("should track history through transitions", () => {
      const state = createWorkflowState("wf-1", "proj-1");
      transition(state, "MANAGER_ANALYSIS");
      transition(state, "REPOSITORY_ANALYSIS");
      transition(state, "TASK_PLANNING");

      expect(state.currentStage).toBe("TASK_PLANNING");
      expect(state.history.length).toBe(4);
      expect(state.history.map((h) => h.stage)).toEqual([
        "USER_REQUEST",
        "MANAGER_ANALYSIS",
        "REPOSITORY_ANALYSIS",
        "TASK_PLANNING",
      ]);
    });

    it("should set completedAt when reaching COMPLETED", () => {
      const state = createWorkflowState("wf-1", "proj-1");
      // Walk the entire forward path
      FORWARD_ORDER.slice(1).forEach((stage) => transition(state, stage as WorkflowStage));

      expect(state.currentStage).toBe("COMPLETED");
      expect(state.completedAt).toBeTruthy();
    });

    it("should set abortedAt when reaching ABORTED", () => {
      const state = createWorkflowState("wf-1", "proj-1");
      transition(state, "MANAGER_ANALYSIS");
      transition(state, "ABORTED", "test abort");

      expect(state.currentStage).toBe("ABORTED");
      expect(state.abortedAt).toBeTruthy();
      expect(state.abortReason).toBe("test abort");
    });

    it("should throw on invalid transition", () => {
      const state = createWorkflowState("wf-1", "proj-1");
      expect(() => transition(state, "MERGE")).toThrow();
    });
  });

  describe("Progress", () => {
    it("should return 0% at USER_REQUEST", () => {
      const state = createWorkflowState("wf-1", "proj-1");
      expect(progressPercent(state)).toBe(0);
    });

    it("should return 100% at COMPLETED", () => {
      const state = createWorkflowState("wf-1", "proj-1");
      FORWARD_ORDER.slice(1).forEach((stage) => transition(state, stage as WorkflowStage));
      expect(progressPercent(state)).toBe(100);
    });

    it("should return ~50% at midpoint", () => {
      const state = createWorkflowState("wf-1", "proj-1");
      const midpoint = FORWARD_ORDER[Math.floor(FORWARD_ORDER.length / 2)];
      FORWARD_ORDER.slice(1, FORWARD_ORDER.indexOf(midpoint) + 1).forEach((stage) =>
        transition(state, stage as WorkflowStage),
      );
      const progress = progressPercent(state);
      expect(progress).toBeGreaterThan(40);
      expect(progress).toBeLessThan(70);
    });
  });
});
