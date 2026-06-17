/**
 * Hades Army v0.2 — Agent Registry Configuration
 * Roles are fixed. Models are configurable.
 */

import type { HadesEnv } from "./env";
import type { AgentRole, AgentConfig, AgentRegistry } from "../types";

export function createAgentRegistry(env: HadesEnv): AgentRegistry {
  return {
    manager: {
      role: "manager",
      model: env.DEFAULT_MANAGER_MODEL,
      provider: "openrouter",
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
      model: env.DEFAULT_BUILDER_MODEL,
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
      model: env.DEFAULT_REVIEWER_MODEL,
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

export function getAgentConfig(registry: AgentRegistry, role: AgentRole): AgentConfig {
  const config = registry[role];
  if (!config) {
    throw new Error(`Agent role not found: ${role}`);
  }
  return config;
}

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
