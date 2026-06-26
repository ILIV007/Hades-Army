/**
 * Admin Rate Limiter - Cloudflare Workers Edition
 * Hades Army v9.3 — Security
 *
 * Priority 15: Security — Rate-limit admin endpoints
 *
 * Per-IP rate limiting for /admin/* endpoints. Uses in-memory counters
 * (per-isolate). For production with multiple isolates, mirror to KV.
 *
 * Limits:
 *   - 60 requests per minute per IP for admin API
 *   - 10 requests per minute per IP for emergency mode toggle
 */

import { logger } from "../utils/logger";

// ============================================
// Types
// ============================================

interface RateBucket {
  count: number;
  windowStart: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

// ============================================
// Rate limiter
// ============================================

const buckets = new Map<string, RateBucket>();
const WINDOW_MS = 60_000; // 1 minute

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number = WINDOW_MS,
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > windowMs) {
    // New window
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs, limit };
  }

  bucket.count++;
  const remaining = Math.max(0, limit - bucket.count);
  const allowed = bucket.count <= limit;

  if (!allowed) {
    logger.warn("RateLimit: blocked", { key, count: bucket.count, limit });
  }

  return {
    allowed,
    remaining,
    resetAt: bucket.windowStart + windowMs,
    limit,
  };
}

// ============================================
// Convenience: admin endpoints
// ============================================

const ADMIN_API_LIMIT = 60;       // per minute
const EMERGENCY_LIMIT = 10;       // per minute

export function checkAdminApiRateLimit(ip: string): RateLimitResult {
  return checkRateLimit(`admin:api:${ip}`, ADMIN_API_LIMIT);
}

export function checkEmergencyToggleRateLimit(ip: string): RateLimitResult {
  return checkRateLimit(`admin:emergency:${ip}`, EMERGENCY_LIMIT);
}

// ============================================
// IP extraction
// ============================================

export function extractIp(request: Request): string {
  // Cloudflare puts the client IP in CF-Connecting-IP
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ??
    "unknown"
  );
}
