
/**
 * Error Handler Middleware - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Centralized error handling with:
 * - Structured error responses
 * - Error logging
 * - Stack trace sanitization
 * - Different behavior for dev/prod
 */

import { HTTPException } from "hono/http-exception";
import type { ErrorHandler } from "hono";
import { logger } from "../utils/logger";
import { HadesError } from "../utils/errors";
import type { HadesContext } from "../types";

// ============================================
// Error Handler
// ============================================

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get("requestId") || "unknown";
  const isDevelopment = c.env.NODE_ENV === "development";

  // Log the error
  logger.error("Request error", {
    requestId,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    path: c.req.path,
    method: c.req.method,
  });

  // Handle HadesError
  if (err instanceof HadesError) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: isDevelopment ? err.details : undefined,
        },
        requestId,
      },
      err.status
    );
  }

  // Handle HTTPException from Hono
  if (err instanceof HTTPException) {
    return c.json(
      {
        success: false,
        error: {
          code: `HTTP_${err.status}`,
          message: err.message || "An error occurred",
        },
        requestId,
      },
      err.status
    );
  }

  // Handle Zod validation errors (if they reach here)
  if (err && typeof err === "object" && "issues" in err) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: err.issues,
        },
        requestId,
      },
      400
    );
  }

  // Generic error (500)
  const status = 500;
  const response: Record<string, unknown> = {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: isDevelopment
        ? err instanceof Error
          ? err.message
          : "An unexpected error occurred"
        : "An unexpected error occurred",
    },
    requestId,
  };

  // Include stack trace in development
  if (isDevelopment && err instanceof Error) {
    response.error = {
      ...response.error,
      stack: err.stack,
      name: err.name,
    };
  }

  return c.json(response, status);
};

// ============================================
// Not Found Handler
// ============================================

export const notFoundHandler = (c: HadesContext) => {
  const requestId = c.get("requestId") || "unknown";

  return c.json(
    {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
      requestId,
    },
    404
  );
};

export const errorHandling = {
  handler: errorHandler,
  notFound: notFoundHandler,
};
