/**
 * Hades Army — LLM Service
 * Unified interface for calling AI providers (OpenRouter, Google AI Studio).
 */

import type { HadesEnv } from '../config/env';
import type { AgentConfig, AgentRole } from '../types';
import { Logger } from '../utils/logger';

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

  constructor(
    private env: HadesEnv,
    private projectId?: string,
    private taskId?: string
  ) {
    this.logger = new Logger(env, projectId, taskId);
  }

  /**
   * Call the LLM for a given agent configuration.
   */
  async call(
    agentConfig: AgentConfig,
    systemPrompt: string,
    userPrompt: string
  ): Promise<LLMResponse> {
    const startTime = Date.now();

    try {
      let response: LLMResponse;

      if (agentConfig.provider === 'openrouter') {
        response = await this.callOpenRouter(agentConfig, systemPrompt, userPrompt);
      } else if (agentConfig.provider === 'google') {
        response = await this.callGoogle(agentConfig, systemPrompt, userPrompt);
      } else {
        throw new Error(`Unknown provider: ${agentConfig.provider}`);
      }

      const duration = Date.now() - startTime;

      await this.logger.info('agent', `LLM call completed`, {
        model: response.model,
        provider: response.provider,
        tokens: response.totalTokens,
        durationMs: duration,
      });

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logger.error('agent', `LLM call failed: ${error}`, {
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
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hades-army.dev',
        'X-Title': 'Hades Army',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenRouter error ${res.status}: ${errText}`);
    }

    const data = await res.json() as {
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
      provider: 'openrouter',
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
      throw new Error('GOOGLE_AI_API_KEY not configured');
    }

    const res = await fetch(
      `${this.env.GOOGLE_AI_BASE_URL}/models/${config.model}:generateContent?key=${this.env.GOOGLE_AI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: `${systemPrompt}

${userPrompt}` },
              ],
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

    const data = await res.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
    };

    return {
      content: data.candidates[0].content.parts[0].text,
      promptTokens: data.usageMetadata.promptTokenCount,
      completionTokens: data.usageMetadata.candidatesTokenCount,
      totalTokens: data.usageMetadata.totalTokenCount,
      model: config.model,
      provider: 'google',
    };
  }
}
