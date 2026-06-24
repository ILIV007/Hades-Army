
/**
 * Health API Routes - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { Hono } from "hono";
import { logger } from "../../utils/logger";
import { createDb } from "../../database/client";
import { healthService } from "../../monitoring/health";
import type { HadesContext } from "../../types";

// ============================================
// Router
// ============================================

export const healthRouter = new Hono<HadesContext>();

// GET /api/v1/health - Basic health check
healthRouter.get("/", async (c) => {
  const report = await healthService.getHealthReport(c.env);

  const statusCode = report.status === "healthy" ? 200 : report.status === "degraded" ? 200 : 503;

  return c.json(
    {
      success: report.status !== "unhealthy",
      data: report,
    },
    statusCode
  );
});

// GET /api/v1/health/detailed - Detailed health check
healthRouter.get("/detailed", async (c) => {
  const report = await healthService.getDetailedHealthReport(c.env);

  return c.json({
    success: report.status !== "unhealthy",
    data: report,
  });
});

// GET /api/v1/health/checks/:name - Specific health check
healthRouter.get("/checks/:name", async (c) => {
  const name = c.req.param("name");
  const check = await healthService.runCheck(name, c.env);

  if (!check) {
    return c.json(
      {
        success: false,
        error: `Health check "${name}" not found`,
      },
      404
    );
  }

  return c.json({
    success: check.status !== "unhealthy",
    data: check,
  });
});

// GET /api/v1/health/metrics - Health metrics
healthRouter.get("/metrics", async (c) => {
  const metrics = await healthService.getMetrics();

  return c.json({
    success: true,
    data: metrics,
  });
});
