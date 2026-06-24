
/**
 * API Tests - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createMockEnv, createMockRequest } from "./setup";
import { createRouter } from "../src/api/router";

describe("API Router", () => {
  const env = createMockEnv();
  const app = createRouter();

  it("should return API info on root", async () => {
    const req = createMockRequest("/");
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe("Hades Army");
    expect(body.version).toBe("0.8.0");
    expect(body.status).toBe("operational");
  });

  it("should return health status", async () => {
    const req = createMockRequest("/health");
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("healthy");
    expect(body.version).toBe("0.8.0");
  });

  it("should return API documentation", async () => {
    const req = createMockRequest("/api/v1/docs");
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.openapi).toBe("3.0.0");
    expect(body.info.title).toBe("Hades Army API");
  });

  it("should return 404 for unknown routes", async () => {
    const req = createMockRequest("/unknown-route");
    const res = await app.fetch(req, env);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Not Found");
  });
});

describe("Agents API", () => {
  const env = createMockEnv();
  const app = createRouter();

  it("should create an agent", async () => {
    const req = createMockRequest("/api/v1/agents", {
      method: "POST",
      body: {
        name: "API Test Agent",
        type: "builder",
        priority: 7,
        capabilities: ["typescript"],
      },
      headers: {
        Authorization: "Bearer mock-admin-token",
      },
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe("API Test Agent");
  });

  it("should list agents", async () => {
    const req = createMockRequest("/api/v1/agents", {
      headers: {
        Authorization: "Bearer mock-admin-token",
      },
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("should require authentication", async () => {
    const req = createMockRequest("/api/v1/agents");
    const res = await app.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("should validate request body", async () => {
    const req = createMockRequest("/api/v1/agents", {
      method: "POST",
      body: { name: "" },
      headers: {
        Authorization: "Bearer mock-admin-token",
        "Content-Type": "application/json",
      },
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(400);
  });
});

describe("Reviews API", () => {
  const env = createMockEnv();
  const app = createRouter();

  it("should create a review", async () => {
    const req = createMockRequest("/api/v1/reviews", {
      method: "POST",
      body: {
        target: "test.ts",
        code: "function test() { return 42; }",
        type: "code",
      },
      headers: {
        Authorization: "Bearer mock-admin-token",
      },
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.target).toBe("test.ts");
  });

  it("should list reviews", async () => {
    const req = createMockRequest("/api/v1/reviews", {
      headers: {
        Authorization: "Bearer mock-admin-token",
      },
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe("Health API", () => {
  const env = createMockEnv();
  const app = createRouter();

  it("should return health status", async () => {
    const req = createMockRequest("/api/v1/health");
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  it("should return detailed health", async () => {
    const req = createMockRequest("/api/v1/health/detailed");
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.checks).toBeDefined();
  });
});

describe("CORS", () => {
  const env = createMockEnv();
  const app = createRouter();

  it("should include CORS headers", async () => {
    const req = createMockRequest("/", {
      headers: {
        Origin: "https://hades-army.pages.dev",
      },
    });

    const res = await app.fetch(req, env);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://hades-army.pages.dev");
  });

  it("should handle OPTIONS requests", async () => {
    const req = createMockRequest("/api/v1/agents", {
      method: "OPTIONS",
      headers: {
        Origin: "https://hades-army.pages.dev",
        "Access-Control-Request-Method": "POST",
      },
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(204);
  });
});

describe("Rate Limiting", () => {
  const env = createMockEnv();
  const app = createRouter();

  it("should include rate limit headers", async () => {
    const req = createMockRequest("/");
    const res = await app.fetch(req, env);

    expect(res.headers.get("X-RateLimit-Limit")).toBeDefined();
    expect(res.headers.get("X-RateLimit-Remaining")).toBeDefined();
  });
});
