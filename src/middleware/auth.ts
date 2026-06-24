
/**
 * Authentication Middleware - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Supports:
 * - API key authentication
 * - Bearer token authentication
 * - Admin token authentication
 * - Role-based access control
 */

import { createMiddleware } from "hono/factory";
import { logger } from "../utils/logger";
import { UnauthorizedError, ForbiddenError } from "../utils/errors";
import type { HadesContext } from "../types";

// ============================================
// Types
// ============================================

export interface AuthConfig {
  apiKeys: string[];
  adminToken?: string;
  requiredRole?: string;
  requiredPermissions?: string[];
}

export interface AuthenticatedUser {
  id: string;
  role: string;
  permissions: string[];
}

// ============================================
// Auth Middleware
// ============================================

export const authMiddleware = createMiddleware<HadesContext>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const requestId = c.get("requestId") || generateId("req");

  if (!authHeader) {
    throw new UnauthorizedError("Authorization header is required");
  }

  // Parse authorization header
  const [scheme, token] = authHeader.split(" ");

  if (!scheme || !token) {
    throw new UnauthorizedError("Invalid authorization header format. Use: Bearer <token> or ApiKey <key>");
  }

  const normalizedScheme = scheme.toLowerCase();

  // Get API keys from environment
  const apiKeys = parseApiKeys(c.env.API_KEYS);
  const adminToken = c.env.ADMIN_API_TOKEN;

  let user: AuthenticatedUser | null = null;

  if (normalizedScheme === "bearer" && token === adminToken) {
    // Admin authentication
    user = {
      id: "admin",
      role: "admin",
      permissions: ["*"],
    };
    logger.info(`Admin authenticated: ${requestId}`);
  } else if (normalizedScheme === "apikey" && apiKeys.includes(token)) {
    // API key authentication
    user = {
      id: `api_${token.substring(0, 8)}`,
      role: "api",
      permissions: ["read", "write"],
    };
    logger.info(`API key authenticated: ${requestId}`);
  } else if (normalizedScheme === "bearer" && apiKeys.includes(token)) {
    // Bearer token with API key
    user = {
      id: `api_${token.substring(0, 8)}`,
      role: "api",
      permissions: ["read", "write"],
    };
    logger.info(`Bearer token authenticated: ${requestId}`);
  } else {
    throw new UnauthorizedError("Invalid API key or token");
  }

  // Store user in context
  c.set("user", user);

  await next();
});

// ============================================
// Role-Based Middleware
// ============================================

export function requireRole(...roles: string[]) {
  return createMiddleware<HadesContext>(async (c, next) => {
    const user = c.get("user");

    if (!user) {
      throw new UnauthorizedError("Authentication required");
    }

    if (!roles.includes(user.role) && user.role !== "admin") {
      throw new ForbiddenError(`Required role: ${roles.join(" or ")}`);
    }

    await next();
  });
}

export function requirePermission(...permissions: string[]) {
  return createMiddleware<HadesContext>(async (c, next) => {
    const user = c.get("user");

    if (!user) {
      throw new UnauthorizedError("Authentication required");
    }

    const hasPermission = permissions.every((p) =>
      user.permissions.includes(p) || user.permissions.includes("*")
    );

    if (!hasPermission) {
      throw new ForbiddenError(`Required permissions: ${permissions.join(", ")}`);
    }

    await next();
  });
}

// ============================================
// Optional Auth Middleware
// ============================================

export const optionalAuthMiddleware = createMiddleware<HadesContext>(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader) {
    c.set("user", undefined);
    await next();
    return;
  }

  try {
    const [scheme, token] = authHeader.split(" ");
    const normalizedScheme = scheme.toLowerCase();
    const apiKeys = parseApiKeys(c.env.API_KEYS);
    const adminToken = c.env.ADMIN_API_TOKEN;

    if (normalizedScheme === "bearer" && token === adminToken) {
      c.set("user", { id: "admin", role: "admin", permissions: ["*"] });
    } else if ((normalizedScheme === "apikey" || normalizedScheme === "bearer") && apiKeys.includes(token)) {
      c.set("user", { id: `api_${token.substring(0, 8)}`, role: "api", permissions: ["read", "write"] });
    }
  } catch {
    // Ignore auth errors for optional auth
  }

  await next();
});

// ============================================
// Helpers
// ============================================

function parseApiKeys(apiKeysString?: string): string[] {
  if (!apiKeysString) return [];
  return apiKeysString.split(",").map((k) => k.trim()).filter(Boolean);
}

function generateId(prefix?: string): string {
  const random = Math.random().toString(36).substring(2, 11);
  const timestamp = Date.now().toString(36);
  const id = `${timestamp}_${random}`;
  return prefix ? `${prefix}_${id}` : id;
}

export const auth = {
  middleware: authMiddleware,
  optional: optionalAuthMiddleware,
  requireRole,
  requirePermission,
};
