/**
 * Integration Tests: Manager Personality - Cloudflare Workers Edition
 * Hades Army v0.9.0
 *
 * Section 10: Testing & Stability
 *
 * Tests the Manager's decision logic (Senior Technical Architect):
 *   - decidePatchFate() returns correct action based on confidence + review
 *   - Mode switching changes behavior
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ManagerPersonality } from "../../src/manager/personality";
import type { HadesBindings } from "../../src/types";

function makeMockEnv(): HadesBindings {
  return {
    HADES_DB: {} as any,
    HADES_KV: {} as any,
    AI: {} as any,
    GOOGLE_AI_API_KEY: "test",
    OPENROUTER_API_KEY: "test",
  } as HadesBindings;
}

describe("Manager Personality Integration", () => {
  let env: HadesBindings;
  let personality: ManagerPersonality;

  beforeEach(() => {
    env = makeMockEnv();
    personality = new ManagerPersonality(env);
  });

  describe("Mode management", () => {
    it("should default to plan mode", () => {
      expect(personality.getMode()).toBe("plan");
    });

    it("should switch modes", () => {
      personality.setMode("explore");
      expect(personality.getMode()).toBe("explore");
    });

    it("should expose mode config", () => {
      personality.setMode("plan");
      const config = personality.getConfig();
      expect(config.canExecute).toBe(false);
      expect(config.challengeAllowed).toBe(true);

      personality.setMode("build");
      const buildConfig = personality.getConfig();
      expect(buildConfig.canExecute).toBe(true);
      expect(buildConfig.challengeAllowed).toBe(false);
    });
  });

  describe("decidePatchFate — Senior Architect decision logic", () => {
    it("should ABORT when critical issues are detected", () => {
      const decision = personality.decidePatchFate(0.95, "approved", 1);
      expect(decision.action).toBe("abort");
      expect(decision.reason).toContain("critical");
    });

    it("should ABORT when reviewer rejected", () => {
      const decision = personality.decidePatchFate(0.95, "rejected", 0);
      expect(decision.action).toBe("abort");
      expect(decision.reason).toContain("rejected");
    });

    it("should REPLAN when reviewer requests changes", () => {
      const decision = personality.decidePatchFate(0.95, "changes_requested", 0);
      expect(decision.action).toBe("replan");
    });

    it("should REPLAN when builder confidence is too low (< 0.5)", () => {
      const decision = personality.decidePatchFate(0.3, "approved", 0);
      expect(decision.action).toBe("replan");
      expect(decision.reason).toContain("confidence");
    });

    it("should PROCEED when approved with high confidence", () => {
      const decision = personality.decidePatchFate(0.85, "approved", 0);
      expect(decision.action).toBe("proceed_to_pr");
    });

    it("should PROCEED at the boundary (confidence = 0.5)", () => {
      const decision = personality.decidePatchFate(0.5, "approved", 0);
      expect(decision.action).toBe("proceed_to_pr");
    });

    it("should prioritize critical issues over confidence", () => {
      // Even with high confidence, critical issue → abort
      const decision = personality.decidePatchFate(0.99, "approved", 5);
      expect(decision.action).toBe("abort");
    });
  });

  describe("Decision reasoning quality", () => {
    it("should always provide a non-empty reason", () => {
      const scenarios = [
        { conf: 0.9, status: "approved" as const, crit: 0 },
        { conf: 0.3, status: "approved" as const, crit: 0 },
        { conf: 0.9, status: "rejected" as const, crit: 0 },
        { conf: 0.9, status: "approved" as const, crit: 3 },
        { conf: 0.9, status: "changes_requested" as const, crit: 0 },
      ];
      for (const s of scenarios) {
        const decision = personality.decidePatchFate(s.conf, s.status, s.crit);
        expect(decision.reason.length).toBeGreaterThan(10);
      }
    });
  });
});
