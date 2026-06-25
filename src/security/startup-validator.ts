/**
 * Startup Secret Validator - Cloudflare Workers Edition
 * Hades Army v0.9.1 — Production Readiness
 *
 * Priority 13: Security
 *
 * Validates that all critical secrets are present at Worker startup.
 * Missing secrets do NOT block the Worker (we run in degraded mode)
 * but they ARE logged as warnings and exposed via /health.
 *
 * CRITICAL: No secret VALUES are ever logged — only their presence.
 */

import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export type SecretRequirement = "critical" | "recommended" | "optional";

export interface SecretSpec {
  name: keyof HadesBindings;
  requirement: SecretRequirement;
  description: string;
  /** minimum length (in chars) to be considered valid */
  minLength?: number;
}

export interface SecretCheckResult {
  name: string;
  present: boolean;
  valid: boolean;
  requirement: SecretRequirement;
  issue?: string; // never includes the secret value
}

export interface SecretValidationResult {
  ok: boolean;                  // true if all CRITICAL secrets are present and valid
  degraded: boolean;            // true if running with missing RECOMMENDED secrets
  checked: SecretCheckResult[];
  missing: string[];            // names of missing CRITICAL secrets
  warnings: string[];           // names of missing RECOMMENDED secrets
  checkedAt: string;
}

// ============================================
// Secret specifications
// ============================================

const SECRET_SPECS: SecretSpec[] = [
  {
    name: "TELEGRAM_BOT_TOKEN",
    requirement: "critical",
    description: "Telegram bot token from @BotFather — required for Telegram UX",
    minLength: 20,
  },
  {
    name: "GITHUB_TOKEN",
    requirement: "critical",
    description: "GitHub PAT with repo scope — required for repository operations",
    minLength: 20,
  },
  {
    name: "GOOGLE_AI_API_KEY",
    requirement: "critical",
    description: "Google AI Studio API key — required for Manager (Gemini 3 Flash)",
    minLength: 20,
  },
  {
    name: "OPENROUTER_API_KEY",
    requirement: "critical",
    description: "OpenRouter API key — required for Builder (Qwen3-Coder) + Reviewer (DeepSeek)",
    minLength: 20,
  },
  {
    name: "ADMIN_API_TOKEN",
    requirement: "critical",
    description: "Admin token for REST API authentication",
    minLength: 16,
  },
  {
    name: "JWT_SECRET",
    requirement: "critical",
    description: "JWT signing secret — required for authenticated session tokens",
    minLength: 32,
  },
  {
    name: "ENCRYPTION_KEY",
    requirement: "critical",
    description: "Encryption key for at-rest secrets (e.g. user GitHub tokens stored in D1)",
    minLength: 32,
  },
  {
    name: "API_KEYS",
    requirement: "recommended",
    description: "Comma-separated API keys for REST API access",
  },
  {
    name: "OPENAI_API_KEY",
    requirement: "optional",
    description: "OpenAI API key — legacy fallback only",
  },
  {
    name: "ANTHROPIC_API_KEY",
    requirement: "optional",
    description: "Anthropic API key — legacy fallback only",
  },
];

// ============================================
// Validator
// ============================================

/**
 * Validates all configured secrets at Worker startup.
 * Call this ONCE per isolate (see src/index.ts initializeStartup()).
 *
 * Returns a result that:
 *   - NEVER contains secret values
 *   - Lists missing CRITICAL secrets in `missing[]`
 *   - Lists missing RECOMMENDED secrets in `warnings[]`
 *   - Sets `ok=false` if any CRITICAL secret is missing or invalid
 *   - Sets `degraded=true` if RECOMMENDED secrets are missing (but ok)
 */
export function validateSecretsAtStartup(env: HadesBindings): SecretValidationResult {
  const checked: SecretCheckResult[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const spec of SECRET_SPECS) {
    const value = env[spec.name] as string | undefined;
    const present = !!value && typeof value === "string" && value.length > 0;
    const valid = present && (!spec.minLength || value.length >= spec.minLength);

    const result: SecretCheckResult = {
      name: spec.name,
      present,
      valid,
      requirement: spec.requirement,
    };

    if (!present) {
      result.issue = "missing";
      if (spec.requirement === "critical") missing.push(spec.name);
      else if (spec.requirement === "recommended") warnings.push(spec.name);
    } else if (!valid) {
      result.issue = `too short (min ${spec.minLength} chars)`;
      if (spec.requirement === "critical") missing.push(spec.name);
      else if (spec.requirement === "recommended") warnings.push(spec.name);
    }

    checked.push(result);
  }

  return {
    ok: missing.length === 0,
    degraded: warnings.length > 0 && missing.length === 0,
    checked,
    missing,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

// ============================================
// Helpers
// ============================================

/**
 * Returns true if a specific secret is present and valid.
 * Use this in route handlers to gate features on secret availability.
 */
export function isSecretAvailable(env: HadesBindings, name: keyof HadesBindings): boolean {
  const value = env[name] as string | undefined;
  const spec = SECRET_SPECS.find((s) => s.name === name);
  if (!spec) return !!value;
  if (!value || typeof value !== "string") return false;
  if (spec.minLength && value.length < spec.minLength) return false;
  return true;
}

/**
 * Returns a sanitized list of all secret specs (for /health endpoint).
 * NEVER returns secret values — only metadata.
 */
export function listSecretSpecs(): Array<Omit<SecretSpec, never>> {
  return [...SECRET_SPECS];
}

/**
 * Masks a secret for safe logging. Returns "set" if present, "missing" if not.
 * NEVER returns the actual value.
 */
export function maskSecret(env: HadesBindings, name: keyof HadesBindings): "set" | "missing" {
  return isSecretAvailable(env, name) ? "set" : "missing";
}
