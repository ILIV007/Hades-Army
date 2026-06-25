/**
 * Manager Personality - Cloudflare Workers Edition
 * Hades Army v0.9.0 — Architecture Completion & Production Readiness
 *
 * Section 2: Manager Evolution
 *
 * The Manager is NOT a chatbot. NOT an assistant. NOT a code generator.
 *
 * The Manager is a SENIOR TECHNICAL ARCHITECT who:
 *   - Challenges weak ideas before implementing them
 *   - Identifies risks the user hasn't considered
 *   - Asks clarifying questions before starting work
 *   - Protects repository quality by rejecting bad patches
 *   - Records lessons from failures for future planning
 *
 * This module provides the Manager's "personality" as a set of
 * prompt templates and decision helpers. It is loaded into the
 * ManagerController (src/orchestration/manager-controller.ts) without
 * modifying the existing controller — the controller reads this
 * module via dependency injection.
 */

import { logger } from "../utils/logger";
import { ModelRegistry, type AgentRole } from "../registry/model-registry";
import type { HadesBindings } from "../types";
import type { RepositoryScanResult } from "../memory/repository-scanner";
import type { MemoryContext } from "../memory/repository-memory";

// ============================================
// Types
// ============================================

export type ManagerMode = "plan" | "build" | "explore";

export interface ManagerPersonalityConfig {
  mode: ManagerMode;
  /** When true, the Manager is allowed to challenge and ask questions */
  challengeAllowed: boolean;
  /** When true, the Manager may proceed to implementation */
  canExecute: boolean;
}

export interface RiskAssessment {
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  description: string;
  mitigation: string;
}

export interface ChallengeQuestion {
  id: string;
  question: string;
  reason: string;
  /** If the user doesn't answer, the Manager will use this default assumption */
  defaultAssumption: string;
}

export interface PlanAnalysis {
  understood: boolean;
  summary: string;
  risks: RiskAssessment[];
  clarifyingQuestions: ChallengeQuestion[];
  estimatedCostUsd: number;
  estimatedTimeMin: number;
  recommendation: "proceed" | "needs_clarification" | "should_reconsider" | "abort";
  recommendationReason: string;
}

// ============================================
// Manager Personality
// ============================================

export class ManagerPersonality {
  private env: HadesBindings;
  private registry: ModelRegistry;
  private mode: ManagerMode = "plan";

  constructor(env: HadesBindings) {
    this.env = env;
    this.registry = ModelRegistry.getInstance(env);
  }

  // ============================================
  // Mode management
  // ============================================

  setMode(mode: ManagerMode): void {
    this.mode = mode;
    logger.info(`ManagerPersonality: mode set to "${mode}"`);
  }

  getMode(): ManagerMode {
    return this.mode;
  }

  getConfig(): ManagerPersonalityConfig {
    switch (this.mode) {
      case "plan":
        return { mode: "plan", challengeAllowed: true, canExecute: false };
      case "build":
        return { mode: "build", challengeAllowed: false, canExecute: true };
      case "explore":
        return { mode: "explore", challengeAllowed: true, canExecute: false };
    }
  }

  // ============================================
  // Mode-specific behavior
  // ============================================

  /**
   * In Plan mode, the Manager behaves as an ARCHITECT:
   *   - Analyzes the request for risks
   *   - Challenges weak ideas
   *   - Asks clarifying questions
   *   - Returns a plan (NO code generation)
   */
  async analyzeAsArchitect(
    userPrompt: string,
    scan: RepositoryScanResult,
    memory: MemoryContext,
  ): Promise<PlanAnalysis> {
    const prompt = this.buildArchitectPrompt(userPrompt, scan, memory);
    let content: string;
    try {
      const response = await this.registry.generateForAgent("manager", prompt, {
        maxTokens: 2048,
        temperature: 0.3,
        systemPrompt: this.architectSystemPrompt(),
      });
      content = response.content;
    } catch (err) {
      logger.warn(`ManagerPersonality: architect LLM failed, using heuristic`, { err });
      return this.heuristicAnalysis(userPrompt, scan);
    }
    return this.parsePlanAnalysis(content, userPrompt);
  }

