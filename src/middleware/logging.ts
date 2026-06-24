
/**
 * Request Logging Middleware - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Comprehensive request/response logging
 * - Request ID generation
 * - Timing
 * - Structured JSON logs
 * - Cloudflare-specific headers
 */

import { createMiddleware } from "hono/factory";
import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesContext } from "../types";

// ============================================
// Request Logging Middleware
// ============================================

export const requestLoggingMiddleware = createMiddleware<HadesContext>(async (c, next) => {
  const requestId = generateId("req");
  const startTime = Date.now();

  // Set request ID in context
  c.set("requestId", requestId);
  c.set("startTime", startTime);

  // Add request ID to response headers
  c.header("X-Request-ID", requestId);

  // Log request
  const requestLog = {
    requestId,
    method: c.req.method,
    path: c.req.path,
    query: Object.fromEntries(new URL(c.req.url).searchParams),
    headers: sanitizeHeaders(Object.fromEntries(c.req.raw.headers)),
    cf: c.req.raw.cf
      ? {
          country: (c.req.raw.cf as Record<string, unknown>).country,
          colo: (c.req.raw.cf as Record<string, unknown>).colo,
          asn: (c.req.raw.cf as Record<string, unknown>).asn,
        }
      : undefined,
  };

  logger.info(`→ ${c.req.method} ${c.req.path}`, requestLog);

  try {
    await next();

    // Log response
    const duration = Date.now() - startTime;
    const responseLog = {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration: `${duration}ms`,
      contentLength: c.res.headers.get("content-length"),
    };

    if (c.res.status >= 400) {
      logger.warn(`← ${c.req.method} ${c.req.path} ${c.res.status}`, responseLog);
    } else {
      logger.info(`← ${c.req.method} ${c.req.path} ${c.res.status}`, responseLog);
    }

    // Add timing header
    c.header("X-Response-Time", `${duration}ms`);
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error(`✕ ${c.req.method} ${c.req.path}`, {
      requestId,
      method: c.req.method,
      path: c.req.path,
      duration: `${duration}ms`,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
});

// ============================================
// Audit Logging Middleware
// ============================================

export const auditLoggingMiddleware = createMiddleware<HadesContext>(async (c, next) => {
  const requestId = c.get("requestId") || generateId("req");
  const user = c.get("user");

  // Log audit event before processing
  logger.info("Audit: Request started", {
    requestId,
    userId: user?.id,
    role: user?.role,
    method: c.req.method,
    path: c.req.path,
    timestamp: new Date().toISOString(),
  });

  await next();

  // Log audit event after processing
  logger.info("Audit: Request completed", {
    requestId,
    userId: user?.id,
    role: user?.role,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// Performance Logging Middleware
// ============================================

export const performanceLoggingMiddleware = createMiddleware<HadesContext>(async (c, next) => {
  const startTime = performance.now();

  await next();

  const endTime = performance.now();
  const duration = endTime - startTime;

  // Log slow requests
  if (duration > 1000) {
    logger.warn("Slow request detected", {
      method: c.req.method,
      path: c.req.path,
      duration: `${duration.toFixed(2)}ms`,
      threshold: "1000ms",
    });
  }
});

// ============================================
// Helpers
// ============================================

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sensitive = ["authorization", "cookie", "x-api-key", "api-key"];
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (sensitive.includes(lowerKey)) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export const logging = {
  request: requestLoggingMiddleware,
  audit: auditLoggingMiddleware,
  performance: performanceLoggingMiddleware,
};
