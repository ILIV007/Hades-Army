
/**
 * Validation Middleware - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Zod-based request validation for:
 * - JSON body validation
 * - Query parameter validation
 * - Path parameter validation
 * - Header validation
 */

import { createMiddleware } from "hono/factory";
import { z, type ZodSchema, type ZodError } from "zod";
import { ValidationError } from "../utils/errors";
import type { HadesContext } from "../types";

// ============================================
// Body Validation
// ============================================

export function validateBody<T>(schema: ZodSchema<T>) {
  return createMiddleware<HadesContext>(async (c, next) => {
    try {
      const body = await c.req.json();
      const validated = schema.parse(body);
      c.set("validatedBody", validated);
      await next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ValidationError("Request body validation failed", formatZodError(err));
      }
      throw new ValidationError("Invalid request body");
    }
  });
}

// ============================================
// Query Validation
// ============================================

export function validateQuery<T>(schema: ZodSchema<T>) {
  return createMiddleware<HadesContext>(async (c, next) => {
    try {
      const query = Object.fromEntries(new URL(c.req.url).searchParams);
      const validated = schema.parse(query);
      c.set("validatedQuery", validated);
      await next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ValidationError("Query parameter validation failed", formatZodError(err));
      }
      throw new ValidationError("Invalid query parameters");
    }
  });
}

// ============================================
// Params Validation
// ============================================

export function validateParams<T>(schema: ZodSchema<T>) {
  return createMiddleware<HadesContext>(async (c, next) => {
    try {
      const params = c.req.param();
      const validated = schema.parse(params);
      c.set("validatedParams", validated);
      await next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ValidationError("Path parameter validation failed", formatZodError(err));
      }
      throw new ValidationError("Invalid path parameters");
    }
  });
}

// ============================================
// Combined Validation
// ============================================

export function validateRequest<TBody, TQuery, TParams>(schemas: {
  body?: ZodSchema<TBody>;
  query?: ZodSchema<TQuery>;
  params?: ZodSchema<TParams>;
}) {
  return createMiddleware<HadesContext>(async (c, next) => {
    try {
      if (schemas.body) {
        const body = await c.req.json();
        c.set("validatedBody", schemas.body.parse(body));
      }

      if (schemas.query) {
        const query = Object.fromEntries(new URL(c.req.url).searchParams);
        c.set("validatedQuery", schemas.query.parse(query));
      }

      if (schemas.params) {
        const params = c.req.param();
        c.set("validatedParams", schemas.params.parse(params));
      }

      await next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ValidationError("Request validation failed", formatZodError(err));
      }
      throw new ValidationError("Invalid request");
    }
  });
}

// ============================================
// Common Schemas
// ============================================

export const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export const idSchema = z.object({
  id: z.string().min(1).max(100),
});

export const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ============================================
// Helpers
// ============================================

function formatZodError(error: ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (!formatted[path]) {
      formatted[path] = [];
    }
    formatted[path].push(issue.message);
  }

  return formatted;
}

export const validation = {
  body: validateBody,
  query: validateQuery,
  params: validateParams,
  request: validateRequest,
  schemas: {
    pagination: paginationSchema,
    id: idSchema,
    dateRange: dateRangeSchema,
  },
};
