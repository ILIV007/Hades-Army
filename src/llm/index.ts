/**
 * Hades Army v0.6 - LLM Provider
 * Multi-provider LLM integration with monitoring and failover
 */

import type { Message, LLMRequest, LLMResponse, LLMProvider as LLMProviderConfig } from '../core/types';
import { CONFIG } from '../core/config';
import { LLMError, ProviderError } from '../core/errors';
import { updateProviderHealth, getProviderHealth, type DBContext } from '../db';

interface LLMContext {
  apiKey: string;
  provider: string;
  model: string;
  db?: DBContext;
}

// ============================================================================
// PROVIDER MONITORING (Section 11)
// ============================================================================

async function recordProviderSuccess(ctx: LLMContext, latencyMs: number): Promise<void> {
  if (!ctx.db) return;
  await updateProviderHealth(ctx.db, {
    providerName: ctx.provider,
    status: 'healthy',
    latencyMs,
    errorRate: 0,
    consecutiveFailures: 0,
    lastCheck: new Date().toISOString(),
  });
}

async function recordProviderFailure(ctx: LLMContext, error: string): Promise<void> {
  if (!ctx.db) return;

  const currentHealth = await getProviderHealth(ctx.db, ctx.provider);
  const health = currentHealth[0];
  const consecutiveFailures = (health?.consecutiveFailures || 0) + 1;

  await updateProviderHealth(ctx.db, {
    providerName: ctx.provider,
    status: consecutiveFailures >= 3 ? 'down' : 'degraded',
    latencyMs: health?.latencyMs,
    errorRate: Math.min(1, (health?.errorRate || 0) + 0.1),
    consecutiveFailures,
    lastError: error,
    lastCheck: new Date().toISOString(),
  });
}

// ============================================================================
// OPENROUTER PROVIDER
// ============================================================================

