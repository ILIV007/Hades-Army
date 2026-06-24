/**
 * Google AI Studio Provider - Cloudflare Workers Edition
 * Hades Army v0.8.5
 *
 * Free-tier Gemini API access. Primary model: gemini-3-flash.
 * Endpoint: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *
 * This provider is the default for the Manager agent because:
 *   - Fast (low latency)
 *   - Cheap (free tier covers most planning workloads)
 *   - Excellent planning capability
 */

import { logger } from "../../utils/logger";
import type { AIProvider, GenerateRequest, GenerateResponse, ProviderName } from "./types";

export class GoogleAIProvider implements AIProvider {
  readonly name: ProviderName = "google";
  private apiKey: string;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("GoogleAIProvider requires an API key");
    this.apiKey = apiKey;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(req.model)}:generateContent?key=${this.apiKey}`;

    const body: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts: [{ text: req.prompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0.7,
      },
    };

    if (req.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: req.systemPrompt }],
      };
    }

    const start = Date.now();
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`GoogleAI ${response.status}: ${errText}`);
    }

    const data = await response.json() as any;
    const content = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    const usage = data?.usageMetadata ?? {};

    logger.debug(`GoogleAI ${req.model} ok in ${Date.now() - start}ms`, {
      tokensIn: usage.promptTokenCount ?? 0,
      tokensOut: usage.candidatesTokenCount ?? 0,
    });

    return {
      content,
      tokensIn: usage.promptTokenCount ?? 0,
      tokensOut: usage.candidatesTokenCount ?? 0,
      finishReason: data?.candidates?.[0]?.finishReason,
      raw: data,
    };
  }
}
