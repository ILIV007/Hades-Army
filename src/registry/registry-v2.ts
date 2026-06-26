/**
 * Model Registry v2 - Cloudflare Workers Edition
 * Hades Army v9.3 — Registry Upgrade
 *
 * Priority 13: Registry Upgrade
 *
 * Extends the v0.8.5 ModelRegistry with full per-agent configuration:
 *   - provider, model
 *   - temperature
 *   - top_p
 *   - max_tokens
 *   - timeout (ms)
 *   - retry (count)
 *   - budget (USD per call)
 *   - priority (for fallback ordering)
 *   - fallback_provider, fallback_model
 *   - capability_tags (e.g. "code", "planning", "review", "vision")
 *
 * Agents NEVER hardcode models. Everything comes from the Registry.
 *
 * This module is ADDITIVE — it does not modify the existing
 * src/registry/model-registry.ts. The v0.8.5 registry continues to
 * work for backward compatibility. The v2 registry adds richer
 * configuration on top.
 */

import { logger } from "../utils/logger";
import { ModelRegistry, type AgentRole } from "./model-registry";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export interface AgentModelConfigV2 {
  role: AgentRole;
  provider: string;
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
  budgetUsdPerCall: number;
  priority: number; // lower = higher priority
  fallbackProvider?: string;
  fallbackModel?: string;
  capabilityTags: string[];
}

// ============================================
// Default per-agent configuration (v9.3)
// ============================================

export const DEFAULT_AGENT_CONFIGS_V2: Record<AgentRole, AgentModelConfigV2> = {
  manager: {
    role: "manager",
    provider: "google",
    model: "gemini-3-flash",
    temperature: 0.3,        // slightly creative for planning
    topP: 0.9,
    maxTokens: 2048,
    timeoutMs: 30_000,
    retryCount: 2,
    retryBackoffMs: 500,
    budgetUsdPerCall: 0.01,  // Gemini free tier — effectively 0
    priority: 1,
    fallbackProvider: "cloudflare",
    fallbackModel: "@cf/meta/llama-3.1-70b-instruct",
    capabilityTags: ["planning", "reasoning", "summary", "decision"],
  },
  builder: {
    role: "builder",
    provider: "openrouter",
    model: "qwen/qwen3-coder",
    temperature: 0.2,        // precise for code
    topP: 0.95,
    maxTokens: 4096,
    timeoutMs: 60_000,
    retryCount: 3,
    retryBackoffMs: 800,
    budgetUsdPerCall: 0.05,
    priority: 1,
    fallbackProvider: "cloudflare",
    fallbackModel: "@cf/meta/llama-3.1-70b-instruct",
    capabilityTags: ["code", "patch", "refactor", "debug"],
  },
  reviewer: {
    role: "reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-chat",
    temperature: 0.1,        // conservative for review
    topP: 0.85,
    maxTokens: 2048,
    timeoutMs: 45_000,
    retryCount: 3,
    retryBackoffMs: 600,
    budgetUsdPerCall: 0.03,
    priority: 1,
    fallbackProvider: "google",
    fallbackModel: "gemini-3-flash",
    capabilityTags: ["review", "security", "architecture", "validation"],
  },
};

// ============================================
// Registry v2
// ============================================

export class ModelRegistryV2 {
  private v1Registry: ModelRegistry;
  private configs: Record<AgentRole, AgentModelConfigV2>;
  private overrides: Partial<Record<AgentRole, Partial<AgentModelConfigV2>>> = {};

  constructor(env: HadesBindings) {
    this.v1Registry = ModelRegistry.getInstance(env);
    this.configs = { ...DEFAULT_AGENT_CONFIGS_V2 };
    logger.info("ModelRegistryV2 initialized", {
      agents: Object.keys(this.configs).length,
    });
  }

  /**
   * Get the full v2 configuration for an agent.
   * Merges defaults with any runtime overrides.
   */
  getConfig(role: AgentRole): AgentModelConfigV2 {
    const base = this.configs[role];
    const override = this.overrides[role];
    return override ? { ...base, ...override } : base;
  }

