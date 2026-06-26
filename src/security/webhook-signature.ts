/**
 * Webhook Signature Validator - Cloudflare Workers Edition
 * Hades Army v9.3 — Security
 *
 * Priority 15: Security — Validate webhook signatures
 *
 * Validates HMAC signatures from:
 *   - Telegram (X-Telegram-Bot-Api-Secret-Token header)
 *   - GitHub (X-Hub-Signature-256 header)
 *
 * Usage:
 *   if (!verifyTelegramWebhook(request, env.TELEGRAM_WEBHOOK_SECRET)) {
 *     return c.json({ error: "invalid signature" }, 401);
 *   }
 */

import { logger } from "../utils/logger";

// ============================================
// Telegram webhook validation
// ============================================

/**
 * Telegram supports an optional "secret_token" parameter when setting
 * the webhook. If set, Telegram sends it in the
 * `X-Telegram-Bot-Api-Secret-Token` header on every update.
 *
 * If the secret is not configured on the Worker side, we skip
 * validation (returns true) — this preserves backward compatibility.
 */
export function verifyTelegramWebhook(
  request: Request,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret) {
    // No secret configured — skip validation
    return true;
  }
  const provided = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!provided) {
    logger.warn("Telegram webhook: missing secret token header");
    return false;
  }
  // Constant-time comparison
  return constantTimeEquals(provided, expectedSecret);
}

// ============================================
// GitHub webhook validation
// ============================================

/**
 * GitHub sends an HMAC-SHA256 signature in the `X-Hub-Signature-256`
 * header. The signature is computed over the raw request body using
 * the GITHUB_WEBHOOK_SECRET.
 *
 * Format: `sha256=<hex>`
 */
export async function verifyGitHubWebhook(
  body: string,
  signatureHeader: string | null,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) {
    // No secret configured — skip validation
    return true;
  }
  if (!signatureHeader) {
    logger.warn("GitHub webhook: missing signature header");
    return false;
  }
  if (!signatureHeader.startsWith("sha256=")) {
    logger.warn("GitHub webhook: invalid signature format");
    return false;
  }

  const expected = await hmacSha256Hex(body, secret);
  const provided = signatureHeader.slice("sha256=".length);
  return constantTimeEquals(expected, provided);
}

// ============================================
// Helpers
// ============================================

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  // Use Web Crypto API (available in Cloudflare Workers)
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  // Convert ArrayBuffer to hex
  const bytes = new Uint8Array(signature);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
