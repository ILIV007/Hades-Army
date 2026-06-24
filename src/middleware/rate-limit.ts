
/**
 * Rate Limiting Middleware - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Uses Cloudflare KV for distributed rate limiting
 * - Per-IP rate limiting
 * - Per-API-key rate limiting
 * - Configurable windows and limits
 * - Burst allowance
 */

import { createMiddleware } from "hono/factory";
import { logger } from "../utils/logger";
import { RateLimitError } from "../utils/errors";
import { KVCache } from "../database/kv";
import type { HadesContext } from "../types";

// ============================================
// Configuration
// ============================================

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  burstLimit?: number;
  keyPrefix?: string;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
  burstLimit: 10,
  keyPrefix: "ratelimit",
};

const ADMIN_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000,
  maxRequests: 1000,
  burstLimit: 50,
  keyPrefix: "ratelimit_admin",
};

// ============================================
// Rate Limit Middleware
// ============================================

export const rateLimitMiddleware = createMiddleware<HadesContext>(async (c, next) => {
  const kv = new KVCache(c.env.HADES_KV);
  const clientIp = getClientIP(c);
  const user = c.get("user");

  // Admin users get higher limits
  const config = user?.role === "admin" ? ADMIN_CONFIG : DEFAULT_CONFIG;

  const key = `${config.keyPrefix}:${clientIp}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;

  try {
    // Get current rate limit data
    const rateData = await kv.get<RateLimitData>(key);

    let requests: number[];
    if (rateData) {
      // Filter out old requests outside the window
      requests = rateData.requests.filter((t) => t > windowStart);
    } else {
      requests = [];
    }

    // Check if limit exceeded
    if (requests.length >= config.maxRequests) {
      const oldestRequest = requests[0];
      const retryAfter = Math.ceil((oldestRequest + config.windowMs - now) / 1000);

      logger.warn(`Rate limit exceeded for ${clientIp}`, {
        requests: requests.length,
        limit: config.maxRequests,
        retryAfter,
      });

      c.header("X-RateLimit-Limit", String(config.maxRequests));
      c.header("X-RateLimit-Remaining", "0");
      c.header("X-RateLimit-Reset", String(Math.ceil((now + config.windowMs) / 1000)));
      c.header("Retry-After", String(retryAfter));

      throw new RateLimitError(
        `Rate limit exceeded. Try again in ${retryAfter} seconds.`
      );
    }

    // Add current request
    requests.push(now);

    // Store updated rate limit data
    await kv.set(key, { requests }, Math.ceil(config.windowMs / 1000));

    // Set rate limit headers
    const remaining = config.maxRequests - requests.length;
    c.header("X-RateLimit-Limit", String(config.maxRequests));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil((now + config.windowMs) / 1000)));

    await next();
  } catch (err) {
    if (err instanceof RateLimitError) {
      throw err;
    }
    // If KV fails, allow the request but log the error
    logger.error("Rate limit check failed", { error: err instanceof Error ? err.message : String(err) });
    await next();
  }
});

// ============================================
// Strict Rate Limit Middleware
// ============================================

export function createRateLimitMiddleware(config: Partial<RateLimitConfig>) {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  return createMiddleware<HadesContext>(async (c, next) => {
    const kv = new KVCache(c.env.HADES_KV);
    const clientIp = getClientIP(c);
    const key = `${fullConfig.keyPrefix}:${clientIp}`;
    const now = Date.now();
    const windowStart = now - fullConfig.windowMs;

    try {
      const rateData = await kv.get<RateLimitData>(key);
      let requests: number[];

      if (rateData) {
        requests = rateData.requests.filter((t) => t > windowStart);
      } else {
        requests = [];
      }

      if (requests.length >= fullConfig.maxRequests) {
        const oldestRequest = requests[0];
        const retryAfter = Math.ceil((oldestRequest + fullConfig.windowMs - now) / 1000);

        c.header("X-RateLimit-Limit", String(fullConfig.maxRequests));
        c.header("X-RateLimit-Remaining", "0");
        c.header("Retry-After", String(retryAfter));

        throw new RateLimitError(
          `Rate limit exceeded. Try again in ${retryAfter} seconds.`
        );
      }

      requests.push(now);
      await kv.set(key, { requests }, Math.ceil(fullConfig.windowMs / 1000));

      const remaining = fullConfig.maxRequests - requests.length;
      c.header("X-RateLimit-Limit", String(fullConfig.maxRequests));
      c.header("X-RateLimit-Remaining", String(remaining));

      await next();
    } catch (err) {
      if (err instanceof RateLimitError) {
        throw err;
      }
      logger.error("Rate limit check failed", { error: err instanceof Error ? err.message : String(err) });
      await next();
    }
  });
}

// ============================================
// Helpers
// ============================================

interface RateLimitData {
  requests: number[];
}

function getClientIP(c: HadesContext): string {
  // Try various headers for client IP
  const headers = [
    c.req.header("CF-Connecting-IP"),
    c.req.header("X-Forwarded-For"),
    c.req.header("X-Real-IP"),
  ];

  for (const header of headers) {
    if (header) {
      // X-Forwarded-For can contain multiple IPs
      return header.split(",")[0].trim();
    }
  }

  // Fallback to a hash of the request info
  return "unknown";
}

export const rateLimit = {
  middleware: rateLimitMiddleware,
  create: createRateLimitMiddleware,
};