  /**
   * Get just the model + provider (delegates to v1 for resolution).
   * Use this when you only need to know which model to call.
   */
  getModelForAgent(role: AgentRole): { provider: string; model: string } {
    const v1Model = this.v1Registry.getModelForAgent(role);
    return { provider: v1Model.provider, model: v1Model.model };
  }

  /**
   * Get generation parameters for an agent (temperature, top_p, max_tokens).
   */
  getGenerationParams(role: AgentRole): {
    temperature: number;
    topP: number;
    maxTokens: number;
  } {
    const config = this.getConfig(role);
    return {
      temperature: config.temperature,
      topP: config.topP,
      maxTokens: config.maxTokens,
    };
  }

  /**
   * Get execution parameters (timeout, retry, budget).
   */
  getExecutionParams(role: AgentRole): {
    timeoutMs: number;
    retryCount: number;
    retryBackoffMs: number;
    budgetUsdPerCall: number;
  } {
    const config = this.getConfig(role);
    return {
      timeoutMs: config.timeoutMs,
      retryCount: config.retryCount,
      retryBackoffMs: config.retryBackoffMs,
      budgetUsdPerCall: config.budgetUsdPerCall,
    };
  }

  /**
   * Get fallback configuration.
   */
  getFallback(role: AgentRole): { provider: string; model: string } | undefined {
    const config = this.getConfig(role);
    if (!config.fallbackProvider || !config.fallbackModel) return undefined;
    return { provider: config.fallbackProvider, model: config.fallbackModel };
  }

  /**
   * Check if an agent has a specific capability.
   */
  hasCapability(role: AgentRole, tag: string): boolean {
    return this.getConfig(role).capabilityTags.includes(tag);
  }

  /**
   * Find agents that have a specific capability.
   */
  findAgentsByCapability(tag: string): AgentRole[] {
    return (Object.keys(this.configs) as AgentRole[]).filter((role) =>
      this.hasCapability(role, tag),
    );
  }

  /**
   * Set a runtime override (admin only).
   */
  setOverride(role: AgentRole, override: Partial<AgentModelConfigV2>, changedBy: string): void {
    this.overrides[role] = { ...this.overrides[role], ...override };
    logger.warn(`ModelRegistryV2 override set: ${role}`, {
      override: Object.keys(override),
      changedBy,
    });
  }

  /**
   * Clear overrides for an agent.
   */
  clearOverride(role: AgentRole): void {
    delete this.overrides[role];
  }

  /**
   * List all configurations (for admin dashboard).
   */
  listConfigs(): AgentModelConfigV2[] {
    return (Object.keys(this.configs) as AgentRole[]).map((role) => this.getConfig(role));
  }

  /**
   * Render for Telegram / admin.
   */
  render(): string {
    const lines: string[] = [`🤖 *Model Registry v2*`, ``];
    for (const role of ["manager", "builder", "reviewer"] as AgentRole[]) {
      const c = this.getConfig(role);
      lines.push(`*${role.toUpperCase()}*`);
      lines.push(`  ${c.provider}/${c.model}`);
      lines.push(`  🌡 temp=${c.temperature} · topP=${c.topP} · maxTokens=${c.maxTokens}`);
      lines.push(`  ⏱ timeout=${c.timeoutMs}ms · retry=${c.retryCount} · budget=$${c.budgetUsdPerCall}`);
      if (c.fallbackProvider) {
        lines.push(`  ↩ fallback: ${c.fallbackProvider}/${c.fallbackModel}`);
      }
      lines.push(`  🏷 capabilities: ${c.capabilityTags.join(", ")}`);
      lines.push(``);
    }
    return lines.join("\n");
  }
}

// ============================================
// Factory
// ============================================

let _instance: ModelRegistryV2 | null = null;

export function getModelRegistryV2(env: HadesBindings): ModelRegistryV2 {
  if (!_instance) _instance = new ModelRegistryV2(env);
  return _instance;
}