async function callOpenRouter(ctx: LLMContext, request: LLMRequest): Promise<LLMResponse> {
  const startTime = Date.now();
  const provider = CONFIG.LLM_PROVIDERS.openrouter;

  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ctx.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hades-army.dev',
        'X-Title': 'Hades Army v0.6',
      },
      body: JSON.stringify({
        model: request.model || provider.defaultModel,
        messages: request.messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: request.temperature ?? provider.temperature,
        max_tokens: request.maxTokens ?? 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ProviderError('openrouter', `HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;
    await recordProviderSuccess(ctx, latencyMs);

    return {
      content: data.choices[0]?.message?.content || '',
      model: data.model || request.model || provider.defaultModel,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      finishReason: data.choices[0]?.finish_reason || 'unknown',
    };
  } catch (error) {
    await recordProviderFailure(ctx, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

// ============================================================================
// GOOGLE AI STUDIO PROVIDER
// ============================================================================

async function callGoogleAI(ctx: LLMContext, request: LLMRequest): Promise<LLMResponse> {
  const startTime = Date.now();
  const provider = CONFIG.LLM_PROVIDERS.google;
  const model = request.model || provider.defaultModel;

  try {
    const response = await fetch(
      `${provider.baseUrl}/models/${model}:generateContent?key=${ctx.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: request.messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : m.role,
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            temperature: request.temperature ?? provider.temperature,
            maxOutputTokens: request.maxTokens ?? 4096,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new ProviderError('google', `HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;
    await recordProviderSuccess(ctx, latencyMs);

    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      model,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
      finishReason: data.candidates?.[0]?.finishReason || 'unknown',
    };
  } catch (error) {
    await recordProviderFailure(ctx, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

// ============================================================================
// MAIN LLM INTERFACE
// ============================================================================

export async function callLLM(
  request: LLMRequest,
  env: { OPENROUTER_API_KEY?: string; GOOGLE_AI_API_KEY?: string; DB?: D1Database; KV_CACHE?: KVNamespace; KV_PROJECTS?: KVNamespace; KV_SESSIONS?: KVNamespace },
  preferredProvider?: string
): Promise<LLMResponse> {
  const providers: Array<{ name: string; apiKey?: string; fn: (ctx: LLMContext, req: LLMRequest) => Promise<LLMResponse> }> = [
    { name: 'openrouter', apiKey: env.OPENROUTER_API_KEY, fn: callOpenRouter },
    { name: 'google', apiKey: env.GOOGLE_AI_API_KEY, fn: callGoogleAI },
  ];

  // Prioritize preferred provider
  if (preferredProvider) {
    const preferred = providers.find(p => p.name === preferredProvider);
    if (preferred) {
      providers.splice(providers.indexOf(preferred), 1);
      providers.unshift(preferred);
    }
  }

  const db: DBContext | undefined = env.DB && env.KV_CACHE && env.KV_PROJECTS ? {
    db: env.DB,
    kvCache: env.KV_CACHE,
    kvProjects: env.KV_PROJECTS,
  } : undefined;

  const errors: string[] = [];

  for (const provider of providers) {
    if (!provider.apiKey) {
      errors.push(`${provider.name}: No API key configured`);
      continue;
    }

    const ctx: LLMContext = {
      apiKey: provider.apiKey,
      provider: provider.name,
      model: request.model || CONFIG.LLM_PROVIDERS[provider.name as keyof typeof CONFIG.LLM_PROVIDERS]?.defaultModel || '',
      db,
    };

    try {
      return await provider.fn(ctx, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider.name}: ${message}`);

      // If this is a rate limit, try next immediately
      if (message.includes('429') || message.includes('rate limit')) {
        continue;
      }

      // For other errors, also try next provider (failover)
      continue;
    }
  }

  throw new LLMError('all', `All LLM providers failed: ${errors.join('; ')}`);
}

// ============================================================================
// MANAGER PROMPT BUILDER (Technical Architect)
// ============================================================================

export function buildManagerSystemPrompt(context: {
  projectName: string;
  repositoryInfo?: string;
  architectureMap?: string;
  failures?: string[];
  adrs?: string[];
}): string {
  return `You are the Technical Architect of Hades Army v0.6 — an elite AI Software Engineering Team.

## Your Role
You are NOT just a project manager. You are a Technical Architect who:
- Analyzes repository architecture deeply
- Understands dependency graphs and critical paths
- Detects hotspots and technical debt
- Performs change impact analysis before assigning tasks
- Learns from past failures
- Makes architectural decisions backed by ADRs

## Current Project: ${context.projectName}

${context.repositoryInfo ? `## Repository Intelligence\n${context.repositoryInfo}\n` : ''}
${context.architectureMap ? `## Architecture Map\n${context.architectureMap}\n` : ''}
${context.failures && context.failures.length > 0 ? `## Past Failures (LEARN FROM THESE)\n${context.failures.join('\n')}\n` : ''}
${context.adrs && context.adrs.length > 0 ? `## Architecture Decisions\n${context.adrs.join('\n')}\n` : ''}

## Rules
1. NEVER blindly assign tasks to Builder without analysis
2. ALWAYS perform dependency and risk analysis first
3. CONSIDER past failures when planning
4. RESPECT architecture decisions (ADRs)
5. DETECT and report architecture drift
6. PRIORITIZE critical modules and hotspots
7. ASSESS technical debt impact on every change

## Output Format
When planning tasks, provide:
- Architecture Analysis
- Dependency Impact
- Risk Assessment
- Files to Modify (with justification)
- Technical Debt Considerations
- Failure Prevention Notes`;
}

export function buildBuilderSystemPrompt(context: {
  task: string;
  files: string[];
  dependencies?: string;
  architectureGuidelines?: string;
}): string {
  return `You are the Builder Agent of Hades Army v0.6.

## Your Task
${context.task}

## Files to Modify
${context.files.join('\n')}

${context.dependencies ? `## Dependency Context\n${context.dependencies}\n` : ''}
${context.architectureGuidelines ? `## Architecture Guidelines\n${context.architectureGuidelines}\n` : ''}

## Rules
1. Write clean, well-documented code
2. Follow existing patterns in the codebase
3. Respect architecture boundaries
4. Add tests when applicable
5. Never introduce circular dependencies
6. Consider performance implications
7. Match the existing code style

## Output Format
Provide the complete modified files with clear diff markers showing what changed.`;
}

export function buildReviewerSystemPrompt(context: {
  task: string;
  diff: string;
  files: string[];
  architectureRules?: string;
}): string {
  return `You are the Reviewer Agent of Hades Army v0.6.

## Task Being Reviewed
${context.task}

## Files Changed
${context.files.join('\n')}

## Diff
${context.diff}

${context.architectureRules ? `## Architecture Rules\n${context.architectureRules}\n` : ''}

## Review Criteria
1. Code correctness and logic
2. Architecture compliance
3. Security considerations
4. Performance impact
5. Test coverage
6. Documentation quality
7. No breaking changes (unless intended)

## Output Format
- APPROVE or REJECT
- Score (0-100)
- Detailed feedback
- Specific issues found
- Suggestions for improvement`;
}
