/**
 * AI Provider Factory - Cloudflare Workers Edition
 * Hades Army v0.8.0
 * Fallback chain: OpenAI → Anthropic → Google → Workers AI
 */

import { logger } from "../utils/logger";

export interface AIProvider {
  name: string;
  generate(prompt: string, options?: Record<string, unknown>): Promise<string>;
  isAvailable(): boolean;
}

export class OpenAIProvider implements AIProvider {
  name = "openai";
  constructor(private apiKey: string) {}

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async generate(prompt: string, options?: Record<string, unknown>): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        // v0.9.1: hardcoded model defaults removed.
        // Callers MUST pass options.model — the Model Registry is the
        // single source of truth for model selection.
        model: options?.model || (() => { throw new Error("OpenAIProvider: options.model is required (use ModelRegistry)"); })(),
        messages: [{ role: "user", content: prompt }],
        max_tokens: options?.maxTokens || 2000,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI error: ${response.status}`);
    const data = await response.json();
    return data.choices[0].message.content;
  }
}

export class AnthropicProvider implements AIProvider {
  name = "anthropic";
  constructor(private apiKey: string) {}

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async generate(prompt: string, options?: Record<string, unknown>): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // v0.9.1: hardcoded model defaults removed.
        model: options?.model || (() => { throw new Error("AnthropicProvider: options.model is required (use ModelRegistry)"); })(),
        max_tokens: options?.maxTokens || 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) throw new Error(`Anthropic error: ${response.status}`);
    const data = await response.json();
    return data.content[0].text;
  }
}

export class WorkersAIProvider implements AIProvider {
  name = "workers-ai";
  constructor(private ai: Ai) {}

  isAvailable(): boolean {
    return !!this.ai;
  }

  async generate(prompt: string, options?: Record<string, unknown>): Promise<string> {
    const result = await this.ai.run("@cf/meta/llama-3-8b-instruct", {
      prompt,
      max_tokens: options?.maxTokens || 2000,
    });
    return (result as any).response || String(result);
  }
}

export class AIFactory {
  private providers: AIProvider[] = [];

  constructor(env: Record<string, unknown>) {
    if (env.OPENAI_API_KEY) this.providers.push(new OpenAIProvider(env.OPENAI_API_KEY as string));
    if (env.ANTHROPIC_API_KEY) this.providers.push(new AnthropicProvider(env.ANTHROPIC_API_KEY as string));
    if (env.AI) this.providers.push(new WorkersAIProvider(env.AI as Ai));
  }

  async generate(prompt: string, options?: Record<string, unknown>): Promise<string> {
    for (const provider of this.providers) {
      if (provider.isAvailable()) {
        try {
          logger.info(`Using AI provider: ${provider.name}`);
          return await provider.generate(prompt, options);
        } catch (err) {
          logger.warn(`AI provider ${provider.name} failed`, { error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    throw new Error("No AI provider available");
  }

  getAvailableProviders(): string[] {
    return this.providers.filter((p) => p.isAvailable()).map((p) => p.name);
  }
}

export const aiFactory = { AIFactory };
