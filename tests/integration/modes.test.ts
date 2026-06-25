/**
 * Integration Tests: Operation Modes - Cloudflare Workers Edition
 * Hades Army v0.9.0
 *
 * Section 10: Testing & Stability
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ModeManager, MODES, type OperationMode } from "../../src/modes/operation-modes";
import type { HadesBindings } from "../../src/types";

function makeMockEnv(): HadesBindings {
  return {
    HADES_DB: {} as any,
    HADES_KV: {} as any,
    AI: {} as any,
  } as HadesBindings;
}

describe("Operation Modes Integration", () => {
  let env: HadesBindings;
  let manager: ModeManager;

  beforeEach(() => {
    env = makeMockEnv();
    manager = new ModeManager(env);
  });

  describe("Default mode", () => {
    it("should default to plan mode", () => {
      expect(manager.getMode("user-1")).toBe("plan");
    });
  });

  describe("Mode switching", () => {
    it("should allow switching to explore mode", () => {
      const result = manager.setMode("user-1", "explore");
      expect(result.ok).toBe(true);
      expect(manager.getMode("user-1")).toBe("explore");
    });

    it("should block switching to build mode without an approved plan", () => {
      const result = manager.setMode("user-1", "build");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("approved plan");
    });

    it("should allow switching to build mode with an approved plan", () => {
      manager.recordApprovedPlan("user-1", { summary: "test plan" });
      const result = manager.setMode("user-1", "build");
      expect(result.ok).toBe(true);
      expect(manager.getMode("user-1")).toBe("build");
    });
  });

  describe("Capabilities per mode", () => {
    it("PLAN mode: should forbid code generation, branches, PRs", () => {
      const caps = manager.getCapabilities("user-1"); // plan mode
      expect(caps.codeGeneration).toBe(false);
      expect(caps.branchCreation).toBe(false);
      expect(caps.prCreation).toBe(false);
      expect(caps.repoModification).toBe(false);
    });

    it("PLAN mode: should allow challenge, questions, analysis, roadmap, cost", () => {
      const caps = manager.getCapabilities("user-1"); // plan mode
      expect(caps.challengeUser).toBe(true);
      expect(caps.askQuestions).toBe(true);
      expect(caps.repoAnalysis).toBe(true);
      expect(caps.roadmapGeneration).toBe(true);
      expect(caps.costEstimation).toBe(true);
    });

    it("BUILD mode: should allow code generation, branches, PRs", () => {
      manager.recordApprovedPlan("user-1", {});
      manager.setMode("user-1", "build");
      const caps = manager.getCapabilities("user-1");
      expect(caps.codeGeneration).toBe(true);
      expect(caps.branchCreation).toBe(true);
      expect(caps.prCreation).toBe(true);
      expect(caps.repoModification).toBe(true);
    });

    it("BUILD mode: should forbid challenge and questions", () => {
      manager.recordApprovedPlan("user-1", {});
      manager.setMode("user-1", "build");
      const caps = manager.getCapabilities("user-1");
      expect(caps.challengeUser).toBe(false);
      expect(caps.askQuestions).toBe(false);
    });

    it("EXPLORE mode: should allow analysis but forbid code generation", () => {
      manager.setMode("user-1", "explore");
      const caps = manager.getCapabilities("user-1");
      expect(caps.repoAnalysis).toBe(true);
      expect(caps.codeGeneration).toBe(false);
    });
  });

  describe("assertCan enforcement", () => {
    it("should throw when action is not allowed in current mode", () => {
      // plan mode — code generation forbidden
      expect(() => manager.assertCan("user-1", "codeGeneration")).toThrow();
    });

    it("should not throw when action is allowed", () => {
      // plan mode — challenge allowed
      expect(() => manager.assertCan("user-1", "challengeUser")).not.toThrow();
    });
  });

  describe("Approved plan consumption", () => {
    it("should consume the plan when switching to build mode", () => {
      const plan = { summary: "my plan" };
      manager.recordApprovedPlan("user-1", plan);
      expect(manager.hasApprovedPlan("user-1")).toBe(true);

      manager.setMode("user-1", "build");
      const consumed = manager.consumeApprovedPlan("user-1");
      expect(consumed).toEqual(plan);
      expect(manager.hasApprovedPlan("user-1")).toBe(false);
    });
  });

  describe("Mode definitions", () => {
    it("should define 3 modes", () => {
      expect(Object.keys(MODES).length).toBe(3);
    });

    it("each mode should have correct manager role", () => {
      expect(MODES.plan.managerRole).toBe("architect");
      expect(MODES.build.managerRole).toBe("executor");
      expect(MODES.explore.managerRole).toBe("analyst");
    });
  });
});
