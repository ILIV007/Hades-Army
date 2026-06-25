/**
 * Real Builder Agent - Cloudflare Workers Edition
 * Hades Army v0.9.0 — Architecture Completion & Production Readiness
 *
 * Section 1: Real Agent System
 *
 * This is the REAL Builder Agent — a true AI agent that:
 *   1. Receives a structured task package from the Manager
 *   2. Loads its own model EXCLUSIVELY through the Model Registry
 *      (Qwen3-Coder via OpenRouter by default — NO hardcoded model)
 *   3. Calls the LLM with a Builder-specific prompt template
 *   4. Parses the LLM's response into a structured patch artifact
 *   5. Returns reasoning + confidence alongside the patch
 *
 * Output (per v0.9 spec):
 *   {
 *     taskId,
 *     patch,
 *     changedFiles,
 *     reasoning,
 *     confidence
 *   }
 *
 * The existing src/agents/builder.ts (v0.8.0) is UNMODIFIED. It
 * continues to be used by legacy code paths. This new module is the
 * v0.9 entry point used by the Manager Controller.
 */

import { logger } from "../../utils/logger";
import { generateId } from "../../utils/helpers";
import { ModelRegistry } from "../../registry/model-registry";
import type { HadesBindings } from "../../types";

// ============================================
// Types — strictly per v0.9 spec
// ============================================

export interface TaskPackage {
  taskId: string;
  projectId: string;
  goal: string;
  constraints: BuilderConstraints;
  repositoryContext: RepositoryContextForBuilder;
  memoryContext: MemoryContextForBuilder;
  architectureContext: ArchitectureContextForBuilder;
}

export interface BuilderConstraints {
  maxFiles?: number;
  maxLines?: number;
  forbiddenPaths?: string[];
  requiredTests?: boolean;
  styleGuide?: string;
}

export interface RepositoryContextForBuilder {
  repositoryFullName: string;
  defaultBranch: string;
  targetBranch: string;
  languages: string[];
  frameworks: string[];
  conventions: string[];
  /** relevant file contents (read-only) */
  relevantFiles: Array<{ path: string; content: string; reason: string }>;
}

export interface MemoryContextForBuilder {
  projectMemory: {
    architecture: unknown;
    roadmap: unknown;
    conventions: string[];
  };
  relevantDecisions: Array<{ id: string; title: string; rationale: string }>;
  pastFailures: Array<{ id: string; summary: string; lesson: string }>;
  knowledgeNotes: string[];
}

export interface ArchitectureContextForBuilder {
  style: string;
  modules: Array<{ name: string; responsibility: string; dependsOn: string[] }>;
  dependencyGraph: string;
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
}

export interface BuilderPatch {
  format: "unified_diff" | "file_replacement" | "new_file";
  content: string;
  baseSha: string;
}

export interface BuilderResult {
  taskId: string;
  patch: BuilderPatch;
  changedFiles: ChangedFile[];
  reasoning: string;
  confidence: number; // 0.0 - 1.0
  /** model that actually produced this patch (for audit) */
  modelUsed: { provider: string; model: string };
  /** tokens consumed (for cost tracker) */
  tokensIn: number;
  tokensOut: number;
  /** wall clock time */
  elapsedMs: number;
}

// ============================================
// Builder Agent
// ============================================

export class RealBuilderAgent {
  private env: HadesBindings;
  private registry: ModelRegistry;

  constructor(env: HadesBindings) {
    this.env = env;
    this.registry = ModelRegistry.getInstance(env);
  }

