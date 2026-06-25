/**
 * Integration Tests: Model Registry - Cloudflare Workers Edition
 * Hades Army v0.9.0
 *
 * Section 10: Testing & Stability
 *
 * Tests that the Model Registry correctly:
 *   - Resolves models for each agent role (no hardcoding)
 *   - Returns Gemini for Manager
 *   - Returns Qwen3-Coder for Builder
 *   - Returns DeepSeek for Reviewer
 *   - Lists providers (with availability flags)
 *   - Estimates cost correctly
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ModelRegistry, assertNoHardcodedModels } from "../../src/registry/model-registry";
import type { HadesBindings } from "../../src/types";

function makeMockEnv(overrides: Partial<HadesBindings> = {}): HadesBindings {
  return {
    HADES_DB: {} as any,
    HADES_KV: {} as any,
    AI: {} as any,
    GOOGLE_AI_API_KEY: "test-google-key",
    OPENROUTER_API_KEY: "test-openrouter-key",
    GITHUB_TOKEN: "test-github-token",
    ...overrides,
  } as HadesBindings;
}

describe("Model Registry Integration", () => {
  let env: HadesBindings;

  beforeEach(() => {
    env = makeMockEnv();
    ModelRegistry._resetForTests();
  });

  describe("Default model bindings", () => {
    it("should default Manager to Google Gemini 3 Flash", () => {
      const registry = ModelRegistry.getInstance(env);
      const model = registry.getModelForAgent("manager");
      expect(model.provider).toBe("google");
      expect(model.model).toBe("gemini-3-flash");
    });

    it("should default Builder to OpenRouter Qwen3 Coder", () => {
      const registry = ModelRegistry.getInstance(env);
      const model = registry.getModelForAgent("builder");
      expect(model.provider).toBe("openrouter");
      expect(model.model).toBe("qwen/qwen3-coder");
    });

    it("should default Reviewer to OpenRouter DeepSeek", () => {
      const registry = ModelRegistry.getInstance(env);
      const model = registry.getModelForAgent("reviewer");
      expect(model.provider).toBe("openrouter");
      expect(model.model).toBe("deepseek/deepseek-chat");
    });
  });

  describe("Provider availability", () => {
    it("should mark Google as available when API key is set", () => {
      const registry = ModelRegistry.getInstance(env);
      const providers = registry.listProviders();
      const google = providers.find((p) => p.name === "google");
      expect(google?.available).toBe(true);
    });

    it("should mark Google as unavailable when API key is missing", () => {
      const envNoGoogle = makeMockEnv({ GOOGLE_AI_API_KEY: undefined });
      const registry = ModelRegistry.getInstance(envNoGoogle);
      const providers = registry.listProviders();
      const google = providers.find((p) => p.name === "google");
      expect(google?.available).toBe(false);
    });

    it("should always include cloudflare, anthropic, openai, grok in the list (future-ready)", () => {
      const registry = ModelRegistry.getInstance(env);
      const names = registry.listProviders().map((p) => p.name);
      expect(names).toContain("cloudflare");
      expect(names).toContain("anthropic");
      expect(names).toContain("openai");
      expect(names).toContain("grok");
    });
  });

  describe("Runtime overrides", () => {
    it("should allow admin to override Manager model", () => {
      const registry = ModelRegistry.getInstance(env);
      registry.setOverride(
        "manager",
        { provider: "openrouter", model: "custom-model" },
        "admin-user",
      );
      const model = registry.getModelForAgent("manager");
      expect(model.provider).toBe("openrouter");
      expect(model.model).toBe("custom-model");
    });

    it("should clear overrides", () => {
      const registry = ModelRegistry.getInstance(env);
      registry.setOverride("manager", { provider: "openrouter", model: "x" }, "admin");
      registry.clearOverride("manager");
      const model = registry.getModelForAgent("manager");
      expect(model.provider).toBe("google");
      expect(model.model).toBe("gemini-3-flash");
    });
  });

  describe("Cost estimation", () => {
    it("should estimate $0 for Gemini (free tier)", () => {
      const registry = ModelRegistry.getInstance(env);
      const cost = registry.estimateCostUsd("manager", 1_000_000, 500_000);
      expect(cost).toBe(0);
    });

    it("should estimate non-zero cost for Qwen3-Coder", () => {
      const registry = ModelRegistry.getInstance(env);
      const cost = registry.estimateCostUsd("builder", 1_000_000, 500_000);
      // input: 1M * $0.18 = $0.18 ; output: 500K * $0.18 = $0.09 ; total = $0.27
      expect(cost).toBeCloseTo(0.27, 2);
    });

    it("should estimate non-zero cost for DeepSeek", () => {
      const registry = ModelRegistry.getInstance(env);
      const cost = registry.estimateCostUsd("reviewer", 1_000_000, 500_000);
      // input: 1M * $0.14 = $0.14 ; output: 500K * $0.28 = $0.14 ; total = $0.28
      expect(cost).toBeCloseTo(0.28, 2);
    });
  });

  describe("Hardcoded model detection (CI helper)", () => {
    it("should flag direct model string literals", () => {
      const badSource = `const model = "gpt-4o";`;
      const violations = assertNoHardcodedModels(badSource, "test-agent");
      expect(violations.length).toBeGreaterThan(0);
    });

    it("should not flag registry lookups", () => {
      const goodSource = `const model = registry.getModelForAgent("manager");`;
      const violations = assertNoHardcodedModels(goodSource, "test-agent");
      expect(violations).toEqual([]);
    });
  });
});
