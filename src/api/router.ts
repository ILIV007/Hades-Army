
/**
 * API Router - Cloudflare Workers Edition
 * Hades Army v0.8.0 (Workers Edition)
 *
 * Hono router with all API routes mounted
 * - RESTful API design
 * - OpenAPI-style documentation
 * - Versioned endpoints
 * - CORS support
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";
import { logger } from "../utils/logger";
import { errorHandler } from "../middleware/error-handler";
import { authMiddleware } from "../middleware/auth";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { requestLoggingMiddleware } from "../middleware/logging";

// Route imports
import { agentsRouter } from "./routes/agents";
import { reviewsRouter } from "./routes/reviews";
import { approvalsRouter } from "./routes/approvals";
import { memoryRouter } from "./routes/memory";
import { rollbackRouter } from "./routes/rollback";
import { promptsRouter } from "./routes/prompts";
import { healthRouter } from "./routes/health";

import type { HadesContext } from "../types";

// ============================================
// Main Router
// ============================================

export function createRouter(): Hono<HadesContext> {
  const app = new Hono<HadesContext>();

  // ============================================
  // Global Middleware
  // ============================================

  // CORS
  app.use(
    "*",
    cors({
      origin: ["https://hades-army.pages.dev", "http://localhost:8787"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
      exposeHeaders: ["X-Request-ID", "X-RateLimit-Remaining"],
      maxAge: 86400,
      credentials: true,
    })
  );

  // Pretty JSON for development
  app.use("*", prettyJSON());

  // Request logging
  app.use("*", requestLoggingMiddleware);

  // Rate limiting
  app.use("*", rateLimitMiddleware);

  // Error handling
  app.onError(errorHandler);

  // ============================================
  // Health Check (public)
  // ============================================

  app.get("/", (c) => {
    return c.json({
      name: "Hades Army",
      version: "0.8.0",
      description: "Autonomous AI Development Army - Cloudflare Workers Edition",
      status: "operational",
      documentation: "/api/v1/docs",
      health: "/api/v1/health",
    });
  });

  app.get("/health", (c) => {
    return c.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "0.8.0",
    });
  });

  // ============================================
  // API v1 Routes
  // ============================================

  const v1 = new Hono<HadesContext>();

  // Public routes (no auth required)
  v1.route("/health", healthRouter);

  // Protected routes (auth required)
  v1.use("/agents/*", authMiddleware);
  v1.use("/reviews/*", authMiddleware);
  v1.use("/approvals/*", authMiddleware);
  v1.use("/memory/*", authMiddleware);
  v1.use("/rollback/*", authMiddleware);
  v1.use("/prompts/*", authMiddleware);

  v1.route("/agents", agentsRouter);
  v1.route("/reviews", reviewsRouter);
  v1.route("/approvals", approvalsRouter);
  v1.route("/memory", memoryRouter);
  v1.route("/rollback", rollbackRouter);
  v1.route("/prompts", promptsRouter);

  // Mount v1
  app.route("/api/v1", v1);

  // ============================================
  // API Documentation
  // ============================================

  app.get("/api/v1/docs", (c) => {
    return c.json({
      openapi: "3.0.0",
      info: {
        title: "Hades Army API",
        version: "0.8.0",
        description: "Autonomous AI Development Army REST API",
      },
      servers: [{ url: "/api/v1" }],
      paths: {
        "/health": {
          get: {
            summary: "Health check",
            responses: {
              "200": { description: "System is healthy" },
            },
          },
        },
        "/agents": {
          get: { summary: "List all agents", tags: ["Agents"] },
          post: { summary: "Create a new agent", tags: ["Agents"] },
        },
        "/agents/{id}": {
          get: { summary: "Get agent by ID", tags: ["Agents"] },
          patch: { summary: "Update agent", tags: ["Agents"] },
          delete: { summary: "Delete agent", tags: ["Agents"] },
        },
        "/reviews": {
          get: { summary: "List reviews", tags: ["Reviews"] },
          post: { summary: "Create review", tags: ["Reviews"] },
        },
        "/approvals": {
          get: { summary: "List approval requests", tags: ["Approvals"] },
          post: { summary: "Create approval request", tags: ["Approvals"] },
        },
        "/memory": {
          get: { summary: "List memory entries", tags: ["Memory"] },
          post: { summary: "Create memory entry", tags: ["Memory"] },
        },
        "/rollback": {
          get: { summary: "List snapshots", tags: ["Rollback"] },
          post: { summary: "Create snapshot", tags: ["Rollback"] },
        },
        "/prompts": {
          get: { summary: "List prompt templates", tags: ["Prompts"] },
          post: { summary: "Create prompt template", tags: ["Prompts"] },
        },
      },
    });
  });

  // ============================================
  // 404 Handler
  // ============================================

  app.notFound((c) => {
    return c.json(
      {
        error: "Not Found",
        message: `Route ${c.req.method} ${c.req.path} not found`,
        code: "ROUTE_NOT_FOUND",
      },
      404
    );
  });

  logger.info("API Router initialized with v1 endpoints");
  return app;
}

export const apiRouter = { createRouter };