  /**
   * Build a patch for the given task package.
   *
   * The Builder NEVER touches GitHub and NEVER reads the repository
   * directly — it consumes only what the Manager provides in the task
   * package. The Manager is the sole source of repository context.
   */
  async build(task: TaskPackage): Promise<BuilderResult> {
    const start = Date.now();
    const model = this.registry.getModelForAgent("builder");
    logger.info(`RealBuilder: task ${task.taskId} starting with ${model.provider}/${model.model}`);

    // Build the prompt — Qwen3-Coder expects a clear, structured prompt
    const prompt = this.buildPrompt(task);

    let content: string;
    let tokensIn = 0;
    let tokensOut = 0;
    try {
      const response = await this.registry.generateForAgent("builder", prompt, {
        maxTokens: 4096,
        temperature: 0.2,
        systemPrompt: this.systemPrompt(),
      });
      content = response.content;
      tokensIn = response.tokensIn;
      tokensOut = response.tokensOut;
    } catch (err) {
      logger.error(`RealBuilder: LLM call failed for task ${task.taskId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      // Fallback: emit an empty patch with zero confidence so the Reviewer
      // can flag it and the Manager can replan.
      return {
        taskId: task.taskId,
        patch: { format: "new_file", content: "", baseSha: "" },
        changedFiles: [],
        reasoning: `LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        confidence: 0,
        modelUsed: { provider: model.provider, model: model.model },
        tokensIn: 0,
        tokensOut: 0,
        elapsedMs: Date.now() - start,
      };
    }

    // Parse the LLM output into a structured patch
    const parsed = this.parseOutput(content, task);

    const elapsedMs = Date.now() - start;
    logger.info(`RealBuilder: task ${task.taskId} done in ${elapsedMs}ms`, {
      files: parsed.changedFiles.length,
      confidence: parsed.confidence,
      tokens: `${tokensIn}+${tokensOut}`,
    });

    return {
      taskId: task.taskId,
      patch: parsed.patch,
      changedFiles: parsed.changedFiles,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      modelUsed: { provider: model.provider, model: model.model },
      tokensIn,
      tokensOut,
      elapsedMs,
    };
  }

  // ============================================
  // Prompt construction
  // ============================================

  private systemPrompt(): string {
    return [
      `You are the BUILDER AGENT of Hades Army.`,
      `Your job: produce a code patch that solves the task given to you.`,
      ``,
      `Rules:`,
      `1. You MUST output a single JSON object (no markdown, no prose before or after).`,
      `2. The JSON must have these exact fields:`,
      `   - "patch": an object with { "format": "new_file"|"file_replacement"|"unified_diff", "content": <string> }`,
      `   - "changedFiles": an array of { "path": <string>, "status": "added"|"modified"|"deleted", "additions": <int>, "deletions": <int> }`,
      `   - "reasoning": a short string explaining WHY you made these changes`,
      `   - "confidence": a float between 0.0 and 1.0`,
      `3. NEVER include secrets, API keys, or tokens in your patch.`,
      `4. NEVER touch files in .env, .hades/secrets/, or any secrets/ directory.`,
      `5. Respect the constraints given in the task package.`,
      `6. If you cannot solve the task, return confidence = 0 and an empty patch.`,
    ].join("\n");
  }

