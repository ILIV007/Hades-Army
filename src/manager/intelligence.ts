/**
 * Manager Intelligence - Cloudflare Workers Edition
 * Hades Army v9.3 — Platform Hardening & Intelligence Upgrade
 *
 * Priority 1: Manager Intelligence Upgrade
 *
 * Transforms the Manager from a dispatcher into a Strategic Engineering
 * Manager. Before every build, the Manager evaluates 8 dimensions and
 * produces a decision package:
 *
 *   - Architecture impact
 *   - Repository complexity
 *   - Estimated implementation cost
 *   - Estimated token usage
 *   - Risk level
 *   - Security impact
 *   - Breaking change probability
 *   - Required approvals
 *
 * Output:
 *   - Complexity Score (0-100)
 *   - Risk Score (0-100)
 *   - Architecture Score (0-100)
 *   - Estimated Time (minutes)
 *   - Estimated Tokens (input + output)
 *   - Estimated Cost (USD)
 *   - Recommendation (continue | clarify | reject | approve | split)
 *
 * The Manager also proactively suggests improvements instead of waiting
 * for instructions.
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import { ModelRegistry } from "../registry/model-registry";
import type { HadesBindings } from "../types";
import type { RepositoryAnalysis } from "../memory/repository-analyzer";

// ============================================
// Types
// ============================================

export interface IntelligenceInput {
  userPrompt: string;
  repositoryAnalysis: RepositoryAnalysis;
  predictedAffectedFiles: string[];
  /** existing memory of past failures for this project */
  pastFailures: Array<{ summary: string; lesson: string }>;
}

export type RecommendationType =
  | "continue"
  | "request_clarification"
  | "reject_request"
  | "request_approval"
  | "split_into_smaller_tasks";

export interface IntelligenceScores {
  complexity: number;       // 0-100
  risk: number;             // 0-100
  architecture: number;     // 0-100 (higher = better-aligned with arch)
  security: number;         // 0-100 (higher = more secure)
  breakingChange: number;   // 0-100 (probability)
}

export interface IntelligenceEstimates {
  timeMinutes: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface ManagerDecision {
  id: string;
  scores: IntelligenceScores;
  estimates: IntelligenceEstimates;
  recommendation: RecommendationType;
  reason: string;
  requiredApprovals: string[];
  proactiveSuggestions: string[];
  /** if recommendation === split, this contains the sub-tasks */
  subTasks?: Array<{ objective: string; estimatedTokens: number }>;
  createdAt: string;
}

// ============================================
// Sensitive file categories (for security impact)
// ============================================

const SECURITY_SENSITIVE_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /\/auth\/|auth\.ts$|login\.ts$|password/i, weight: 30 },
  { pattern: /\.env$|secrets?\/|credentials/i, weight: 40 },
  { pattern: /\/database\/|schema\.ts$|migration/i, weight: 20 },
  { pattern: /payment|stripe|paypal|billing/i, weight: 35 },
  { pattern: /jwt|token.*verify|crypto/i, weight: 25 },
  { pattern: /wrangler\.toml|\.github\/workflows\//i, weight: 15 },
];

// ============================================
// Manager Intelligence Service
// ============================================

export class ManagerIntelligence {
  private env: HadesBindings;
  private registry: ModelRegistry;

  constructor(env: HadesBindings) {
    this.env = env;
    this.registry = ModelRegistry.getInstance(env);
  }

