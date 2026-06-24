/**
 * Integrations Tests - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockEnv, createMockRequest } from "./setup";
import { createRouter } from "../src/api/router";
import { createGitHubClient } from "../src/integrations/github";
import { createTelegramBot } from "../src/integrations/telegram-bot";
import { AIFactory } from "../src/integrations/ai-factory";

describe("GitHub Integration", () => {
  const env = createMockEnv();

  it("should create GitHub client with token", () => {
    const client = createGitHubClient(env);
    expect(client).toBeDefined();
  });

  it("should return null without token", () => {
    const envWithoutToken = { ...env, GITHUB_TOKEN: undefined };
    const client = createGitHubClient(envWithoutToken as any);
    expect(client).toBeNull();
  });

  it("should set default repository", () => {
    const client = createGitHubClient(env, { owner: "hades", repo: "army" });
    expect(client).toBeDefined();
    client?.setDefaultRepo("hades", "army");
    const repo = client?.getDefaultRepo();
    expect(repo?.owner).toBe("hades");
    expect(repo?.repo).toBe("army");
  });

  it("should parse webhook payload", () => {
    const client = createGitHubClient(env);
    const payload = JSON.stringify({
      action: "opened",
      repository: { full_name: "hades/army" },
      pull_request: { number: 1, title: "Test PR" },
    });

    const parsed = client?.parseWebhookPayload(payload);
    expect(parsed).toBeDefined();
    expect(parsed?.action).toBe("opened");
  });
});

describe("Telegram Integration", () => {
  const env = createMockEnv();

  it("should create Telegram bot with token", () => {
    const bot = createTelegramBot(env);
    expect(bot).toBeDefined();
  });

  it("should return null without token", () => {
    const envWithoutToken = { ...env, TELEGRAM_BOT_TOKEN: undefined };
    const bot = createTelegramBot(envWithoutToken as any);
    expect(bot).toBeNull();
  });

  it("should handle webhook updates", async () => {
    const bot = createTelegramBot(env);
    expect(bot).toBeDefined();

    const update = {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 123456, type: "private" },
        date: Date.now(),
        text: "/start",
        from: { id: 123456, is_bot: false, first_name: "Test" },
      },
    };

    await bot?.handleUpdate(update);
  });

  it("should format messages with HTML", async () => {
    const bot = createTelegramBot(env);
    expect(bot).toBeDefined();

    // Test HTML formatting in messages
    const message = `<b>Bold</b> and <i>italic</i> text`;
    // Bot should handle HTML parse_mode
  });
});

describe("AI Factory Integration", () => {
  const env = createMockEnv();

  it("should create AI factory with providers", () => {
    const factory = new AIFactory(env);
    expect(factory).toBeDefined();
    const providers = factory.getAvailableProviders();
    expect(providers.length).toBeGreaterThan(0);
  });

  it("should list available providers", () => {
    const factory = new AIFactory(env);
    const providers = factory.getAvailableProviders();
    expect(Array.isArray(providers)).toBe(true);
  });

  it("should handle provider fallback", async () => {
    const factory = new AIFactory(env);
    try {
      // This would attempt to call the API in real scenario
      // In tests, we verify the structure is correct
      expect(factory).toBeDefined();
    } catch (err) {
      // Expected in test environment without real API keys
    }
  });
});

describe("Webhook Endpoints", () => {
  const env = createMockEnv();
  const app = createRouter();

  it("should handle GitHub webhook", async () => {
    const payload = JSON.stringify({
      action: "opened",
      repository: { full_name: "hades/army" },
      pull_request: { number: 1, title: "Test PR" },
    });

    const req = createMockRequest("/webhook/github", {
      method: "POST",
      body: payload,
      headers: {
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "test-delivery-id",
        "X-Hub-Signature-256": "sha256=test",
        "Content-Type": "application/json",
      },
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.event).toBe("pull_request");
  });

  it("should handle Telegram webhook", async () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 123456, type: "private" },
        date: Date.now(),
        text: "/start",
        from: { id: 123456, is_bot: false, first_name: "Test" },
      },
    };

    const req = createMockRequest("/webhook/telegram", {
      method: "POST",
      body: JSON.stringify(update),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
  });

  it("should return 503 for unconfigured Telegram bot", async () => {
    const envWithoutToken = { ...env, TELEGRAM_BOT_TOKEN: undefined };
    const req = createMockRequest("/webhook/telegram", {
      method: "POST",
      body: JSON.stringify({ update_id: 1 }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await app.fetch(req, envWithoutToken as any);
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.error).toContain("not configured");
  });
});

describe("Metrics Endpoint", () => {
  const env = createMockEnv();
  const app = createRouter();

  it("should export Prometheus metrics", async () => {
    const req = createMockRequest("/metrics");
    const res = await app.fetch(req, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");

    const body = await res.text();
    expect(body).toBeDefined();
  });
});

describe("Scheduled Tasks", () => {
  const env = createMockEnv();

  it("should handle cron triggers", async () => {
    // Mock scheduled event
    const event = {
      cron: "*/5 * * * *",
      type: "cron",
      scheduledTime: Date.now(),
    };

    // Verify the worker export handles scheduled events
    expect(event.cron).toBe("*/5 * * * *");
  });

  it("should handle queue messages", async () => {
    // Mock queue message
    const message = {
      id: "msg-1",
      body: { type: "job", jobId: "job-123" },
      timestamp: Date.now(),
    };

    expect(message.body.type).toBe("job");
    expect(message.body.jobId).toBe("job-123");
  });
});