  /**
   * In Build mode, the Manager behaves as an EXECUTOR:
   *   - Takes an approved plan and decomposes it into Builder tasks
   *   - Does NOT challenge (the plan was already approved in Plan mode)
   *   - Tracks cost and progress
   */
  async decomposeAsExecutor(
    approvedPlan: PlanAnalysis,
    scan: RepositoryScanResult,
  ): Promise<Array<{ taskId: string; objective: string; constraints: Record<string, unknown> }>> {
    const prompt = this.buildExecutorPrompt(approvedPlan, scan);
    let content: string;
    try {
      const response = await this.registry.generateForAgent("manager", prompt, {
        maxTokens: 2048,
        temperature: 0.2,
        systemPrompt: this.executorSystemPrompt(),
      });
      content = response.content;
    } catch (err) {
      logger.warn(`ManagerPersonality: executor LLM failed, using single-task fallback`, { err });
      return [{
        taskId: `task_${Date.now()}`,
        objective: approvedPlan.summary,
        constraints: { maxFiles: 10, maxLines: 1000, requiredTests: true },
      }];
    }
    return this.parseTaskDecomposition(content);
  }

  /**
   * In Explore mode, the Manager behaves as an ANALYST:
   *   - Produces architecture reports
   *   - Identifies technical debt and hotspots
   *   - Generates dependency graphs
   *   - NO code generation
   */
  async analyzeAsAnalyst(scan: RepositoryScanResult): Promise<string> {
    const prompt = [
      `You are the Manager in EXPLORE mode.`,
      `Produce a detailed repository analysis report in Markdown.`,
      ``,
      `Repository: ${scan.repositoryFullName}`,
      `Architecture style: ${scan.architectureStyle}`,
      `Languages: ${scan.languages.join(", ")}`,
      `Frameworks: ${scan.frameworks.join(", ") || "(none)"}`,
      `Conventions: ${scan.conventions.join(", ")}`,
      `Test layout: ${scan.testLayout}`,
      ``,
      `Include these sections:`,
      `1. Architecture Overview`,
      `2. Module Map`,
      `3. Dependency Graph (text)`,
      `4. Technical Debt (estimated)`,
      `5. Hotspots (files most likely to need attention)`,
      `6. Recommendations`,
    ].join("\n");

    try {
      const response = await this.registry.generateForAgent("manager", prompt, {
        maxTokens: 3000,
        temperature: 0.4,
      });
      return response.content;
    } catch (err) {
      logger.warn(`ManagerPersonality: analyst LLM failed, using template`, { err });
      return this.fallbackAnalysisReport(scan);
    }
  }

  // ============================================
  // Decision helpers
  // ============================================

  /**
   * Senior Architect decision: should this patch proceed to PR?
   * The Manager protects repository quality by rejecting patches
   * that have critical issues or low confidence.
   */
  decidePatchFate(
    builderConfidence: number,
    reviewStatus: "approved" | "rejected" | "changes_requested",
    criticalIssueCount: number,
  ): { action: "proceed_to_pr" | "replan" | "abort"; reason: string } {
    // Hard rules first
    if (criticalIssueCount > 0) {
      return {
        action: "abort",
        reason: `${criticalIssueCount} critical issue(s) detected by reviewer. Manager protecting repository quality.`,
      };
    }
    if (reviewStatus === "rejected") {
      return {
        action: "abort",
        reason: "Reviewer rejected the patch. Manager will not proceed without re-architecture.",
      };
    }
    if (reviewStatus === "changes_requested") {
      return {
        action: "replan",
        reason: "Reviewer requested changes. Manager will replan with feedback.",
      };
    }
    // Approved — but is the builder confident enough?
    if (builderConfidence < 0.5) {
      return {
        action: "replan",
        reason: `Builder confidence too low (${builderConfidence.toFixed(2)}). Manager requesting improved patch.`,
      };
    }
    return {
      action: "proceed_to_pr",
      reason: `Patch approved by reviewer (builder confidence ${builderConfidence.toFixed(2)}). Proceeding to PR.`,
    };
  }

  // ============================================
  // Prompts
  // ============================================

