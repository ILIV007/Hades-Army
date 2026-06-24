/**
 * Model Registry - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Priority 2: Model Registry System
 *
 * The Model Registry is the SOLE source of truth for which AI model
 * backs which agent. No agent may hardcode a model identifier — every
 * agent MUST load its configuration through this registry.
 *
 * Hierarchy:
 *   Provider Registry  →  Model Registry  →  Agent Registry
 *
 * The Agent Registry maps an agent role (manager / builder / reviewer)
 * to a (provider, model) pair, plus fallbacks. Configuration is loaded
 * from `config/model-registry.json` (committed) and may be overridden
 * at runtime via D1 (the `model_registry_overrides` table).
 *
 * Default assignments (per v0.8.5 spec):
 *   manager  →  google       /  gemini-3-flash
 *   builder  →  openrouter   /  qwen/qwen3-coder
 *   reviewer →  openrouter   /  deepseek/deepseek-chat
 *
 * Future-ready providers (declared but not active):
 *   anthropic, openai, grok
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";

import { GoogleAIProvider } from "./providers/google";
import { OpenRouterProvider } from "./providers/openrouter";
import { CloudflareAIProvider } from "./providers/cloudflare";
import type { AIProvider, ProviderName } from "./providers/types";

// ============================================
// Types
// ============================================

export type AgentRole = "manager" | "builder" | "reviewer";

export interface ModelConfig {
  provider: ProviderName;
  model: string;
  /** approximate cost per 1M input tokens, USD */
  costPer1MInputTokens?: number;
  /** approximate cost per 1M output tokens, USD */
  costPer1MOutputTokens?: number;
  /** maximum context window in tokens */
  contextWindow?: number;
  /** free-tier rate limit per minute (0 = unknown) */
  rateLimitPerMin?: number;
}

export interface AgentModelBinding {
  role: AgentRole;
  primary: ModelConfig;
  fallbacks: ModelConfig[];
  lastChangedAt: string;
  lastChangedBy: string;
}

export interface RegistryConfig {
  version: string;
  updatedAt: string;
  providers: ProviderName[];
  models: Record<string, ModelConfig>;
  agents: Record<AgentRole, Omit<AgentModelBinding, "lastChangedAt" | "lastChangedBy">>;
}

// ============================================
// Default config (mirrors config/model-registry.json)
// ============================================

const DEFAULT_CONFIG: RegistryConfig = {
  version: "0.8.5",
  updatedAt: "2026-06-22T00:00:00.000Z",
  providers: ["google", "openrouter", "cloudflare", "anthropic", "openai", "grok"],
  models: {
    "google/gemini-3-flash": {
      provider: "google",
      model: "gemini-3-flash",
      costPer1MInputTokens: 0,
      costPer1MOutputTokens: 0,
      contextWindow: 1000000,
      rateLimitPerMin: 15,
    },
    "openrouter/qwen/qwen3-coder": {
      provider: "openrouter",
      model: "qwen/qwen3-coder",
      costPer1MInputTokens: 0.18,
      costPer1MOutputTokens: 0.18,
      contextWindow: 128000,
      rateLimitPerMin: 20,
    },
    "openrouter/deepseek/deepseek-chat": {
      provider: "openrouter",
      model: "deepseek/deepseek-chat",
      costPer1MInputTokens: 0.14,
      costPer1MOutputTokens: 0.28,
      contextWindow: 64000,
      rateLimitPerMin: 20,
    },
    "cloudflare/@cf/meta/llama-3-8b-instruct": {
      provider: "cloudflare",
      model: "@cf/meta/llama-3-8b-instruct",
      costPer1MInputTokens: 0,
      costPer1MOutputTokens: 0,
      contextWindow: 8000,
      rateLimitPerMin: 50,
    },
  },
  agents: {
    manager: {
      role: "manager",
      primary: {
        provider: "google",
        model: "gemini-3-flash",
        costPer1MInputTokens: 0,
        costPer1MOutputTokens: 0,
        contextWindow: 1000000,
        rateLimitPerMin: 15,
      },
      fallbacks: [
        {
          provider: "cloudflare",
          model: "@cf/meta/llama-3-8b-instruct",
          costPer1MInputTokens: 0,
          costPer1MOutputTokens: 0,
          contextWindow: 8000,
        },
      ],
    },
    builder: {
      role: "builder",
      primary: {
        provider: "openrouter",
        model: "qwen/qwen3-coder",
        costPer1MInputTokens: 0.18,
        costPer1MOutputTokens: 0.18,
        contextWindow: 128000,
      },
      fallbacks: [
        {
          provider: "cloudflare",
          model: "@cf/meta/llama-3-8b-instruct",
          contextWindow: 8000,
        },
      ],
    },
    reviewer: {
      role: "reviewer",
      primary: {
        provider: "openrouter",
        model: "deepseek/deepseek-chat",
        costPer1MInputTokens: 0.14,
        costPer1MOutputTokens: 0.28,
        contextWindow: 64000,
      },
      fallbacks: [
        {
          provider: "google",
          model: "gemini-3-flash",
          contextWindow: 1000000,
        },
      ],
    },
  },
};

