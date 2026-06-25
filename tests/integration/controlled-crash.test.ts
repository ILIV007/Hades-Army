/**
 * Integration Tests: Controlled Crash Validator - Cloudflare Workers Edition
 * Hades Army v0.9.2
 *
 * Priority 10: Testing — Startup Validation Tests
 *
 * Tests that the Worker boots in controlled mode when critical
 * secrets are missing, instead of crashing with a runtime error.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ControlledCrashValidator } from "../../src/security/controlled-crash-validator";
import type { HadesBindings } from "../../src/types";

function makeMockEnv(overrides: Partial<HadesBindings> = {}): HadesBindings {
  return {
    HADES_DB: {} as unknown as D1Database,
    HADES_KV: {} as unknown as KVNamespace,
    AI: {} as unknown as Ai,
    TELEGRAM_BOT_TOKEN: "test-tg-token-1234567890",
    GITHUB_TOKEN: "ghp_test_token_1234567890abcdef",
    GOOGLE_AI_API_KEY: "AIzaTest1234567890abcdefghijklmnopqrstuv",
    OPENROUTER_API_KEY: "sk-or-test-1234567890abcdef",
    ADMIN_API_TOKEN: "test-admin-token-1234",
    JWT_SECRET: "test-jwt-secret-with-32-characters-min",
    ENCRYPTION_KEY: "test-encryption-key-with-32-characters",
    ...overrides,
  } as HadesBindings;
}

describe("Controlled Crash Validator Integration", () => {
  let validator: ControlledCrashValidator;

  beforeEach(() => {
    validator = new ControlledCrashValidator();
  });

  describe("When all critical secrets are present", () => {
    it("should return ok=true", () => {
      const result = validator.check(makeMockEnv());
      expect(result.ok).toBe(true);
    });

    it("should not block any routes", () => {
      const result = validator.check(makeMockEnv());
      expect(result.blockingWorkflow).toBe(false);
      expect(result.blockedRoutes).toHaveLength(0);
    });
  });

  describe("When TELEGRAM_BOT_TOKEN is missing", () => {
    it("should return blockingWorkflow=true", () => {
      const result = validator.check(makeMockEnv({ TELEGRAM_BOT_TOKEN: undefined }));
      expect(result.blockingWorkflow).toBe(true);
    });

    it("should list telegram webhook in blocked routes", () => {
      const result = validator.check(makeMockEnv({ TELEGRAM_BOT_TOKEN: undefined }));
      expect(result.blockedRoutes).toContain("/webhook/telegram");
    });

    it("should list the missing secret in result.missing", () => {
      const result = validator.check(makeMockEnv({ TELEGRAM_BOT_TOKEN: undefined }));
      expect(result.result.missing).toContain("TELEGRAM_BOT_TOKEN");
    });
  });

  describe("When GITHUB_TOKEN is missing", () => {
    it("should return blockingWorkflow=true", () => {
      const result = validator.check(makeMockEnv({ GITHUB_TOKEN: undefined }));
      expect(result.blockingWorkflow).toBe(true);
    });
  });

  describe("When GOOGLE_AI_API_KEY is missing", () => {
    it("should return blockingWorkflow=true", () => {
      const result = validator.check(makeMockEnv({ GOOGLE_AI_API_KEY: undefined }));
      expect(result.blockingWorkflow).toBe(true);
    });
  });

  describe("When ENCRYPTION_KEY is missing", () => {
    it("should return blockingWorkflow=true", () => {
      const result = validator.check(makeMockEnv({ ENCRYPTION_KEY: undefined }));
      expect(result.blockingWorkflow).toBe(true);
    });
  });

  describe("Blocked response rendering", () => {
    it("should render a 503 response with clear error message", () => {
      const errBody = validator.renderBlockedResponse(["TELEGRAM_BOT_TOKEN", "ENCRYPTION_KEY"]);
      expect(errBody.status).toBe(503);
      expect(errBody.body.error).toContain("missing critical secrets");
      expect(errBody.body.missing).toEqual(["TELEGRAM_BOT_TOKEN", "ENCRYPTION_KEY"]);
      expect(errBody.body.fix).toContain("wrangler secret put");
    });

    it("should never include secret values in the error body", () => {
      const errBody = validator.renderBlockedResponse(["GITHUB_TOKEN"]);
      const serialized = JSON.stringify(errBody.body);
      // The body should not contain any actual secret-like strings
      expect(serialized).not.toMatch(/gh[pousr]_[A-Za-z0-9_]{36,}/);
      expect(serialized).not.toMatch(/AIza[0-9A-Za-z_-]{35}/);
    });
  });

  describe("Telegram rendering", () => {
    it("should show success message when all secrets present", () => {
      const check = validator.check(makeMockEnv());
      const text = validator.renderForTelegram(check);
      expect(text).toContain("Startup OK");
    });

    it("should list missing secrets when blocking", () => {
      const check = validator.check(makeMockEnv({ TELEGRAM_BOT_TOKEN: undefined }));
      const text = validator.renderForTelegram(check);
      expect(text).toContain("Startup Blocked");
      expect(text).toContain("TELEGRAM_BOT_TOKEN");
      expect(text).toContain("wrangler secret put");
    });
  });
});
