/**
 * Hades Army v0.2.1 — Agent Registry Configuration
 * ⚔️ SINGLE SOURCE OF TRUTH ⚔️
 * 
 * Manager    → Google AI Studio (gemini-3-flash)
 * Builder    → OpenRouter (env-driven)
 * Reviewer   → OpenRouter (env-driven)
 * 
 * NO hardcoded models anywhere else.
 */

import type { HadesEnv } from "./env";
import type { AgentRole, AgentConfig, AgentRegistry } from "../types";

/**
 * ═══════════════════════════════════════════
 * HADES ARMY v0.2.1 — AGENT REGISTRY
 * ═══════════════════════════════════════════
 */

export function createAgentRegistry(env: HadesEnv): AgentRegistry {
  return {
    manager: {
      role: "manager",
      // FIX #1: Manager → Google AI Studio
      model: env.DEFAULT_MANAGER_MODEL || "gemini-3-flash",
      provider: "google",
      temperature: 0.3,
      maxTokens: 8192,
      capabilities: [
        "project_understanding",
        "task_decomposition",
        "agent_coordination",
        "memory_management",
        "github_management",
        "workflow_management",
        "progress_reporting",
        "repository_analysis",
      ],
      restrictions: [
        "NO_DIRECT_CODE_IMPLEMENTATION",
        "NO_SELF_MODIFICATION",
        "NO_MERGE_WITHOUT_APPROVAL",
        "NO_MEMORY_BYPASS",
      ],
    },

    builder: {
      role: "builder",
      // FIX #2: Builder from env (not hardcoded)
      model: env.DEFAULT_BUILDER_MODEL || "qwen/qwen3-coder",
      provider: "openrouter",
      temperature: 0.2,
      maxTokens: 16384,
      capabilities: [
        "feature_implementation",
        "refactoring",
        "bug_fixing",
        "patch_generation",
        "code_analysis",
      ],
      restrictions: [
        "NO_CODE_REVIEW",
        "NO_MEMORY_MANAGEMENT",
        "NO_COMMIT_PUSH_MERGE",
        "NO_ARCHITECTURE_DECISIONS",
        "NO_FULL_REPO_REWRITE",
      ],
    },

    reviewer: {
      role: "reviewer",
      // FIX #3: Reviewer from env (not hardcoded)
      model: env.DEFAULT_REVIEWER_MODEL || "deepseek/deepseek-v3.1",
      provider: "openrouter",
      temperature: 0.1,
      maxTokens: 8192,
      capabilities: [
        "code_review",
        "security_review",
        "architecture_validation",
        "bug_detection",
        "quality_control",
      ],
      restrictions: [
        "NO_FEATURE_IMPLEMENTATION",
        "NO_MEMORY_MODIFICATION",
        "NO_MERGE_CODE",
        "NO_PROJECT_PLAN_CHANGES",
      ],
    },
  };
}

/**
 * Get agent config with VALIDATION
 * FIX #5: Registry Validation — throws if missing
 */
export function getAgentConfig(registry: AgentRegistry, role: AgentRole): AgentConfig {
  const config = registry[role];
  if (!config) {
    throw new Error(
      `[RegistryValidation] Agent role not found: "${role}". ` +
      `Available roles: ${Object.keys(registry).join(", ")}`
    );
  }
  return config;
}

/**
 * Update agent model
 */
export function updateAgentModel(
  registry: AgentRegistry,
  role: AgentRole,
  model: string,
  provider: "openrouter" | "google" = "openrouter"
): AgentRegistry {
  return {
    ...registry,
    [role]: {
      ...registry[role],
      model,
      provider,
    },
  };
}

/**
 * ═══════════════════════════════════════════
 * FIX #6: Model Capability Validation
 * ═══════════════════════════════════════════
 */

const ALLOWED_MODEL_PATTERNS: Record<AgentRole, string[]> = {
  manager: ["gemini-*"],
  builder: ["qwen/*", "deepseek/*", "anthropic/*", "google/*"],
  reviewer: ["deepseek/*", "anthropic/*", "openai/*", "google/*"],
};

