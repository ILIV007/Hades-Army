/**
 * Cloudflare Workers AI Provider - Cloudflare Workers Edition
 * Hades Army v0.8.5
 *
 * Uses the native `AI` binding available on Cloudflare Workers.
 * Free-tier, no API key required (binding-based auth).
 *
 * Used as:
 *   - Primary for low-context tasks (small repo scans, summaries)
 *   - Fallback when external providers (Google / OpenRouter) are unavailable
 *
 * Default model: @cf/meta/llama-3-8b-instruct
 */

import { logger } from "../../utils/logger";
import type { AIProvider, GenerateRequest, GenerateResponse, ProviderName } from "./types";

export class CloudflareAIProvider implements AIProvider {
  readonly name: ProviderName = "cloudflare";
  private ai: Ai;

  constructor(ai: Ai) {
    if (!ai) throw new Error("CloudflareAIProvider requires an Ai binding");
    this.ai = ai;
  }

  isAvailable(): boolean {
    return !!this.ai;
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const start = Date.now();

    // Cloudflare Workers AI supports both `run()` (raw) and the OpenAI-compatible
    // `/chat/completions` interface. We use the OpenAI-compatible form so the
    // systemPrompt parameter is honored.
    const result = await this.ai.run(req.model as any, {
      messages: [
        ...(req.systemPrompt ? [{ role: "system", content: req.systemPrompt }] : []),
        { role: "user", content: req.prompt },
      ],
      max_tokens: req.maxTokens ?? 2048,
      temperature: req.temperature ?? 0.7,
    } as any);

    const data = result as any;
    const content = data?.response ?? data?.choices?.[0]?.message?.content ?? String(result);

    logger.debug(`CloudflareAI ${req.model} ok in ${Date.now() - start}ms`);

    // Cloudflare Workers AI does not always return usage; estimate from content length
    const tokensIn = Math.ceil((req.systemPrompt?.length ?? 0 + req.prompt.length) / 4);
    const tokensOut = Math.ceil(content.length / 4);

    return {
      content,
      tokensIn,
      tokensOut,
      raw: data,
    };
  }
}