  private buildPrompt(task: TaskPackage): string {
    const lines: string[] = [];
    lines.push(`# Task`);
    lines.push(`Task ID: ${task.taskId}`);
    lines.push(`Project ID: ${task.projectId}`);
    lines.push(`Goal: ${task.goal}`);
    lines.push(``);

    lines.push(`# Constraints`);
    if (task.constraints.maxFiles) lines.push(`- Max files: ${task.constraints.maxFiles}`);
    if (task.constraints.maxLines) lines.push(`- Max lines per file: ${task.constraints.maxLines}`);
    if (task.constraints.forbiddenPaths?.length) lines.push(`- Forbidden paths: ${task.constraints.forbiddenPaths.join(", ")}`);
    if (task.constraints.requiredTests) lines.push(`- Tests required: yes`);
    if (task.constraints.styleGuide) lines.push(`- Style guide: ${task.constraints.styleGuide}`);
    lines.push(``);

    lines.push(`# Repository Context`);
    lines.push(`Repository: ${task.repositoryContext.repositoryFullName}`);
    lines.push(`Default branch: ${task.repositoryContext.defaultBranch}`);
    lines.push(`Target branch: ${task.repositoryContext.targetBranch}`);
    lines.push(`Languages: ${task.repositoryContext.languages.join(", ")}`);
    lines.push(`Frameworks: ${task.repositoryContext.frameworks.join(", ") || "(none)"}`);
    lines.push(`Conventions: ${task.repositoryContext.conventions.join(", ")}`);
    lines.push(``);

    if (task.repositoryContext.relevantFiles.length > 0) {
      lines.push(`# Relevant Files (read-only context)`);
      for (const f of task.repositoryContext.relevantFiles) {
        lines.push(`## ${f.path}`);
        lines.push(`Reason: ${f.reason}`);
        lines.push("```");
        lines.push(f.content.slice(0, 4000));
        lines.push("```");
        lines.push(``);
      }
    }

    lines.push(`# Architecture Context`);
    lines.push(`Style: ${task.architectureContext.style}`);
    if (task.architectureContext.modules.length > 0) {
      lines.push(`Modules:`);
      for (const m of task.architectureContext.modules) {
        lines.push(`- ${m.name}: ${m.responsibility} (depends on: ${m.dependsOn.join(", ") || "none"})`);
      }
    }
    lines.push(``);

    lines.push(`# Memory Context`);
    lines.push(`Conventions: ${task.memoryContext.projectMemory.conventions.join(", ") || "(none)"}`);
    if (task.memoryContext.pastFailures.length > 0) {
      lines.push(`Past failures (learn from these):`);
      for (const f of task.memoryContext.pastFailures) {
        lines.push(`- ${f.summary} — Lesson: ${f.lesson}`);
      }
    }
    if (task.memoryContext.knowledgeNotes.length > 0) {
      lines.push(`Knowledge notes:`);
      for (const k of task.memoryContext.knowledgeNotes) {
        lines.push(`- ${k.slice(0, 200)}`);
      }
    }
    lines.push(``);

    lines.push(`# Output`);
    lines.push(`Return ONLY the JSON object described in the system prompt.`);

    return lines.join("\n");
  }

  // ============================================
  // Output parsing
  // ============================================

  private parseOutput(
    content: string,
    task: TaskPackage,
  ): { patch: BuilderPatch; changedFiles: ChangedFile[]; reasoning: string; confidence: number } {
    // Try to extract JSON from the response
    const jsonText = this.extractJson(content);
    if (!jsonText) {
      logger.warn(`RealBuilder: no JSON found in LLM output for task ${task.taskId}`);
      return {
        patch: { format: "new_file", content: content.slice(0, 4000), baseSha: "" },
        changedFiles: [{ path: "hades-output.txt", status: "added", additions: content.split("\n").length, deletions: 0 }],
        reasoning: "LLM did not return valid JSON; raw output preserved as new file.",
        confidence: 0.2,
      };
    }

    try {
      const obj = JSON.parse(jsonText);
      return {
        patch: {
          format: (obj.patch?.format as BuilderPatch["format"]) ?? "new_file",
          content: String(obj.patch?.content ?? ""),
          baseSha: String(obj.patch?.baseSha ?? ""),
        },
        changedFiles: Array.isArray(obj.changedFiles)
          ? obj.changedFiles.map((f: any) => ({
              path: String(f.path ?? ""),
              status: (f.status as ChangedFile["status"]) ?? "modified",
              additions: Number(f.additions ?? 0),
              deletions: Number(f.deletions ?? 0),
            }))
          : [],
        reasoning: String(obj.reasoning ?? ""),
        confidence: Math.max(0, Math.min(1, Number(obj.confidence ?? 0))),
      };
    } catch (err) {
      logger.error(`RealBuilder: JSON parse failed for task ${task.taskId}`, { err });
      return {
        patch: { format: "new_file", content: jsonText.slice(0, 4000), baseSha: "" },
        changedFiles: [],
        reasoning: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
        confidence: 0.1,
      };
    }
  }

  private extractJson(content: string): string | undefined {
    // Try direct JSON parse first
    try {
      JSON.parse(content);
      return content;
    } catch {
      // Continue
    }
    // Try fenced ```json ... ```
    const fenced = content.match(/```json\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1].trim();
    // Try first { ... last }
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return content.slice(firstBrace, lastBrace + 1);
    }
    return undefined;
  }
}

// ============================================
// Factory
// ============================================

let _instance: RealBuilderAgent | null = null;

export function getRealBuilderAgent(env: HadesBindings): RealBuilderAgent {
  if (!_instance) _instance = new RealBuilderAgent(env);
  return _instance;
}