const VALID_PROVIDERS = ["openrouter", "google", "anthropic", "openai"] as const;

/**
 * Validate that a model matches allowed patterns for its role
 */
function validateModelPattern(role: AgentRole, model: string): void {
  const patterns = ALLOWED_MODEL_PATTERNS[role];
  if (!patterns || patterns.length === 0) {
    throw new Error(`[ModelValidation] No allowed patterns defined for role "${role}"`);
  }

  const isValid = patterns.some((pattern) => {
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\//g, "\\/") + "$"
    );
    return regex.test(model);
  });

  if (!isValid) {
    throw new Error(
      `[ModelValidation] Role "${role}" model "${model}" does not match allowed patterns: [${patterns.join(", ")}]`
    );
  }
}

/**
 * Validate provider is supported
 */
function validateProvider(provider: string): void {
  if (!VALID_PROVIDERS.includes(provider as any)) {
    throw new Error(
      `[ProviderValidation] Invalid provider "${provider}". ` +
      `Valid: ${VALID_PROVIDERS.join(", ")}`
    );
  }
}

/**
 * Validate temperature range
 */
function validateTemperature(role: AgentRole, temp: number): void {
  if (temp < 0 || temp > 2) {
    throw new Error(
      `[ConfigValidation] Role "${role}" temperature ${temp} out of range [0, 2]`
    );
  }
}

/**
 * Validate maxTokens
 */
function validateMaxTokens(role: AgentRole, tokens: number): void {
  if (!tokens || tokens <= 0) {
    throw new Error(
      `[ConfigValidation] Role "${role}" has invalid maxTokens: ${tokens}`
    );
  }
}

/**
 * Validate capabilities exist
 */
function validateCapabilities(role: AgentRole, caps: string[]): void {
  if (!caps || caps.length === 0) {
    throw new Error(
      `[ConfigValidation] Role "${role}" has no capabilities defined`
    );
  }
}

/**
 * ═══════════════════════════════════════════
 * FIX #8: Boot-Time Audit
 * ═══════════════════════════════════════════
 */
export interface BootAuditResult {
  ok: boolean;
  checks: Array<{
    name: string;
    status: "pass" | "fail" | "warn";
    message: string;
  }>;
}

export function validateRegistry(registry: AgentRegistry): BootAuditResult {
  const checks: BootAuditResult["checks"] = [];
  const roles: AgentRole[] = ["manager", "builder", "reviewer"];

  console.log("\n═══════════════════════════════════════════");
  console.log("  ⚔️  HADES ARMY v0.2.1 — BOOT AUDIT  ⚔️");
  console.log("═══════════════════════════════════════════\n");

  console.log("[Hades] 🔍 Checking Agent Registry...");

  for (const role of roles) {
    try {
      const config = registry[role];
      if (!config) {
        throw new Error(`Missing config for role "${role}"`);
      }

      // Run all validations
      validateProvider(config.provider);
      validateModelPattern(role, config.model);
      validateTemperature(role, config.temperature);
      validateMaxTokens(role, config.maxTokens);
      validateCapabilities(role, config.capabilities);

      checks.push({
        name: `${role} config`,
        status: "pass",
        message: `${config.provider} / ${config.model}`,
      });
      console.log(`[Hades]   ✅ ${role}: ${config.provider} / ${config.model}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      checks.push({
        name: `${role} config`,
        status: "fail",
        message,
      });
      console.error(`[Hades]   ❌ ${role}: ${message}`);
    }
  }

  const allPass = checks.every((c) => c.status === "pass");
  const anyFail = checks.some((c) => c.status === "fail");

  console.log("\n═══════════════════════════════════════════");
  if (allPass) {
    console.log("  ✅ ALL CHECKS PASSED — HADES IS READY");
  } else if (anyFail) {
    console.log("  ❌ SOME CHECKS FAILED — REVIEW REQUIRED");
  }
  console.log("═══════════════════════════════════════════\n");

  return { ok: !anyFail, checks };
}
