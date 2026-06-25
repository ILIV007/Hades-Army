/**
 * Real Reviewer Agent - Cloudflare Workers Edition
 * Hades Army v0.9.0 — Architecture Completion & Production Readiness
 *
 * Section 1: Real Agent System
 *
 * This is the REAL Reviewer Agent — a true AI agent that:
 *   1. Receives the Builder's patch (forwarded by Manager)
 *   2. Loads its own model EXCLUSIVELY through the Model Registry
 *      (DeepSeek-Chat via OpenRouter by default — NO hardcoded model)
 *   3. Calls the LLM with a Reviewer-specific prompt template
 *   4. Parses the LLM's verdict into a structured review
 *   5. Returns status + issues + recommendation + confidence
 *
 * Output (per v0.9 spec):
 *   {
 *     taskId,
 *     status,
 *     issues,
 *     recommendation,
 *     confidence
 *   }
 *
 * The Reviewer NEVER touches GitHub and NEVER reads the repository
 * directly — it consumes only what the Manager provides.
 */

import { logger } from "../../utils/logger";
import { ModelRegistry } from "../../registry/model-registry";
import type { HadesBindings } from "../../types";
import type { BuilderResult } from "./builder";

// ============================================
// Types — strictly per v0.9 spec
// ============================================

export interface ReviewInput {
  taskId: string;
  projectId: string;
  patch: BuilderResult["patch"];
  changedFiles: BuilderResult["changedFiles"];
  builderReasoning: string;
  goal: string;
  constraints: {
    requiredTests?: boolean;
    forbiddenPaths?: string[];
    maxFiles?: number;
    maxLines?: number;
  };
  /** Repository context needed to assess impact */
  repositoryImpact: {
    languages: string[];
    frameworks: string[];
    conventions: string[];
    existingFilesAtSamePath: string[];
  };
}

export interface ReviewIssue {
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: "security" | "architecture" | "performance" | "style" | "tests" | "documentation" | "correctness" | "risk";
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export type ReviewStatus = "approved" | "rejected" | "changes_requested";

export interface ReviewerResult {
  taskId: string;
  status: ReviewStatus;
  issues: ReviewIssue[];
  recommendation: string;
  confidence: number; // 0.0 - 1.0
  /** model that produced this review (for audit) */
  modelUsed: { provider: string; model: string };
  tokensIn: number;
  tokensOut: number;
  elapsedMs: number;
}

// ============================================
// Reviewer Agent
// ============================================

export class RealReviewerAgent {
  private env: HadesBindings;
  private registry: ModelRegistry;

  constructor(env: HadesBindings) {
    this.env = env;
    this.registry = ModelRegistry.getInstance(env);
  }

  async review(input: ReviewInput): Promise<ReviewerResult> {
    const start = Date.now();
    const model = this.registry.getModelForAgent("reviewer");
    logger.info(`RealReviewer: task ${input.taskId} starting with ${model.provider}/${model.model}`);

    const prompt = this.buildPrompt(input);

    let content: string;
    let tokensIn = 0;
    let tokensOut = 0;
    try {
      const response = await this.registry.generateForAgent("reviewer", prompt, {
        maxTokens: 2048,
        temperature: 0.1,
        systemPrompt: this.systemPrompt(),
      });
      content = response.content;
      tokensIn = response.tokensIn;
      tokensOut = response.tokensOut;
    } catch (err) {
      logger.error(`RealReviewer: LLM call failed for task ${input.taskId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      // Conservative fallback: REJECT — Manager must replan
      return {
        taskId: input.taskId,
        status: "rejected",
        issues: [{
          severity: "critical",
          category: "risk",
          message: `Reviewer LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        }],
        recommendation: "Reject and replan — reviewer could not validate the patch.",
        confidence: 0,
        modelUsed: { provider: model.provider, model: model.model },
        tokensIn: 0,
        tokensOut: 0,
        elapsedMs: Date.now() - start,
      };
    }

    const parsed = this.parseOutput(content, input.taskId);

    const elapsedMs = Date.now() - start;
    logger.info(`RealReviewer: task ${input.taskId} done in ${elapsedMs}ms`, {
      status: parsed.status,
      issues: parsed.issues.length,
      confidence: parsed.confidence,
      tokens: `${tokensIn}+${tokensOut}`,
    });

