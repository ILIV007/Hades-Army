/**
 * Manager Hardening - Cloudflare Workers Edition
 * Hades Army v0.9.1 — Production Readiness
 *
 * Priority 6: Manager Hardening
 *
 * The Manager is NOT passive. Before any build, it must produce:
 *   - architecture impact
 *   - risk score
 *   - affected files (predicted)
 *   - estimated tokens
 *   - estimated cost
 *
 * The Manager should also:
 *   - detect bad ideas
 *   - challenge assumptions
 *   - estimate complexity
 *   - detect scope explosion
 *   - reject dangerous requests
 *
 * This module wraps the ManagerPersonality (v0.9) with a pre-build
 * analysis layer. Output is a `PreBuildAnalysis` that the Manager
 * uses to decide whether to proceed, replan, or abort.
 */

import { logger } from "../utils/logger";
import { ModelRegistry } from "../registry/model-registry";
import type { HadesBindings } from "../types";
import type { RepositoryAnalysis } from "../memory/repository-analyzer";

// ============================================
// Types
// ============================================

export interface AffectedFilePrediction {
  path: string;
  reason: string;
  /** 0-1 confidence that this file will be modified */
  confidence: number;
  /** risk of breaking changes if this file is modified */
  risk: "low" | "medium" | "high";
}

export interface PreBuildAnalysis {
  /** true if the request is safe to execute */
  safe: boolean;
  /** true if the request is too vague / large / dangerous */
  reject: boolean;
  rejectReason?: string;
  /** 0-100 — higher = more risky */
  riskScore: number;
  /** 0-100 — higher = larger scope */
  complexityScore: number;
  /** 0-100 — higher = more files affected */
  blastRadius: number;
  architectureImpact: {
    summary: string;
    modulesAffected: string[];
    conventionsAffected: string[];
    breaking: boolean;
  };
  affectedFiles: AffectedFilePrediction[];
  estimatedTokens: {
    input: number;
    output: number;
    total: number;
  };
  estimatedCostUsd: number;
  estimatedTimeMin: number;
  /** Manager's clarifying questions (if any) */
  clarifyingQuestions: string[];
  /** Manager's overall recommendation */
  recommendation: "proceed" | "needs_clarification" | "should_reconsider" | "abort";
  recommendationReason: string;
  /** danger flags detected */
  dangerFlags: string[];
}

// ============================================
// Manager Hardening Service
// ============================================

const DANGER_KEYWORDS = [
  // destructive operations
  "drop table", "drop database", "delete from", "truncate",
  "rm -rf", "force delete", "wipe",
  // security-sensitive
  "disable auth", "remove authentication", "skip auth",
  "hardcoded password", "hardcoded token", "hardcoded secret",
  // infrastructure
  "delete workflow", "delete ci", "disable ci",
  // scope
  "rewrite everything", "rewrite the whole", "replace all",
];

const SCOPE_EXPLOSION_KEYWORDS = [
  "and also", "while you're at it", "by the way",
  "also change", "also update", "also fix",
  "everything", "all files", "all functions",
];

export class ManagerHardening {
  private env: HadesBindings;
  private registry: ModelRegistry;

  constructor(env: HadesBindings) {
    this.env = env;
    this.registry = ModelRegistry.getInstance(env);
  }