  private architectSystemPrompt(): string {
    return [
      `You are the MANAGER of Hades Army, behaving as a SENIOR TECHNICAL ARCHITECT.`,
      ``,
      `Your role:`,
      `- Challenge weak ideas before implementing them`,
      `- Identify risks the user hasn't considered`,
      `- Ask clarifying questions before starting work`,
      `- Protect repository quality`,
      `- Estimate cost and time`,
      ``,
      `You are NOT a chatbot. NOT an assistant. NOT a code generator.`,
      `You are the brain of the entire platform.`,
      ``,
      `Rules:`,
      `1. You MUST output a single JSON object (no markdown, no prose).`,
      `2. The JSON must have these exact fields:`,
      `   - "understood": boolean — did you understand the request?`,
      `   - "summary": string — your understanding of the request`,
      `   - "risks": array of { "severity", "category", "description", "mitigation" }`,
      `   - "clarifyingQuestions": array of { "id", "question", "reason", "defaultAssumption" }`,
      `   - "estimatedCostUsd": number`,
      `   - "estimatedTimeMin": number`,
      `   - "recommendation": one of "proceed" | "needs_clarification" | "should_reconsider" | "abort"`,
      `   - "recommendationReason": string`,
      `3. If the request is unclear, ambiguous, or risky, set recommendation to "needs_clarification" or "should_reconsider".`,
      `4. If the request cannot be safely executed, set recommendation to "abort" with a clear reason.`,
      `5. Always identify at least one risk, even for simple requests.`,
    ].join("\n");
  }

  private executorSystemPrompt(): string {
    return [
      `You are the MANAGER of Hades Army in BUILD mode.`,
      `Your role: decompose an approved plan into atomic Builder tasks.`,
      ``,
      `Rules:`,
      `1. Output a single JSON object: { "tasks": [ { "taskId", "objective", "constraints" } ] }`,
      `2. Each task must be small enough for a single Builder patch.`,
      `3. Constraints is an object with optional keys: maxFiles, maxLines, forbiddenPaths, requiredTests, styleGuide.`,
      `4. Do NOT challenge the plan — it was already approved in Plan mode.`,
      `5. Do NOT generate code. Only plan tasks.`,
    ].join("\n");
  }

  private buildArchitectPrompt(
    userPrompt: string,
    scan: RepositoryScanResult,
    memory: MemoryContext,
  ): string {
    return [
      `# User Request`,
      userPrompt,
      ``,
      `# Repository`,
      `Name: ${scan.repositoryFullName}`,
      `Style: ${scan.architectureStyle}`,
      `Languages: ${scan.languages.join(", ")}`,
      `Frameworks: ${scan.frameworks.join(", ") || "(none)"}`,
      `Conventions: ${scan.conventions.join(", ")}`,
      ``,
      `# Memory (past failures — learn from these)`,
      ...(memory.pastFailures.length > 0
        ? memory.pastFailures.map((f) => `- ${f.summary} — Lesson: ${f.lesson}`)
        : ["(no past failures recorded)"]),
      ``,
      `# Knowledge Notes`,
      ...(memory.knowledgeNotes.length > 0
        ? memory.knowledgeNotes.map((k) => `- ${k.slice(0, 200)}`)
        : ["(none)"]),
      ``,
      `# Output`,
      `Return ONLY the JSON object described in the system prompt.`,
    ].join("\n");
  }

  private buildExecutorPrompt(
    plan: PlanAnalysis,
    scan: RepositoryScanResult,
  ): string {
    return [
      `# Approved Plan`,
      `Summary: ${plan.summary}`,
      `Risks: ${plan.risks.map((r) => `${r.severity}: ${r.description}`).join("; ") || "(none)"}`,
      `Estimated cost: $${plan.estimatedCostUsd}`,
      `Estimated time: ${plan.estimatedTimeMin} min`,
      ``,
      `# Repository`,
      `Languages: ${scan.languages.join(", ")}`,
      `Frameworks: ${scan.frameworks.join(", ")}`,
      `Style: ${scan.architectureStyle}`,
      ``,
      `# Output`,
      `Return ONLY: { "tasks": [ { "taskId", "objective", "constraints" } ] }`,
    ].join("\n");
  }

  // ============================================
  // Parsers
  // ============================================