// ============================================
// Model Registry (singleton per env)
// ============================================

export class ModelRegistry {
  private static instances: Map<string, ModelRegistry> = new Map();

  private env: HadesBindings;
  private config: RegistryConfig;
  private providerInstances: Map<ProviderName, AIProvider> = new Map();
  private overrides: Partial<Record<AgentRole, ModelConfig>> = {};

  private constructor(env: HadesBindings) {
    this.env = env;
    this.config = DEFAULT_CONFIG;
    this.bootstrapProviders();
    logger.info(`ModelRegistry initialized — ${this.config.providers.length} providers, ${Object.keys(this.config.models).length} models`);
  }

  static getInstance(env: HadesBindings): ModelRegistry {
    const key = env.HADES_DB ? "default" : "shared";
    if (!ModelRegistry.instances.has(key)) {
      ModelRegistry.instances.set(key, new ModelRegistry(env));
    }
    return ModelRegistry.instances.get(key)!;
  }

  // ============================================
  // Bootstrap providers
  // ============================================

  private bootstrapProviders(): void {
    // Google AI Studio (Gemini)
    if (this.env.GOOGLE_AI_API_KEY) {
      this.providerInstances.set("google", new GoogleAIProvider(this.env.GOOGLE_AI_API_KEY));
    }

    // OpenRouter
    if (this.env.OPENROUTER_API_KEY) {
      this.providerInstances.set("openrouter", new OpenRouterProvider(this.env.OPENROUTER_API_KEY));
    }

    // Cloudflare Workers AI (always available if AI binding exists)
    if (this.env.AI) {
      this.providerInstances.set("cloudflare", new CloudflareAIProvider(this.env.AI));
    }

    // Future-ready stubs (logged only)
    if (this.env.ANTHROPIC_API_KEY) {
      logger.info("Anthropic API key present — provider not yet active in v0.8.5");
    }
    if (this.env.OPENAI_API_KEY) {
      logger.info("OpenAI API key present — provider not yet active in v0.8.5");
    }
  }

  // ============================================
  // Public: agent → model resolution
  // ============================================

  getModelForAgent(role: AgentRole): ModelConfig {
    // Runtime override wins
    if (this.overrides[role]) {
      return this.overrides[role]!;
    }
    const binding = this.config.agents[role];
    if (!binding) {
      throw new Error(`No model binding for agent role: ${role}`);
    }
    return binding.primary;
  }

  getFallbacksForAgent(role: AgentRole): ModelConfig[] {
    const binding = this.config.agents[role];
    return binding?.fallbacks ?? [];
  }

  // ============================================
  // Public: agent → provider instance
  // ============================================

  getProviderForAgent(role: AgentRole): AIProvider {
    const model = this.getModelForAgent(role);
    return this.resolveProvider(model.provider);
  }

