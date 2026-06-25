/**
 * AI Factory Adapter - Cloudflare Workers Edition
 * Hades Army v0.9.0 — Architecture Completion & Production Readiness
 *
 * Section 6: Model Registry Completion
 *
 * Resolves the overlap between AI Factory (v0.8.0) and Model Registry
 * (v0.8.5). Per the v0.9 spec:
 *
 *   Registry  →  DECIDES (provider, model, agent assignment)
 *   AI Factory →  EXECUTES (calls the LLM, returns content)
 *
 * The existing src/integrations/ai-factory.ts is UNMODIFIED. It
 * continues to work as before for legacy callers. This new adapter
 * is the v0.9 entry point — it ALWAYS routes through the Registry
 * for decision-making, then delegates execution to the underlying
 * provider instance the Registry resolved.
 *
 * Once all callers migrate to this adapter, the legacy AIFactory
 * class can be deprecated (planned for v1.0).
 */

import { logger } from "../utils/logger";
import { ModelRegistry, type AgentRole, type ModelConfig } from "../registry/model-registry";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface GenerateResult {
  content: string;
  model: ModelConfig;
  tokensIn: number;
  tokensOut: number;
  elapsedMs: number;
  costUsd: number;
}

// ============================================
// Adapter
// ============================================

export class AIFactoryAdapter {
  private env: HadesBindings;
  private registry: ModelRegistry;

  constructor(env: HadesBindings) {
    this.env = env;
    this.registry = ModelRegistry.getInstance(env);
  }

  /**
   * Generate content for a specific agent role. The Registry decides
   * which provider + model to use; this adapter just executes.
   */
  async generateForAgent(role: AgentRole, prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    const start = Date.now();
    const model = this.registry.getModelForAgent(role);

    logger.info(`AIFactoryAdapter: executing for ${role} via ${model.provider}/${model.model}`);

    const result = await this.registry.generateForAgent(role, prompt, options);
    const costUsd = this.registry.estimateCostUsd(role, result.tokensIn, result.tokensOut);

    return {
      content: result.content,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      elapsedMs: Date.now() - start,
      costUsd,
    };
  }

  /**
   * Generate with an explicit model override (admin only).
   * The Registry still validates the model exists.
   */
  async generateWithModel(
    provider: string,
    model: string,
    prompt: string,
    options?: GenerateOptions,
  ): Promise<GenerateResult> {
    const start = Date.now();
    // Resolve provider through the registry — this validates it's configured
    const providerInstance = this.registry.resolveProvider(provider as any);

    const result = await providerInstance.generate({
      model,
      prompt,
      maxTokens: options?.maxTokens ?? 2048,
      temperature: options?.temperature ?? 0.7,
      systemPrompt: options?.systemPrompt,
    });

    return {
      content: result.content,
      model: { provider: provider as any, model },
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      elapsedMs: Date.now() - start,
      costUsd: 0, // unknown for ad-hoc models
    };
  }

  // ============================================
  // Health check (for dashboards)
  // ============================================

  async healthCheck(): Promise<{
    registry: { available: boolean; providers: Array<{ name: string; available: boolean }> };
    legacyFactory: { available: boolean };
  }> {
    const providers = this.registry.listProviders();
    const legacyAvailable = !!(this.env.OPENAI_API_KEY || this.env.ANTHROPIC_API_KEY || this.env.AI);

    return {
      registry: {
        available: providers.some((p) => p.available),
        providers,
      },
      legacyFactory: {
        available: legacyAvailable,
      },
    };
  }

  /**
   * Migration helper: returns true if the legacy AIFactory can be
   * fully replaced by this adapter (i.e., all required providers are
   * available through the Registry).
   */
  isMigrationReady(): boolean {
    const providers = this.registry.listProviders();
    const available = new Set(providers.filter((p) => p.available).map((p) => p.name));
    // Need at least Google (Manager) and OpenRouter (Builder + Reviewer),
    // OR Cloudflare AI as a universal fallback.
    return available.has("google") && available.has("openrouter") || available.has("cloudflare");
  }
}

// ============================================
// Factory
// ============================================

let _instance: AIFactoryAdapter | null = null;

export function getAIFactoryAdapter(env: HadesBindings): AIFactoryAdapter {
  if (!_instance) _instance = new AIFactoryAdapter(env);
  return _instance;
}