  private parsePlanAnalysis(content: string, originalPrompt: string): PlanAnalysis {
    const jsonText = this.extractJson(content);
    if (!jsonText) {
      return this.heuristicAnalysis(originalPrompt, null);
    }
    try {
      const obj = JSON.parse(jsonText);
      return {
        understood: Boolean(obj.understood),
        summary: String(obj.summary ?? originalPrompt.slice(0, 200)),
        risks: Array.isArray(obj.risks)
          ? obj.risks.map((r: any) => ({
              severity: (r.severity as RiskAssessment["severity"]) ?? "medium",
              category: String(r.category ?? "general"),
              description: String(r.description ?? ""),
              mitigation: String(r.mitigation ?? ""),
            }))
          : [],
        clarifyingQuestions: Array.isArray(obj.clarifyingQuestions)
          ? obj.clarifyingQuestions.map((q: any) => ({
              id: String(q.id ?? `q${Math.random().toString(36).slice(2, 7)}`),
              question: String(q.question ?? ""),
              reason: String(q.reason ?? ""),
              defaultAssumption: String(q.defaultAssumption ?? ""),
            }))
          : [],
        estimatedCostUsd: Number(obj.estimatedCostUsd ?? 0),
        estimatedTimeMin: Number(obj.estimatedTimeMin ?? 0),
        recommendation: (["proceed", "needs_clarification", "should_reconsider", "abort"].includes(obj.recommendation)
          ? obj.recommendation
          : "needs_clarification") as PlanAnalysis["recommendation"],
        recommendationReason: String(obj.recommendationReason ?? ""),
      };
    } catch {
      return this.heuristicAnalysis(originalPrompt, null);
    }
  }

  private parseTaskDecomposition(content: string): Array<{ taskId: string; objective: string; constraints: Record<string, unknown> }> {
    const jsonText = this.extractJson(content);
    if (!jsonText) {
      return [{ taskId: `task_${Date.now()}`, objective: "Single-task fallback", constraints: {} }];
    }
    try {
      const obj = JSON.parse(jsonText);
      if (!Array.isArray(obj.tasks)) return [];
      return obj.tasks.map((t: any) => ({
        taskId: String(t.taskId ?? `task_${Math.random().toString(36).slice(2, 7)}`),
        objective: String(t.objective ?? ""),
        constraints: (t.constraints as Record<string, unknown>) ?? {},
      }));
    } catch {
      return [];
    }
  }

  private heuristicAnalysis(prompt: string, scan: RepositoryScanResult | null): PlanAnalysis {
    return {
      understood: prompt.length > 10,
      summary: prompt.slice(0, 200),
      risks: [{
        severity: "medium",
        category: "general",
        description: "Manager could not run full risk analysis (LLM unavailable).",
        mitigation: "Manual review required before proceeding.",
      }],
      clarifyingQuestions: [{
        id: "q1",
        question: "What is the expected outcome of this task?",
        reason: "The request needs a clear success criterion.",
        defaultAssumption: "Standard implementation per repository conventions.",
      }],
      estimatedCostUsd: 0.05,
      estimatedTimeMin: 15,
      recommendation: "needs_clarification",
      recommendationReason: "Heuristic analysis — Manager LLM unavailable. Defaulting to conservative recommendation.",
    };
  }

  private fallbackAnalysisReport(scan: RepositoryScanResult): string {
    return [
      `# Repository Analysis Report`,
      ``,
      `## 1. Architecture Overview`,
      `${scan.repositoryFullName} is a ${scan.architectureStyle} project.`,
      `Primary languages: ${scan.languages.slice(0, 3).join(", ")}.`,
      `Detected frameworks: ${scan.frameworks.join(", ") || "none"}.`,
      ``,
      `## 2. Module Map`,
      `_Detailed module map requires deeper analysis (LLM unavailable in fallback mode)._`,
      ``,
      `## 3. Dependency Graph`,
      `_See package manifests in the repository for the dependency graph._`,
      ``,
      `## 4. Technical Debt (estimated)`,
      `- Conventions enforced: ${scan.conventions.join(", ") || "none"}`,
      `- Test layout: ${scan.testLayout}`,
      `- Linter: ${scan.linting.linter ?? "none"}`,
      `- Formatter: ${scan.linting.formatter ?? "none"}`,
      ``,
      `## 5. Hotspots`,
      `_Hotspot detection requires deeper analysis._`,
      ``,
      `## 6. Recommendations`,
      `- Add explicit conventions if missing`,
      `- Ensure tests cover critical paths`,
      `- Document architecture in .hades/architecture.md`,
    ].join("\n");
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

let _instance: ManagerPersonality | null = null;

export function getManagerPersonality(env: HadesBindings): ManagerPersonality {
  if (!_instance) _instance = new ManagerPersonality(env);
  return _instance;
}

// Re-export for convenience
export type { AgentRole };
