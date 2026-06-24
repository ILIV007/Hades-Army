/**
 * OpenRouter Provider - Cloudflare Workers Edition
 * Hades Army v0.8.5
 *
 * OpenRouter is a unified gateway to many model providers.
 * Primary use in Hades Army:
 *   - Builder  →  qwen/qwen3-coder
 *   - Reviewer →  deepseek/deepseek-chat
 *
 * Endpoint: https://openrouter.ai/api/v1/chat/completions
 *
 * Free-tier models are available; paid models require credits.
 * The X-Title header identifies this app to OpenRouter for
 * analytics and rate-limit accounting.
 */

import { logger } from "../../utils/logger";
import type { AIProvider, GenerateRequest, GenerateResponse, ProviderName } from "./types";

export class OpenRouterProvider implements AIProvider {
  readonly name: ProviderName = "openrouter";
  private apiKey: string;
  private baseUrl = "https://openrouter.ai/api/v1";
  private referer = "https://hades-army.workers.dev";
  private title = "Hades Army";

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("OpenRouterProvider requires an API key");
    this.apiKey = apiKey;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];
    if (req.systemPrompt) {
      messages.push({ role: "system", content: req.systemPrompt });
    }
    messages.push({ role: "user", content: req.prompt });

    const body = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens ?? 2048,
      temperature: req.temperature ?? 0.7,
    };

    const start = Date.now();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": this.referer,
        "X-Title": this.title,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${errText}`);
    }

    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content ?? "";
    const usage = data?.usage ?? {};

    logger.debug(`OpenRouter ${req.model} ok in ${Date.now() - start}ms`, {
      tokensIn: usage.prompt_tokens ?? 0,
      tokensOut: usage.completion_tokens ?? 0,
    });

    return {
      content,
      tokensIn: usage.prompt_tokens ?? 0,
      tokensOut: usage.completion_tokens ?? 0,
      finishReason: data?.choices?.[0]?.finish_reason,
      raw: data,
    };
  }
}