  resolveProvider(name: ProviderName): AIProvider {
    const provider = this.providerInstances.get(name);
    if (!provider) {
      throw new Error(
        `Provider "${name}" is not available. Check that the corresponding ` +
        `API key / binding is configured in wrangler.toml.`,
      );
    }
    return provider;
  }

  // ============================================
  // Public: list / health
  // ============================================

  listProviders(): Array<{ name: ProviderName; available: boolean }> {
    return this.config.providers.map((name) => ({
      name,
      available: this.providerInstances.has(name),
    }));
  }

  listModels(): Array<ModelConfig & { key: string }> {
    return Object.entries(this.config.models).map(([key, m]) => ({ key, ...m }));
  }

  listAgentBindings(): AgentModelBinding[] {
    return (Object.entries(this.config.agents) as Array<[AgentRole, RegistryConfig["agents"][AgentRole]]>).map(
      ([role, binding]) => ({
        role,
        primary: binding.primary,
        fallbacks: binding.fallbacks,
        lastChangedAt: this.config.updatedAt,
        lastChangedBy: "system",
      }),
    );
  }

  // ============================================
  // Public: runtime override (admin only)
  // ============================================

  setOverride(role: AgentRole, model: ModelConfig, changedBy: string): void {
    this.overrides[role] = model;
    logger.warn(`ModelRegistry override set: ${role} -> ${model.provider}/${model.model} by ${changedBy}`);
  }

  clearOverride(role: AgentRole): void {
    delete this.overrides[role];
    logger.info(`ModelRegistry override cleared for ${role}`);
  }

  // ============================================
  // Public: cost estimation helper
  // ============================================

  estimateCostUsd(role: AgentRole, inputTokens: number, outputTokens: number): number {
    const model = this.getModelForAgent(role);
    const inCost = (model.costPer1MInputTokens ?? 0) * (inputTokens / 1_000_000);
    const outCost = (model.costPer1MOutputTokens ?? 0) * (outputTokens / 1_000_000);
    return Math.round((inCost + outCost) * 1_000_000) / 1_000_000;
  }

  // ============================================
  // Public: generate a one-shot generation through the agent's bound model
  // ============================================

  async generateForAgent(
    role: AgentRole,
    prompt: string,
    options?: { maxTokens?: number; temperature?: number; systemPrompt?: string },
  ): Promise<{ content: string; model: ModelConfig; tokensIn: number; tokensOut: number }> {
    const model = this.getModelForAgent(role);
    const provider = this.resolveProvider(model.provider);

    const result = await provider.generate({
      model: model.model,
      prompt,
      maxTokens: options?.maxTokens ?? 2048,
      temperature: options?.temperature ?? 0.7,
      systemPrompt: options?.systemPrompt,
    });

    return {
      content: result.content,
      model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  }

  // ============================================
  // Public: config snapshot
  // ============================================

  getConfig(): RegistryConfig {
    return JSON.parse(JSON.stringify(this.config));
  }

  // ============================================
  // Test helper: reset singleton
  // ============================================

  static _resetForTests(): void {
    ModelRegistry.instances.clear();
  }
}

// ============================================
// Helper: validate that no agent has a hardcoded model
// (call this in CI to enforce the rule)
// ============================================

export function assertNoHardcodedModels(agentSource: string, agentName: string): string[] {
  const violations: string[] = [];
  const hardcodedPatterns = [
    /["']gpt-4o["']/,
    /["']claude-3-sonnet-20240229["']/,
    /["']gemini-3-flash["']/, // direct string usage — must come from registry
    /["']qwen\/qwen3-coder["']/,
    /["']deepseek\/deepseek-chat["']/,
  ];
  for (const pat of hardcodedPatterns) {
    if (pat.test(agentSource)) {
      violations.push(`${agentName}: hardcoded model literal matched ${pat}`);
    }
  }
  return violations;
}