  /**
   * Run pre-build analysis. The Manager MUST call this before
   * decomposing a request into Builder tasks.
   */
  async analyze(
    userPrompt: string,
    repoAnalysis: RepositoryAnalysis,
  ): Promise<PreBuildAnalysis> {
    logger.info(`ManagerHardening: analyzing request (${userPrompt.length} chars)`);

    // Run heuristic checks first (always available, no LLM needed)
    const dangerFlags = this.detectDangerFlags(userPrompt);
    const scopeFlags = this.detectScopeExplosion(userPrompt);
    const affectedFiles = this.predictAffectedFiles(userPrompt, repoAnalysis);
    const complexityScore = this.estimateComplexity(userPrompt, affectedFiles);
    const blastRadius = this.estimateBlastRadius(affectedFiles, repoAnalysis);
    const riskScore = this.estimateRisk(dangerFlags, complexityScore, blastRadius, repoAnalysis);
    const estimatedTokens = this.estimateTokens(userPrompt, affectedFiles);
    const estimatedCostUsd = this.estimateCost(estimatedTokens);
    const estimatedTimeMin = this.estimateTime(complexityScore, affectedFiles.length);

    // Try LLM-driven analysis for architecture impact + clarifying questions
    let architectureImpact: PreBuildAnalysis["architectureImpact"];
    let clarifyingQuestions: string[];
    let recommendation: PreBuildAnalysis["recommendation"];
    let recommendationReason: string;

    try {
      const llmAnalysis = await this.callLlmAnalysis(userPrompt, repoAnalysis);
      architectureImpact = llmAnalysis.architectureImpact;
      clarifyingQuestions = llmAnalysis.clarifyingQuestions;
      recommendation = llmAnalysis.recommendation;
      recommendationReason = llmAnalysis.recommendationReason;
    } catch (err) {
      logger.warn(`ManagerHardening: LLM analysis failed, using heuristics`, { err });
      architectureImpact = this.heuristicArchitectureImpact(userPrompt, repoAnalysis);
      clarifyingQuestions = this.heuristicQuestions(userPrompt);
      recommendation = this.heuristicRecommendation(dangerFlags, scopeFlags, riskScore);
      recommendationReason = "Heuristic analysis (LLM unavailable)";
    }

    // Override recommendation if danger flags are critical
    if (dangerFlags.length > 0) {
      recommendation = "abort";
      recommendationReason = `Dangerous request detected: ${dangerFlags.join(", ")}`;
    } else if (scopeFlags.length > 2 && recommendation !== "abort") {
      recommendation = "should_reconsider";
      recommendationReason = `Scope explosion detected: ${scopeFlags.length} indicators`;
    }

    const safe = recommendation === "proceed";
    const reject = recommendation === "abort";

    const result: PreBuildAnalysis = {
      safe,
      reject,
      rejectReason: reject ? recommendationReason : undefined,
      riskScore,
      complexityScore,
      blastRadius,
      architectureImpact,
      affectedFiles,
      estimatedTokens,
      estimatedCostUsd,
      estimatedTimeMin,
      clarifyingQuestions,
      recommendation,
      recommendationReason,
      dangerFlags,
    };

    logger.info(`ManagerHardening: analysis complete`, {
      safe, reject, riskScore, complexityScore, blastRadius,
      affectedFiles: affectedFiles.length,
      estimatedCostUsd,
      recommendation,
    });

    return result;
  }

  // ============================================
  // Heuristic checks
  // ============================================

  private detectDangerFlags(prompt: string): string[] {
    const lower = prompt.toLowerCase();
    return DANGER_KEYWORDS.filter((kw) => lower.includes(kw));
  }

  private detectScopeExplosion(prompt: string): string[] {
    const lower = prompt.toLowerCase();
    return SCOPE_EXPLOSION_KEYWORDS.filter((kw) => lower.includes(kw));
  }