  /**
   * Evaluate a user request before any build starts. Returns a full
   * decision package the Manager uses to decide next action.
   */
  async evaluate(input: IntelligenceInput): Promise<ManagerDecision> {
    logger.info("ManagerIntelligence: evaluating request", {
      promptLength: input.userPrompt.length,
      affectedFiles: input.predictedAffectedFiles.length,
      pastFailures: input.pastFailures.length,
    });

    const scores = this.computeScores(input);
    const estimates = this.computeEstimates(input, scores);
    const requiredApprovals = this.determineApprovals(scores, input);
    const proactiveSuggestions = this.generateSuggestions(input, scores);
    const recommendation = this.decide(scores, input);
    const reason = this.explain(recommendation, scores);
    const subTasks = recommendation === "split_into_smaller_tasks"
      ? this.splitTasks(input)
      : undefined;

    const decision: ManagerDecision = {
      id: generateId("mgr-decision"),
      scores,
      estimates,
      recommendation,
      reason,
      requiredApprovals,
      proactiveSuggestions,
      subTasks,
      createdAt: new Date().toISOString(),
    };

    logger.info("ManagerIntelligence: decision", {
      id: decision.id,
      recommendation,
      complexity: scores.complexity,
      risk: scores.risk,
      costUsd: estimates.costUsd,
    });

    return decision;
  }

  // ============================================
  // Scoring
  // ============================================

  private computeScores(input: IntelligenceInput): IntelligenceScores {
    return {
      complexity: this.scoreComplexity(input),
      risk: this.scoreRisk(input),
      architecture: this.scoreArchitecture(input),
      security: this.scoreSecurity(input),
      breakingChange: this.scoreBreakingChange(input),
    };
  }

  private scoreComplexity(input: IntelligenceInput): number {
    let score = 10;
    score += Math.min(20, input.userPrompt.length / 50);
    score += Math.min(25, input.predictedAffectedFiles.length * 3);
    score += input.predictedAffectedFiles.length > 5 ? 15 : 0;
    if (input.repositoryAnalysis.healthScore < 50) score += 15;
    if (input.repositoryAnalysis.technicalDebt.length > 30) score += 8;
    return Math.min(100, Math.round(score));
  }

  private scoreRisk(input: IntelligenceInput): number {
    let score = 10;
    // Sensitive files add risk
    for (const file of input.predictedAffectedFiles) {
      for (const { pattern, weight } of SECURITY_SENSITIVE_PATTERNS) {
        if (pattern.test(file)) {
          score += weight;
          break;
        }
      }
    }
    // Past failures add risk
    score += Math.min(20, input.pastFailures.length * 4);
    // Low repo health adds risk
    if (input.repositoryAnalysis.healthScore < 50) score += 15;
    // Cross-cutting changes add risk
    if (input.predictedAffectedFiles.length > 8) score += 10;
    return Math.min(100, Math.round(score));
  }

