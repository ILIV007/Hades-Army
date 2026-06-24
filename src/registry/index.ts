/**
 * Registry Module - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Public API for the Model Registry system.
 *
 * Usage:
 *   import { ModelRegistry } from "./registry";
 *   const registry = ModelRegistry.getInstance(env);
 *   const managerModel = registry.getModelForAgent("manager");
 *   // → { provider: "google", model: "gemini-3-flash", ... }
 */

export { ModelRegistry, assertNoHardcodedModels } from "./model-registry";
export type { AgentRole, ModelConfig, AgentModelBinding, RegistryConfig } from "./model-registry";

export { GoogleAIProvider } from "./providers/google";
export { OpenRouterProvider } from "./providers/openrouter";
export { CloudflareAIProvider } from "./providers/cloudflare";
export type { AIProvider, GenerateRequest, GenerateResponse, ProviderName } from "./providers/types";