  private predictAffectedFiles(prompt: string, repo: RepositoryAnalysis): AffectedFilePrediction[] {
    const predictions: AffectedFilePrediction[] = [];
    const lower = prompt.toLowerCase();

    // Match keywords in the prompt to hotspot files
    for (const hotspot of repo.hotspots.slice(0, 10)) {
      const baseName = hotspot.path.split("/").pop()?.replace(/\.\w+$/, "") ?? "";
      if (baseName && lower.includes(baseName.toLowerCase())) {
        predictions.push({
          path: hotspot.path,
          reason: `Matches hotspot file (score ${hotspot.attentionScore})`,
          confidence: 0.7,
          risk: hotspot.attentionScore > 50 ? "high" : "medium",
        });
      }
    }

    // Predict based on common patterns
    if (lower.includes("api") || lower.includes("endpoint") || lower.includes("route")) {
      predictions.push({
        path: "src/api/router.ts",
        reason: "API-related request",
        confidence: 0.5,
        risk: "medium",
      });
    }
    if (lower.includes("test")) {
      predictions.push({
        path: "tests/",
        reason: "Test-related request",
        confidence: 0.6,
        risk: "low",
      });
    }
    if (lower.includes("database") || lower.includes("schema") || lower.includes("migration")) {
      predictions.push({
        path: "src/database/schema.ts",
        reason: "Database-related request",
        confidence: 0.6,
        risk: "high",
      });
    }
    if (lower.includes("auth") || lower.includes("login") || lower.includes("token")) {
      predictions.push({
        path: "src/middleware/auth.ts",
        reason: "Auth-related request",
        confidence: 0.6,
        risk: "high",
      });
    }

    // Deduplicate
    const seen = new Set<string>();
    return predictions.filter((p) => {
      if (seen.has(p.path)) return false;
      seen.add(p.path);
      return true;
    }).slice(0, 10);
  }

  private estimateComplexity(prompt: string, affectedFiles: AffectedFilePrediction[]): number {
    let score = 10; // base
    score += Math.min(40, prompt.length / 20);
    score += affectedFiles.length * 5;
    score += affectedFiles.filter((f) => f.risk === "high").length * 10;
    return Math.min(100, Math.round(score));
  }

  private estimateBlastRadius(affectedFiles: AffectedFilePrediction[], repo: RepositoryAnalysis): number {
    if (affectedFiles.length === 0) return 5;
    let score = affectedFiles.length * 8;
    score += affectedFiles.filter((f) => f.risk === "high").length * 15;
    score += affectedFiles.filter((f) => f.risk === "medium").length * 5;
    // Bigger blast radius if repo already has high debt
    if (repo.technicalDebt.length > 30) score += 10;
    return Math.min(100, Math.round(score));
  }

  private estimateRisk(
    dangerFlags: string[],
    complexity: number,
    blastRadius: number,
    repo: RepositoryAnalysis,
  ): number {
    let score = 10;
    score += dangerFlags.length * 30;
    score += Math.round(complexity * 0.3);
    score += Math.round(blastRadius * 0.3);
    if (repo.healthScore < 50) score += 15;
    if (repo.technicalDebt.length > 50) score += 10;
    return Math.min(100, Math.round(score));
  }

  private estimateTokens(prompt: string, affectedFiles: AffectedFilePrediction[]): { input: number; output: number; total: number } {
    // Rough: 1 token ≈ 4 chars
    const inputTokens = Math.ceil(prompt.length / 4) + (affectedFiles.length * 500);
    const outputTokens = Math.min(8000, Math.max(500, affectedFiles.length * 800));
    return {
      input: inputTokens,
      output: outputTokens,
      total: inputTokens + outputTokens,
    };
  }

  private estimateCost(tokens: { input: number; output: number; total: number }): number {
    // Manager (Gemini) for analysis + Builder (Qwen3) for patch + Reviewer (DeepSeek) for review
    const managerCost = this.registry.estimateCostUsd("manager", tokens.input, 500);
    const builderCost = this.registry.estimateCostUsd("builder", tokens.input, tokens.output);
    const reviewerCost = this.registry.estimateCostUsd("reviewer", tokens.output, 1000);
    return Math.round((managerCost + builderCost + reviewerCost) * 1_000_000) / 1_000_000;
  }

  private estimateTime(complexity: number, affectedFiles: number): number {
    return Math.max(2, Math.round(complexity / 5 + affectedFiles.length * 2));
  }

  // ============================================
  // Heuristic fallbacks
  // ============================================

  private heuristicArchitectureImpact(_prompt: string, repo: RepositoryAnalysis): PreBuildAnalysis["architectureImpact"] {
    return {
      summary: `Heuristic analysis. Repository style: ${repo.architecturePattern}.`,
      modulesAffected: repo.hotspots.slice(0, 3).map((h) => h.path),
      conventionsAffected: repo.scan.conventions.slice(0, 3),
      breaking: false,
    };
  }

