/**
 * AI Provider common types - Cloudflare Workers Edition
 * Hades Army v0.8.5
 */

export type ProviderName =
  | "google"
  | "openrouter"
  | "cloudflare"
  | "anthropic"
  | "openai"
  | "grok";

export interface GenerateRequest {
  model: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface GenerateResponse {
  content: string;
  tokensIn: number;
  tokensOut: number;
  finishReason?: string;
  raw?: unknown;
}

export interface AIProvider {
  readonly name: ProviderName;
  isAvailable(): boolean;
  generate(req: GenerateRequest): Promise<GenerateResponse>;
}