    return {
      ...parsed,
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
      `You are the REVIEWER AGENT of Hades Army.`,
      `Your job: validate the Builder's patch and decide whether it should be merged.`,
      ``,
      `Rules:`,
      `1. You MUST output a single JSON object (no markdown, no prose before or after).`,
      `2. The JSON must have these exact fields:`,
      `   - "status": one of "approved" | "rejected" | "changes_requested"`,
      `   - "issues": an array of { "severity", "category", "message", "file"?, "line"?, "suggestion"? }`,
      `   - "recommendation": a short string explaining your verdict`,
      `   - "confidence": a float between 0.0 and 1.0`,
      `3. Be CONSERVATIVE. When in doubt, request changes.`,
      `4. Critical issues must ALWAYS result in "rejected" or "changes_requested".`,
      `5. Categories: "security", "architecture", "performance", "style", "tests", "documentation", "correctness", "risk".`,
      `6. Severities: "critical", "high", "medium", "low", "info".`,
      `7. Detect: security issues, architecture violations, missing tests, performance regressions, style violations.`,
    ].join("\n");
  }

  private buildPrompt(input: ReviewInput): string {
    const lines: string[] = [];
    lines.push(`# Review Task`);
    lines.push(`Task ID: ${input.taskId}`);
    lines.push(`Project ID: ${input.projectId}`);
    lines.push(`Original goal: ${input.goal}`);
    lines.push(``);

    lines.push(`# Constraints`);
    if (input.constraints.requiredTests) lines.push(`- Tests required: yes`);
    if (input.constraints.forbiddenPaths?.length) lines.push(`- Forbidden paths: ${input.constraints.forbiddenPaths.join(", ")}`);
    if (input.constraints.maxFiles) lines.push(`- Max files: ${input.constraints.maxFiles}`);
    if (input.constraints.maxLines) lines.push(`- Max lines: ${input.constraints.maxLines}`);
    lines.push(``);

    lines.push(`# Builder's Reasoning`);
    lines.push(input.builderReasoning || "(no reasoning provided)");
    lines.push(``);

    lines.push(`# Changed Files`);
    for (const f of input.changedFiles) {
      lines.push(`- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`);
    }
    lines.push(``);

    lines.push(`# Patch`);
    lines.push(`Format: ${input.patch.format}`);
    lines.push(`Base SHA: ${input.patch.baseSha || "(unknown)"}`);
    lines.push(`Content:`);
    lines.push("```");
    lines.push(input.patch.content.slice(0, 8000));
    lines.push("```");
    lines.push(``);

    lines.push(`# Repository Impact Context`);
    lines.push(`Languages: ${input.repositoryImpact.languages.join(", ")}`);
    lines.push(`Frameworks: ${input.repositoryImpact.frameworks.join(", ")}`);
    lines.push(`Conventions: ${input.repositoryImpact.conventions.join(", ")}`);
    if (input.repositoryImpact.existingFilesAtSamePath.length > 0) {
      lines.push(`Existing files at same paths:`);
      for (const p of input.repositoryImpact.existingFilesAtSamePath) {
        lines.push(`- ${p}`);
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

  private parseOutput(content: string, taskId: string): {
    status: ReviewStatus;
    issues: ReviewIssue[];
    recommendation: string;
    confidence: number;
  } {
    const jsonText = this.extractJson(content);
    if (!jsonText) {
      logger.warn(`RealReviewer: no JSON in LLM output for task ${taskId}`);
      return {
        status: "changes_requested",
        issues: [{
          severity: "medium",
          category: "risk",
          message: "Reviewer LLM did not return structured JSON. Manual review required.",
        }],
        recommendation: "Request changes — reviewer output unparseable.",
        confidence: 0.2,
      };
    }

    try {
      const obj = JSON.parse(jsonText);
      const status = (["approved", "rejected", "changes_requested"].includes(obj.status)
        ? obj.status
        : "changes_requested") as ReviewStatus;
      const issues: ReviewIssue[] = Array.isArray(obj.issues)
        ? obj.issues.map((i: any) => ({
            severity: (i.severity as ReviewIssue["severity"]) ?? "info",
            category: (i.category as ReviewIssue["category"]) ?? "risk",
            message: String(i.message ?? ""),
            file: i.file ? String(i.file) : undefined,
            line: i.line ? Number(i.line) : undefined,
            suggestion: i.suggestion ? String(i.suggestion) : undefined,
          }))
        : [];
      return {
        status,
        issues,
        recommendation: String(obj.recommendation ?? ""),
        confidence: Math.max(0, Math.min(1, Number(obj.confidence ?? 0))),
      };
    } catch (err) {
      logger.error(`RealReviewer: JSON parse failed for task ${taskId}`, { err });
      return {
        status: "rejected",
        issues: [{
          severity: "critical",
          category: "risk",
          message: `Reviewer JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
        }],
        recommendation: "Reject — reviewer output was unparseable.",
        confidence: 0,
      };
    }
  }

  private extractJson(content: string): string | undefined {
    try { JSON.parse(content); return content; } catch {}
    const fenced = content.match(/```json\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1].trim();
    const first = content.indexOf("{");
    const last = content.lastIndexOf("}");
    if (first >= 0 && last > first) return content.slice(first, last + 1);
    return undefined;
  }
}

// ============================================
// Factory
// ============================================

let _instance: RealReviewerAgent | null = null;

export function getRealReviewerAgent(env: HadesBindings): RealReviewerAgent {
  if (!_instance) _instance = new RealReviewerAgent(env);
  return _instance;
}