  private scoreArchitecture(input: IntelligenceInput): number {
    // Higher = better aligned with architecture
    let score = 70;
    // Penalize if touching entry points
    if (input.predictedAffectedFiles.some((f) => /src\/index\.ts$|src\/main\.ts$/.test(f))) {
      score -= 20;
    }
    // Penalize if cross-cutting
    const areas = new Set<string>();
    for (const f of input.predictedAffectedFiles) {
      if (/\.tsx?$|\.css$/.test(f)) areas.add("frontend");
      if (/\/api\/|server\./.test(f)) areas.add("backend");
      if (/\/database\/|schema/.test(f)) areas.add("database");
      if (/wrangler|terraform/.test(f)) areas.add("infra");
    }
    if (areas.size > 2) score -= 15;
    // Bonus if conventions are followed
    if (input.repositoryAnalysis.scan.conventions.length > 2) score += 10;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private scoreSecurity(input: IntelligenceInput): number {
    // Higher = more secure (less risky)
    let score = 90;
    for (const file of input.predictedAffectedFiles) {
      if (/\.env$|secrets?\//i.test(file)) {
        score -= 50;  // big penalty
      } else if (/\/auth\/|password|crypto/i.test(file)) {
        score -= 20;
      } else if (/payment|stripe/i.test(file)) {
        score -= 15;
      }
    }
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private scoreBreakingChange(input: IntelligenceInput): number {
    // Probability of breaking changes (0-100, higher = more likely)
    let score = 10;
    if (input.predictedAffectedFiles.some((f) => /schema\.ts$|migration/.test(f))) score += 40;
    if (input.predictedAffectedFiles.some((f) => /src\/index\.ts$|src\/main\.ts$/.test(f))) score += 25;
    if (input.predictedAffectedFiles.some((f) => /\/api\/router/.test(f))) score += 20;
    if (input.predictedAffectedFiles.some((f) => /\/middleware\//.test(f))) score += 15;
    return Math.min(100, Math.round(score));
  }

  // ============================================
  // Estimates
  // ============================================

  private computeEstimates(input: IntelligenceInput, scores: IntelligenceScores): IntelligenceEstimates {
    const tokensIn = Math.ceil(input.userPrompt.length / 4)
      + input.predictedAffectedFiles.length * 500
      + input.repositoryAnalysis.scan.relevantFiles.length * 200;
    const tokensOut = Math.min(8000, Math.max(500, input.predictedAffectedFiles.length * 800));
    const timeMinutes = Math.max(2, Math.round(scores.complexity / 5 + input.predictedAffectedFiles.length * 2));

    // Cost = Manager (planning) + Builder (patch) + Reviewer (review)
    const managerCost = this.registry.estimateCostUsd("manager", tokensIn, 500);
    const builderCost = this.registry.estimateCostUsd("builder", tokensIn, tokensOut);
    const reviewerCost = this.registry.estimateCostUsd("reviewer", tokensOut, 1000);
    const costUsd = Math.round((managerCost + builderCost + reviewerCost) * 1_000_000) / 1_000_000;

    return { timeMinutes, tokensIn, tokensOut, costUsd };
  }

  // ============================================
  // Approvals
  // ============================================

  private determineApprovals(scores: IntelligenceScores, _input: IntelligenceInput): string[] {
    const approvals: string[] = [];
    if (scores.risk >= 60) approvals.push("user_explicit_approval");
    if (scores.security < 60) approvals.push("security_review");
    if (scores.breakingChange >= 50) approvals.push("breaking_change_acknowledgment");
    if (scores.complexity >= 80) approvals.push("architecture_review");
    return approvals;
  }

  // ============================================
  // Proactive suggestions
  // ============================================

  private generateSuggestions(input: IntelligenceInput, scores: IntelligenceScores): string[] {
    const suggestions: string[] = [];
    if (input.repositoryAnalysis.scan.testLayout === "none") {
      suggestions.push("Add test coverage for the affected files — repository currently has no tests.");
    }
    if (input.repositoryAnalysis.technicalDebt.length > 20) {
      suggestions.push(`Address ${input.repositoryAnalysis.technicalDebt.length} existing technical-debt markers before adding more code.`);
    }
    if (scores.breakingChange >= 50) {
      suggestions.push("This change is likely breaking — consider a deprecation path or feature flag.");
    }
    if (input.predictedAffectedFiles.length > 5) {
      suggestions.push("Split this into multiple smaller PRs to reduce review burden.");
    }
    if (input.pastFailures.length > 0) {
      suggestions.push(`Review ${input.pastFailures.length} past failure(s) for similar work — avoid repeating rejected approaches.`);
    }
    if (input.repositoryAnalysis.scan.linting.linter === undefined) {
      suggestions.push("Add ESLint to enforce code quality before this change.");
    }
    return suggestions;
  }

  // ============================================
  // Decision
  // ============================================

  private decide(scores: IntelligenceScores, input: IntelligenceInput): RecommendationType {
    // Hard rejects
    if (scores.security < 30) return "reject_request";
    if (input.predictedAffectedFiles.some((f) => /\.env$|^secrets?\//i.test(f))) {
      return "reject_request";
    }
    // Split if too big
    if (scores.complexity >= 80 && input.predictedAffectedFiles.length > 8) {
      return "split_into_smaller_tasks";
    }
    // Approval required
    if (scores.risk >= 60 || scores.breakingChange >= 50) {
      return "request_approval";
    }
    // Clarification needed
    if (input.userPrompt.length < 30 || scores.complexity >= 60) {
      return "request_clarification";
    }
    return "continue";
  }

  private explain(rec: RecommendationType, scores: IntelligenceScores): string {
    switch (rec) {
      case "continue":
        return `Low risk (${scores.risk}/100), manageable complexity (${scores.complexity}/100). Proceeding with build.`;
      case "request_clarification":
        return `Complexity is high (${scores.complexity}/100) or prompt is vague. Need clarification before committing resources.`;
      case "reject_request":
        return `Security score too low (${scores.security}/100) or request targets forbidden paths. Refusing to execute.`;
      case "request_approval":
        return `Risk (${scores.risk}/100) or breaking-change probability (${scores.breakingChange}/100) requires explicit user approval before build.`;
      case "split_into_smaller_tasks":
        return `Complexity (${scores.complexity}/100) and file count too high. Splitting into smaller, reviewable tasks.`;
    }
  }

  // ============================================
  // Task splitting
  // ============================================

  private splitTasks(input: IntelligenceInput): Array<{ objective: string; estimatedTokens: number }> {
    // Group affected files by directory
    const groups = new Map<string, string[]>();
    for (const file of input.predictedAffectedFiles) {
      const dir = file.split("/").slice(0, 2).join("/") || "root";
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir)!.push(file);
    }
    return Array.from(groups.entries()).map(([dir, files]) => ({
      objective: `Update files in ${dir}: ${files.join(", ")}`,
      estimatedTokens: files.length * 800,
    }));
  }

  // ============================================
  // Render for Telegram
  // ============================================

  render(decision: ManagerDecision): string {
    const icon = (s: number) => s >= 70 ? "🟢" : s >= 40 ? "🟡" : "🔴";
    const lines: string[] = [
      `🧠 *Manager Decision*`,
      ``,
      `*Scores:*`,
      `${icon(100 - decision.scores.complexity)} Complexity: ${decision.scores.complexity}/100`,
      `${icon(100 - decision.scores.risk)} Risk: ${decision.scores.risk}/100`,
      `${icon(decision.scores.architecture)} Architecture: ${decision.scores.architecture}/100`,
      `${icon(decision.scores.security)} Security: ${decision.scores.security}/100`,
      `${icon(100 - decision.scores.breakingChange)} Breaking change: ${decision.scores.breakingChange}%`,
      ``,
      `*Estimates:*`,
      `⏱ Time: ~${decision.estimates.timeMinutes} min`,
      `🔤 Tokens: ${decision.estimates.tokensIn.toLocaleString()} in / ${decision.estimates.tokensOut.toLocaleString()} out`,
      `💰 Cost: $${decision.estimates.costUsd.toFixed(4)}`,
      ``,
      `*Recommendation:* ${decision.recommendation.replace(/_/g, " ")}`,
      `_${decision.reason}_`,
    ];

    if (decision.requiredApprovals.length > 0) {
      lines.push(``);
      lines.push(`*Required approvals:*`);
      for (const a of decision.requiredApprovals) lines.push(`• ${a.replace(/_/g, " ")}`);
    }
    if (decision.proactiveSuggestions.length > 0) {
      lines.push(``);
      lines.push(`*Proactive suggestions:*`);
      for (const s of decision.proactiveSuggestions) lines.push(`💡 ${s}`);
    }
    if (decision.subTasks && decision.subTasks.length > 0) {
      lines.push(``);
      lines.push(`*Sub-tasks (${decision.subTasks.length}):*`);
      decision.subTasks.forEach((t, i) => lines.push(`${i + 1}. ${t.objective}`));
    }
    return lines.join("\n");
  }
}

// ============================================
// Factory
// ============================================

let _instance: ManagerIntelligence | null = null;

export function getManagerIntelligence(env: HadesBindings): ManagerIntelligence {
  if (!_instance) _instance = new ManagerIntelligence(env);
  return _instance;
}
