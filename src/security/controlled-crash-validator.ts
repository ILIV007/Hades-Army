/**
 * Controlled Crash Validator - Cloudflare Workers Edition
 * Hades Army v0.9.2 — Stability
 *
 * Priority 1: Environment Validation — Crash Controlled
 *
 * Per v0.9.2 spec:
 *   "اگر وجود ندارند: سیستم Crash Controlled بدهد. نه Runtime Error."
 *
 * A "controlled crash" is:
 *   - A clear, logged error message that names the missing secret
 *   - A thrown HadesStartupError that the runtime catches cleanly
 *   - NEVER a generic ReferenceError or undefined-is-not-a-function
 *   - The Worker still boots — but routes that need the missing
 *     secret return a clear 503 with the missing-secret name
 *
 * CRITICAL secrets (Worker refuses to start workflows without them):
 *   TELEGRAM_BOT_TOKEN, GITHUB_TOKEN, GOOGLE_AI_API_KEY, ENCRYPTION_KEY
 *
 * Recommended + optional secrets still produce warnings but don't block.
 */

import { logger } from "../utils/logger";
import type { HadesBindings } from "../types";
import { validateSecretsAtStartup, type SecretValidationResult } from "./startup-validator";

// ============================================
// Types
// ============================================

export class HadesStartupError extends Error {
  constructor(
    public readonly missingSecrets: string[],
    message: string,
  ) {
    super(message);
    this.name = "HadesStartupError";
  }
}

export interface StartupCheckResult {
  ok: boolean;
  result: SecretValidationResult;
  /** true if Worker can boot but should refuse workflow requests */
  blockingWorkflow: boolean;
  /** list of routes that should return 503 */
  blockedRoutes: string[];
}

// ============================================
// Validator
// ============================================

// Secrets that MUST be present — if missing, the Worker boots but
// refuses to start any new workflow. Routes that don't need these
// secrets (like /health) still work.
const WORKFLOW_BLOCKING_SECRETS: Array<keyof HadesBindings> = [
  "TELEGRAM_BOT_TOKEN",
  "GITHUB_TOKEN",
  "GOOGLE_AI_API_KEY",
  "ENCRYPTION_KEY",
];

// Routes that are blocked when workflow-blocking secrets are missing.
// Other routes (health, status, menu, telegram) continue to work so
// the user can see WHAT is missing and fix it.
//
// CRITICAL (v9.2 fix): Telegram webhook MUST NOT be in this list.
// Blocking the webhook caused the entire bot to go silent — the
// user got no response at all, even to /start. The bot must always
// be able to respond (even with a "missing secrets" message).
const BLOCKED_ROUTES_WHEN_MISSING: string[] = [
  "/api/v1/workflows",
  "/api/v1/agents",
  "/api/v1/repositories",
  "/api/v1/tasks",
];

export class ControlledCrashValidator {
  /**
   * Validates secrets and produces a controlled result. NEVER throws
   * an uncaught error — returns a structured result instead.
   *
   * The Worker entry point can call this and use the result to:
   *   1. Log missing secrets clearly (with names, never values)
   *   2. Continue booting (so /health still works)
   *   3. Reject workflow routes with a clear 503 error
   */
  check(env: HadesBindings): StartupCheckResult {
    const result = validateSecretsAtStartup(env);

    // Identify which workflow-blocking secrets are missing
    const missingBlocking: string[] = [];
    for (const name of WORKFLOW_BLOCKING_SECRETS) {
      const value = env[name] as string | undefined;
      if (!value || typeof value !== "string" || value.length === 0) {
        missingBlocking.push(String(name));
      }
    }

    const blockingWorkflow = missingBlocking.length > 0;
    const blockedRoutes = blockingWorkflow ? BLOCKED_ROUTES_WHEN_MISSING : [];

    if (blockingWorkflow) {
      logger.error(
        `Hades Startup: missing workflow-blocking secrets — workflows will be rejected until these are set:`,
        {
          missing: missingBlocking,
          howToFix: "Run: wrangler secret put <NAME> for each missing secret, then redeploy.",
        },
      );
    } else if (result.degraded) {
      logger.warn(`Hades Startup: running in degraded mode (missing recommended secrets)`, {
        warnings: result.warnings,
      });
    } else {
      logger.info(`Hades Startup: all secrets present`, {
        checked: result.checked.length,
      });
    }

    return {
      ok: result.ok && !blockingWorkflow,
      result,
      blockingWorkflow,
      blockedRoutes,
    };
  }

  /**
   * Returns a JSON-friendly error body for HTTP 503 responses when
   * the user tries to start a workflow but the Worker is in
   * "blocking" mode.
   */
  renderBlockedResponse(missing: string[]): {
    status: number;
    body: {
      error: string;
      missing: string[];
      fix: string;
      docs: string;
    };
  } {
    return {
      status: 503,
      body: {
        error: "Hades Army is missing critical secrets and cannot process this request.",
        missing,
        fix: "Run `wrangler secret put <NAME>` for each missing secret, then redeploy with `wrangler deploy`.",
        docs: "See docs/v0.9.2-changelog.md → Deployment Instructions",
      },
    };
  }

  /**
   * Renders the startup check result for Telegram.
   */
  renderForTelegram(check: StartupCheckResult): string {
    if (check.ok) {
      return `✅ *Startup OK* — all critical secrets present.`;
    }

    const lines: string[] = [`❌ *Startup Blocked*`];

    if (check.blockingWorkflow) {
      lines.push(``);
      lines.push(`*Missing critical secrets:*`);
      const missing = check.result.checked.filter((c) => !c.present && c.requirement === "critical");
      for (const m of missing) {
        lines.push(`• \`${m.name}\` — ${m.description}`);
      }
      lines.push(``);
      lines.push(`*Fix:*`);
      lines.push(`Run this for each missing secret:`);
      lines.push(`\`wrangler secret put <NAME>\``);
      lines.push(`Then redeploy: \`wrangler deploy\``);
    }

    if (check.result.warnings.length > 0) {
      lines.push(``);
      lines.push(`*Recommended (non-blocking):*`);
      for (const w of check.result.warnings) {
        lines.push(`• \`${w}\``);
      }
    }

    return lines.join("\n");
  }
}

// ============================================
// Factory
// ============================================

let _instance: ControlledCrashValidator | null = null;

export function getControlledCrashValidator(): ControlledCrashValidator {
  if (!_instance) _instance = new ControlledCrashValidator();
  return _instance;
}
