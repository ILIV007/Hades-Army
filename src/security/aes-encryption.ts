/**
 * AES-256 Token Encryption - Cloudflare Workers Edition
 * Hades Army v0.10 — Secure Token Storage
 *
 * Uses Web Crypto API (available in Cloudflare Workers) for AES-GCM
 * encryption. The ENCRYPTION_KEY env var is used as the base key.
 *
 * Token is NEVER stored in plaintext:
 *   - Not in logs
 *   - Not in memory dumps
 *   - Not in debug output
 *   - Not in project files
 *   - Decrypted ONLY at the moment of GitHub API call
 */

import { logger } from "../utils/logger";

// ============================================
// Types
// ============================================

export interface EncryptedPayload {
  /** base64-encoded ciphertext */
  ciphertext: string;
  /** base64-encoded IV (12 bytes for AES-GCM) */
  iv: string;
  /** algorithm version for forward compat */
  v: number;
}

// ============================================
// Key derivation (PBKDF2 from ENCRYPTION_KEY env var)
// ============================================

const KEY_ALGO = "AES-GCM";
const KEY_LENGTH = 256;
const KEY_USAGES: KeyUsage[] = ["encrypt", "decrypt"];
const IV_LENGTH = 12;
const SALT = "hades-army-v0.10-salt"; // static salt (in production, per-user salt would be better)

let _cachedKey: CryptoKey | null = null;
let _cachedKeyEnv: string | null = null;

async function getDerivedKey(encryptionKey: string): Promise<CryptoKey> {
  // Cache the key per-env-value (avoid re-deriving on every call)
  if (_cachedKey && _cachedKeyEnv === encryptionKey) {
    return _cachedKey;
  }

  const encoder = new TextEncoder();

  // PBKDF2 derive key from the env password
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(encryptionKey),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(SALT),
      iterations: 100000, // 100k iterations — sufficient for AES-256
      hash: "SHA-256",
    },
    baseKey,
    { name: KEY_ALGO, length: KEY_LENGTH },
    false,
    KEY_USAGES,
  );

  _cachedKey = derivedKey;
  _cachedKeyEnv = encryptionKey;
  return derivedKey;
}

// ============================================
// Encrypt
// ============================================

export async function encryptToken(
  plaintext: string,
  encryptionKey: string,
): Promise<EncryptedPayload> {
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY is not set — cannot encrypt token");
  }

  const key = await getDerivedKey(encryptionKey);
  const encoder = new TextEncoder();

  // Generate random IV (12 bytes for AES-GCM)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: KEY_ALGO, iv },
    key,
    encoder.encode(plaintext),
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv),
    v: 1,
  };
}

// ============================================
// Decrypt
// ============================================

export async function decryptToken(
  payload: EncryptedPayload,
  encryptionKey: string,
): Promise<string> {
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY is not set — cannot decrypt token");
  }

  const key = await getDerivedKey(encryptionKey);
  const decoder = new TextDecoder();

  const ciphertext = base64ToArrayBuffer(payload.ciphertext);
  const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));

  const plaintext = await crypto.subtle.decrypt(
    { name: KEY_ALGO, iv },
    key,
    ciphertext,
  );

  return decoder.decode(plaintext);
}

// ============================================
// Helpers
// ============================================

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ============================================
// Safe serialization (for KV storage)
// ============================================

export function serializeEncrypted(payload: EncryptedPayload): string {
  return JSON.stringify(payload);
}

export function deserializeEncrypted(raw: string): EncryptedPayload | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.ciphertext === "string" && typeof parsed.iv === "string") {
      return parsed as EncryptedPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================
// Masking (for debug — NEVER reveals the token)
// ============================================

export function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
