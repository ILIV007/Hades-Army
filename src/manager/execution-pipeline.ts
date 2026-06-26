/**
 * Manager Execution Pipeline - Cloudflare Workers Edition
 * Hades Army v9.6 — Manager actually calls LLM
 *
 * Priority 3: Manager Execution Pipeline
 *
 * When a user sends a free-text request, the Manager:
 *   1. Loads memory (conversation + repository context)
 *   2. Loads architecture context
 *   3. Plans the task
 *   4. Selects the right agent (Builder for code, self for analysis)
 *   5. Generates the LLM prompt
 *   6. Calls the LLM via Model Registry
 *   7. Validates the response
 *   8. Updates memory
 *   9. Sends Telegram response
 *
 * All steps are logged with trace IDs for debugging.
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import { ModelRegistry } from "../registry/model-registry";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export interface PipelineInput {
  userPrompt: string;
  userId: string;
  projectId?: string;
  repositoryFullName?: string;
  mode: string;
  traceId: string;
}

export interface PipelineStep {
  name: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  ok: boolean;
  error?: string;
}

export interface PipelineResult {
  traceId: string;
  ok: boolean;
  response: string;
  steps: PipelineStep[];
  modelUsed?: { provider: string; model: string };
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  durationMs: number;
  error?: string;
}

// ============================================
// Manager Execution Pipeline
// ============================================

export class ManagerExecutionPipeline {
  private env: HadesBindings;
  private registry: ModelRegistry;

  constructor(env: HadesBindings) {
    this.env = env;
    this.registry = ModelRegistry.getInstance(env);
  }

  /**
   * Execute the full Manager pipeline for a user request.
   */
  async execute(input: PipelineInput): Promise<PipelineResult> {
    const startMs = Date.now();
    const steps: PipelineStep[] = [];
    const traceId = input.traceId;

    logger.info("ManagerPipeline: start", { traceId, userId: input.userId, mode: input.mode, promptLength: input.userPrompt.length });

    // === Step 1: Memory read ===
    let memoryContext = "";
    steps.push(await this.runStep("memory_read", async () => {
      // Load conversation memory (best-effort)
      try {
        const { getConversationMemory } = await import("../memory/conversation-memory");
        const convMem = getConversationMemory(this.env);
        const snap = await convMem.getSnapshot(input.userId);
        memoryContext = [
          `Active project: ${snap.activeProject ?? "none"}`,
          `Active repository: ${snap.activeRepository ?? "none"}`,
          `Active mode: ${snap.activeMode ?? "plan"}`,
        ].join("\n");
      } catch (err) {
        memoryContext = "(memory unavailable)";
        logger.warn("ManagerPipeline: memory read failed", { traceId, err });
      }
    }));

    // === Step 2: Architecture context ===
    let archContext = "";
    steps.push(await this.runStep("architecture_context", async () => {
      if (input.repositoryFullName) {
        archContext = `Repository: ${input.repositoryFullName}\n(Architecture analysis would be loaded here in full impl)`;
      } else {
        archContext = "(no repository connected)";
      }
    }));

    // === Step 3: Task planning ===
    steps.push(await this.runStep("task_planning", async () => {
      // Manager decides what to do based on mode
      logger.info("ManagerPipeline: planning", { traceId, mode: input.mode });
    }))

    // === Step 4: Select agent ===
    // In PLAN/EXPLORE/ANALYZE/ARCHITECT/CHAT modes → Manager handles directly
    // In BUILD mode → would delegate to Builder (not yet wired)
    const managerHandlesDirectly = ["plan", "explore", "analyze", "architect", "chat", "review", "debug"].includes(input.mode);

    steps.push(await this.runStep("agent_selection", async () => {
      logger.info("ManagerPipeline: agent selected", { traceId, agent: managerHandlesDirectly ? "manager" : "builder" });
    }))

    // === Step 5: Generate prompt ===
    const systemPrompt = this.buildSystemPrompt(input.mode);
    const userPrompt = this.buildUserPrompt(input, memoryContext, archContext);

    steps.push(await this.runStep("prompt_generation", async () => {
      logger.info("ManagerPipeline: prompt generated", { traceId, promptLength: userPrompt.length });
    }))

    // === Step 6: LLM request (with fallback) ===
    let llmResponse = "";
    let modelUsed: { provider: string; model: string } | undefined;
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd = 0;

    steps.push(await this.runStep("llm_request", async () => {
      // Try primary provider (Google Gemini) first
      try {
        const result = await this.registry.generateForAgent("manager", userPrompt, {
          maxTokens: 2048,
          temperature: 0.4,
          systemPrompt,
        });
        llmResponse = result.content;
        modelUsed = { provider: result.model.provider, model: result.model.model };
        tokensIn = result.tokensIn;
        tokensOut = result.tokensOut;
        costUsd = this.registry.estimateCostUsd("manager", tokensIn, tokensOut);

        logger.info("ManagerPipeline: LLM response received (primary)", {
          traceId,
          model: `${modelUsed.provider}/${modelUsed.model}`,
          tokensIn,
          tokensOut,
          responseLength: llmResponse.length,
        });
        return; // success — don't try fallback
      } catch (primaryErr) {
        logger.warn("ManagerPipeline: primary LLM failed, trying fallback", {
          traceId,
          primaryError: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
        });
      }

      // Fallback: try Cloudflare Workers AI (always available if AI binding exists)
      try {
        const providerInstance = this.registry.resolveProvider("cloudflare");
        const fallbackResult = await providerInstance.generate({
          model: "@cf/meta/llama-3.1-70b-instruct",
          prompt: userPrompt,
          maxTokens: 2048,
          temperature: 0.4,
          systemPrompt,
        });
        llmResponse = fallbackResult.content;
        modelUsed = { provider: "cloudflare", model: "@cf/meta/llama-3.1-70b-instruct" };
        tokensIn = fallbackResult.tokensIn;
        tokensOut = fallbackResult.tokensOut;
        costUsd = 0; // Cloudflare AI is free

        logger.info("ManagerPipeline: LLM response received (fallback)", {
          traceId,
          model: `${modelUsed.provider}/${modelUsed.model}`,
          tokensIn,
          tokensOut,
          responseLength: llmResponse.length,
        });
      } catch (fallbackErr) {
        const errorMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        logger.error("ManagerPipeline: ALL LLM providers failed", { traceId, error: errorMsg });
        throw new Error(`All AI providers unavailable. Primary error: see logs. Fallback error: ${errorMsg}`);
      }
    }))

    // If LLM failed, return early with helpful error
    const llmStep = steps[steps.length - 1];
    if (!llmStep.ok) {
      return {
        traceId,
        ok: false,
        response: [
          `⚠️ *AI model unavailable*`,
          ``,
          `I couldn't reach any AI provider.`,
          ``,
          `Possible causes:`,
          `• \`GOOGLE_AI_API_KEY\` not set or invalid`,
          `• \`OPENROUTER_API_KEY\` not set or invalid`,
          `• Cloudflare AI binding missing`,
          ``,
          `Ask the admin to check secrets with:`,
          `\`wrangler secret list\``,
        ].join("\n"),
        steps,
        durationMs: Date.now() - startMs,
        error: llmStep.error,
      };
    }

    // === Step 7: Validate response ===
    steps.push(await this.runStep("response_validation", async () => {
      if (!llmResponse || llmResponse.length < 10) {
        throw new Error("LLM returned empty or too-short response");
      }
    }))

    // === Step 8: Memory update ===
    steps.push(await this.runStep("memory_update", async () => {
      try {
        const { getConversationMemory } = await import("../memory/conversation-memory");
        const convMem = getConversationMemory(this.env);
        // Record the interaction
        await convMem.recordClarifyingAnswer(input.userId, `last_request_${traceId.slice(-8)}`, input.userPrompt);
      } catch (err) {
        logger.warn("ManagerPipeline: memory update failed", { traceId, err });
      }
    }))

    // === Step 9: Format Telegram response ===
    const response = this.formatResponse(llmResponse, modelUsed, tokensIn, tokensOut, costUsd, traceId);

    const result: PipelineResult = {
      traceId,
      ok: true,
      response,
      steps,
      modelUsed,
      tokensIn,
      tokensOut,
      costUsd,
      durationMs: Date.now() - startMs,
    };

    logger.info("ManagerPipeline: complete", { traceId, ok: true, durationMs: result.durationMs, steps: steps.length });
    return result;
  }

  // ============================================
  // Prompt builders
  // ============================================

  private buildSystemPrompt(mode: string): string {
    const modeDescriptions: Record<string, string> = {
      plan: "You are in PLAN mode. Analyze the request, propose architecture, estimate cost and risk. Do NOT generate code — only plan.",
      build: "You are in BUILD mode. Generate the code changes needed. Be specific about file paths and content.",
      explore: "You are in EXPLORE mode. Explain the repository structure and answer questions about it.",
      analyze: "You are in ANALYZE mode. Provide deep analysis of the repository: architecture, dependencies, technical debt.",
      review: "You are in REVIEW mode. Review the code for security, performance, architecture, and style issues.",
      debug: "You are in DEBUG mode. Help diagnose and fix the reported issue.",
      architect: "You are in ARCHITECT mode. Discuss architecture decisions, tradeoffs, and patterns.",
      chat: "You are in CHAT mode. Have a helpful conversation about software engineering.",
    };

    return [
      `You are the MANAGER of Hades Army, an autonomous AI software engineering team.`,
      ``,
      modeDescriptions[mode] ?? modeDescriptions.chat,
      ``,
      `Rules:`,
      `1. Be concise but thorough.`,
      `2. Use Markdown formatting.`,
      `3. If you need more context, ask clarifying questions.`,
      `4. If the request is unsafe or impossible, explain why.`,
      `5. Always consider the repository's existing architecture and conventions.`,
    ].join("\n");
  }

  private buildUserPrompt(input: PipelineInput, memoryContext: string, archContext: string): string {
    return [
      `# Context`,
      `Mode: ${input.mode}`,
      `Repository: ${input.repositoryFullName ?? "(none connected)"}`,
      `Project: ${input.projectId ?? "(none)"}`,
      ``,
      `# Memory`,
      memoryContext,
      ``,
      `# Architecture`,
      archContext,
      ``,
      `# User Request`,
      input.userPrompt,
    ].join("\n");
  }

  // ============================================
  // Response formatter
  // ============================================

  private formatResponse(
    llmResponse: string,
    modelUsed: { provider: string; model: string } | undefined,
    tokensIn: number,
    tokensOut: number,
    costUsd: number,
    traceId: string,
  ): string {
    // Truncate very long responses for Telegram (4096 char limit)
    const maxLen = 3800;
    let response = llmResponse;
    if (response.length > maxLen) {
      response = response.slice(0, maxLen) + "\n\n...(truncated)";
    }

    // Add footer with metadata
    const footer = [
      ``,
      `---`,
      `🤖 ${modelUsed ? `${modelUsed.provider}/${modelUsed.model}` : "unknown model"}`,
      `🔤 ${tokensIn}+${tokensOut} tokens · 💰 $${costUsd.toFixed(4)}`,
      `📋 Trace: \`${traceId.slice(-8)}\``,
    ].join("\n");

    return response + footer;
  }

  // ============================================
  // Step runner with timing
  // ============================================

  private async runStep(name: string, fn: () => Promise<void>): Promise<PipelineStep> {
    const step: PipelineStep = {
      name,
      startedAt: new Date().toISOString(),
      ok: false,
    };

    try {
      await fn();
      step.ok = true;
    } catch (err) {
      step.ok = false;
      step.error = err instanceof Error ? err.message : String(err);
      logger.error(`ManagerPipeline step failed: ${name}`, { error: step.error });
    }

    step.completedAt = new Date().toISOString();
    step.durationMs = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();

    return step;
  }
}

// ============================================
// Factory
// ============================================

let _instance: ManagerExecutionPipeline | null = null;

export function getManagerExecutionPipeline(env: HadesBindings): ManagerExecutionPipeline {
  if (!_instance) _instance = new ManagerExecutionPipeline(env);
  return _instance;
}