  private heuristicQuestions(prompt: string): string[] {
    const questions: string[] = [];
    if (prompt.length < 30) {
      questions.push("Could you provide more detail about what you want to achieve?");
    }
    if (!/\b(test|spec)\b/i.test(prompt)) {
      questions.push("Should this change include test coverage?");
    }
    if (!/\b(breaking|backward)\b/i.test(prompt)) {
      questions.push("Are there backward-compatibility constraints?");
    }
    return questions.slice(0, 3);
  }

  private heuristicRecommendation(dangerFlags: string[], scopeFlags: string[], riskScore: number): PreBuildAnalysis["recommendation"] {
    if (dangerFlags.length > 0) return "abort";
    if (scopeFlags.length > 2) return "should_reconsider";
    if (riskScore > 60) return "should_reconsider";
    if (riskScore > 30) return "needs_clarification";
    return "proceed";
  }

  // ============================================
  // LLM-driven analysis
  // ============================================

  private async callLlmAnalysis(
    prompt: string,
    repo: RepositoryAnalysis,
  ): Promise<{
    architectureImpact: PreBuildAnalysis["architectureImpact"];
    clarifyingQuestions: string[];
    recommendation: PreBuildAnalysis["recommendation"];
    recommendationReason: string;
  }> {
    const llmPrompt = [
      `You are the Hades Army Manager (Senior Technical Architect).`,
      `Analyze this user request for architecture impact, risk, and clarifying questions.`,
      ``,
      `Repository: ${repo.scan.repositoryFullName}`,
      `Style: ${repo.architecturePattern}`,
      `Languages: ${repo.scan.languages.join(", ")}`,
      `Frameworks: ${repo.scan.frameworks.join(", ")}`,
      `Health score: ${repo.healthScore}/100`,
      `Top hotspots: ${repo.hotspots.slice(0, 5).map((h) => h.path).join(", ")}`,
      ``,
      `User request:`,
      prompt,
      ``,
      `Return ONLY JSON:`,
      `{`,
      `  "architectureImpact": { "summary": "...", "modulesAffected": [...], "conventionsAffected": [...], "breaking": bool },`,
      `  "clarifyingQuestions": ["...","..."],`,
      `  "recommendation": "proceed"|"needs_clarification"|"should_reconsider"|"abort",`,
      `  "recommendationReason": "..."`,
      `}`,
    ].join("\n");

    const response = await this.registry.generateForAgent("manager", llmPrompt, {
      maxTokens: 1024,
      temperature: 0.3,
    });

    // Parse JSON
    const jsonText = this.extractJson(response.content);
    if (!jsonText) {
      throw new Error("Manager LLM did not return JSON");
    }
    const obj = JSON.parse(jsonText);
    return {
      architectureImpact: {
        summary: String(obj.architectureImpact?.summary ?? ""),
        modulesAffected: Array.isArray(obj.architectureImpact?.modulesAffected)
          ? obj.architectureImpact.modulesAffected.map(String) : [],
        conventionsAffected: Array.isArray(obj.architectureImpact?.conventionsAffected)
          ? obj.architectureImpact.conventionsAffected.map(String) : [],
        breaking: Boolean(obj.architectureImpact?.breaking),
      },
      clarifyingQuestions: Array.isArray(obj.clarifyingQuestions)
        ? obj.clarifyingQuestions.map(String).slice(0, 5) : [],
      recommendation: (["proceed","needs_clarification","should_reconsider","abort"].includes(obj.recommendation)
        ? obj.recommendation : "needs_clarification") as PreBuildAnalysis["recommendation"],
      recommendationReason: String(obj.recommendationReason ?? ""),
    };
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

let _instance: ManagerHardening | null = null;

export function getManagerHardening(env: HadesBindings): ManagerHardening {
  if (!_instance) _instance = new ManagerHardening(env);
  return _instance;
}
