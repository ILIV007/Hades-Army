/**
 * Hades Army v0.2.1 — LLM Service
 * Unified interface for calling AI providers with full telemetry.
 * Pure ESM.
 */

import type { HadesEnv } from "../config/env";
import type { AgentConfig, AgentRole } from "../types";
import { Logger } from "../utils/logger";
import { D1Client } from "../memory/d1.client";

interface LLMResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  provider: string;
}

export class LLMService {
  private logger: Logger;
  private d1: D1Client;

  constructor(
    private env: HadesEnv,
    private projectId?: string,
    private taskId?: string
  ) {
    this.logger = new Logger(env, projectId, taskId);
    this.d1 = new D1Client(env);
  }

  /**
   * Call the LLM for a given agent configuration.
   * Records telemetry (tokens, cost, duration) to D1.
   */
  async call(
    agentConfig: AgentConfig,
    systemPrompt: string,
    userPrompt: string
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const runId = crypto.randomUUID();

    // Record run start
    await this.d1.createAgentRun({
      id: runId,
      taskId: this.taskId ?? "unknown",
      projectId: this.projectId ?? "unknown",
      agentRole: agentConfig.role,
      model: agentConfig.model,
      provider: agentConfig.provider,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costEstimate: 0,
      startTime: new Date().toISOString(),
      status: "running",
    });

    try {
      let response: LLMResponse;

      if (agentConfig.provider === "openrouter") {
        response = await this.callOpenRouter(agentConfig, systemPrompt, userPrompt);
      } else if (agentConfig.provider === "google") {
        response = await this.callGoogle(agentConfig, systemPrompt, userPrompt);
      } else {
        throw new Error(`Unknown provider: ${agentConfig.provider}`);
      }

      const duration = Date.now() - startTime;
      const cost = this.estimateCost(response.model, response.totalTokens);

      // Update run with success
      await this.d1.updateAgentRun(runId, {
        endTime: new Date().toISOString(),
        durationMs: duration,
        status: "success",
        output: response.content.slice(0, 500),
      });

      // Record model usage
      await this.d1.recordModelUsage({
        provider: response.provider,
        model: response.model,
        tokensUsed: response.totalTokens,
        cost,
        success: true,
        durationMs: duration,
        timestamp: new Date().toISOString(),
      });

      await this.logger.info("agent", `LLM call completed`, {
        model: response.model,
        provider: response.provider,
        tokens: response.totalTokens,
        cost,
        durationMs: duration,
      });

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error.message : String(error);

      // Update run with failure
      await this.d1.updateAgentRun(runId, {
        endTime: new Date().toISOString(),
        durationMs: duration,
        status: "failed",
        error: err,
      });

      // Record failed usage
      await this.d1.recordModelUsage({
        provider: agentConfig.provider,
        model: agentConfig.model,
        tokensUsed: 0,
        cost: 0,
        success: false,
        durationMs: duration,
        timestamp: new Date().toISOString(),
      });

      await this.logger.error("agent", `LLM call failed: ${err}`, {
        model: agentConfig.model,
        provider: agentConfig.provider,
        durationMs: duration,
      });
      throw error;
    }
  }

  // ============================================================
  // OPENROUTER
  // ============================================================

  private async callOpenRouter(
    config: AgentConfig,
    systemPrompt: string,
    userPrompt: string
  ): Promise<LLMResponse> {
    const res = await fetch(`${this.env.OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://hades-army.dev",
        "X-Title": "Hades Army",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenRouter error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model: string;
    };

    return {
      content: data.choices[0].message.content,
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
      model: data.model,
      provider: "openrouter",
    };
  }

  // ============================================================
  // GOOGLE AI STUDIO
  // ============================================================

  private async callGoogle(
    config: AgentConfig,
    systemPrompt: string,
    userPrompt: string
  ): Promise<LLMResponse> {
    if (!this.env.GOOGLE_AI_API_KEY) {
      throw new Error("GOOGLE_AI_API_KEY not configured");
    }

    // FIX: Handle model name correctly for Google AI Studio
    const modelName = config.model.startsWith("gemini")
      ? config.model
      : `models/${config.model}`;

    const res = await fetch(
      `${this.env.GOOGLE_AI_BASE_URL}/models/${modelName}:generateContent?key=${this.env.GOOGLE_AI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
            },
          ],
          generationConfig: {
            temperature: config.temperature,
            maxOutputTokens: config.maxTokens,
          },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google AI error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
      };
    };

    return {
      content: data.candidates[0].content.parts[0].text,
      promptTokens: data.usageMetadata.promptTokenCount,
      completionTokens: data.usageMetadata.candidatesTokenCount,
      totalTokens: data.usageMetadata.totalTokenCount,
      model: config.model,
      provider: "google",
    };
  }

  // ============================================================
  // COST ESTIMATION
  // ============================================================

  private estimateCost(model: string, tokens: number): number {
    const costs: Record<string, number> = {
      "google/gemini-3-flash": 0.00015,
      "gemini-3-flash": 0.00015,
      "qwen/qwen3-coder": 0.0003,
      "deepseek/deepseek-v3.1": 0.0002,
    };

    const per1k = costs[model] ?? 0.0005;
    return (tokens / 1000) * per1k;
  }
}
