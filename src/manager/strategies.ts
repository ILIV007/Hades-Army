/**
 * Plan Strategies - Cloudflare Workers Edition
 * Hades Army v9.3 — PLAN Mode Upgrade
 *
 * Priority 5: PLAN Mode Upgrade
 *
 * For each planning request, the Manager generates AT LEAST 3 strategies:
 *
 *   Fast       — minimal change, lowest cost, accepts some technical debt
 *   Balanced   — production-ready, moderate cost, follows conventions
 *   Enterprise — bullet-proof, highest cost, full tests + docs + rollback
 *
 * Each strategy includes:
 *   - Implementation phases
 *   - Affected files
 *   - Risk analysis
 *   - Estimated PR size
 *   - Estimated duration
 *   - Estimated token usage
 *   - Rollback strategy
 *   - Alternative implementation notes
 *
 * User chooses one before Build can start.
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import { ModelRegistry } from "../registry/model-registry";
import type { HadesBindings } from "../types";
import type { ManagerDecision } from "./intelligence";
import type { RepositoryAnalysis } from "../memory/repository-analyzer";

// ============================================
// Types
// ============================================

export type StrategyType = "fast" | "balanced" | "enterprise";

export interface ImplementationPhase {
  name: string;
  description: string;
  estimatedMinutes: number;
  filesAffected: string[];
}

export interface PlanStrategy {
  id: string;
  type: StrategyType;
  label: string;
  emoji: string;
  tagline: string;
  description: string;
  phases: ImplementationPhase[];
  affectedFiles: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  estimatedPrSize: { additions: number; deletions: number };
  estimatedDurationMin: number;
  estimatedTokens: { input: number; output: number };
  estimatedCostUsd: number;
  rollbackStrategy: string;
  alternatives: string[];
  pros: string[];
  cons: string[];
}

export interface PlanPackage {
  id: string;
  userPrompt: string;
  decision: ManagerDecision;
  strategies: PlanStrategy[];
  recommendedStrategy: StrategyType;
  createdAt: string;
}

// ============================================
// Strategy generator
// ============================================

export class PlanStrategyGenerator {
  private env: HadesBindings;
  private registry: ModelRegistry;

  constructor(env: HadesBindings) {
    this.env = env;
    this.registry = ModelRegistry.getInstance(env);
  }

  /**
   * Generate 3 strategies (Fast / Balanced / Enterprise) for a given
   * decision + repository context.
   */
  async generate(
    userPrompt: string,
    decision: ManagerDecision,
    repo: RepositoryAnalysis,
    predictedFiles: string[],
  ): Promise<PlanPackage> {
    logger.info("PlanStrategyGenerator: generating 3 strategies", {
      promptLength: userPrompt.length,
      predictedFiles: predictedFiles.length,
    });

    const baseFiles = predictedFiles.length > 0
      ? predictedFiles
      : this.heuristicFiles(userPrompt, repo);

    const fast = this.buildFastStrategy(userPrompt, decision, baseFiles);
    const balanced = this.buildBalancedStrategy(userPrompt, decision, baseFiles, repo);
    const enterprise = this.buildEnterpriseStrategy(userPrompt, decision, baseFiles, repo);

    // Recommendation: balanced by default, fast if low risk, enterprise if breaking
    let recommended: StrategyType = "balanced";
    if (decision.scores.risk < 30 && decision.scores.complexity < 50) {
      recommended = "fast";
    } else if (decision.scores.breakingChange >= 50 || decision.scores.risk >= 60) {
      recommended = "enterprise";
    }

    return {
      id: generateId("plan"),
      userPrompt,
      decision,
      strategies: [fast, balanced, enterprise],
      recommendedStrategy: recommended,
      createdAt: new Date().toISOString(),
    };
  }

  // ============================================
  // Fast strategy
  // ============================================

  private buildFastStrategy(
    prompt: string,
    decision: ManagerDecision,
    files: string[],
  ): PlanStrategy {
    const tokensIn = Math.ceil(prompt.length / 4) + files.length * 300;
    const tokensOut = files.length * 500;
    const cost = this.registry.estimateCostUsd("builder", tokensIn, tokensOut)
      + this.registry.estimateCostUsd("reviewer", tokensOut, 500);

    return {
      id: generateId("strat-fast"),
      type: "fast",
      label: "Fast",
      emoji: "⚡",
      tagline: "Minimal change, lowest cost",
      description: "Smallest possible patch that solves the immediate request. Accepts some technical debt. Best for low-risk, well-understood changes.",
      phases: [
        {
          name: "Direct implementation",
          description: "Builder produces the minimal patch in a single pass.",
          estimatedMinutes: Math.max(5, decision.estimates.timeMinutes / 2),
          filesAffected: files,
        },
        {
          name: "Quick review",
          description: "Reviewer runs the standard 7-stage pipeline.",
          estimatedMinutes: 3,
          filesAffected: files,
        },
      ],
      affectedFiles: files,
      riskLevel: decision.scores.risk >= 60 ? "high" : decision.scores.risk >= 30 ? "medium" : "low",
      estimatedPrSize: { additions: files.length * 30, deletions: files.length * 5 },
      estimatedDurationMin: Math.max(8, Math.round(decision.estimates.timeMinutes * 0.6)),
      estimatedTokens: { input: tokensIn, output: tokensOut },
      estimatedCostUsd: Math.round(cost * 1_000_000) / 1_000_000,
      rollbackStrategy: "Revert the single commit. No migration needed.",
      alternatives: [
        "Use a feature flag to roll out gradually",
        "Stub the change behind an interface for later swap",
      ],
      pros: ["Fastest delivery", "Lowest cost", "Smallest PR (easier review)"],
      cons: ["May incur technical debt", "Limited test coverage", "No documentation"],
    };
  }

  // ============================================
  // Balanced strategy
  // ============================================

  private buildBalancedStrategy(
    prompt: string,
    decision: ManagerDecision,
    files: string[],
    repo: RepositoryAnalysis,
  ): PlanStrategy {
    const testFiles = repo.scan.testLayout === "none"
      ? files.map((f) => f.replace(/\.(ts|tsx|js|jsx)$/, ".test$&"))
      : [];
    const allFiles = [...files, ...testFiles];
    const tokensIn = Math.ceil(prompt.length / 4) + allFiles.length * 400;
    const tokensOut = allFiles.length * 700;
    const cost = this.registry.estimateCostUsd("builder", tokensIn, tokensOut)
      + this.registry.estimateCostUsd("reviewer", tokensOut, 800)
      + this.registry.estimateCostUsd("manager", tokensIn, 300);

    return {
      id: generateId("strat-balanced"),
      type: "balanced",
      label: "Balanced",
      emoji: "⚖️",
      tagline: "Production-ready, follows conventions",
      description: "Implements the change following existing conventions, adds test coverage, updates relevant docs. Best for most production work.",
      phases: [
        {
          name: "Implementation",
          description: "Builder produces the patch following repo conventions.",
          estimatedMinutes: Math.round(decision.estimates.timeMinutes * 0.5),
          filesAffected: files,
        },
        {
          name: "Test coverage",
          description: repo.scan.testLayout === "none"
            ? "Add new test files (none exist yet)."
            : "Extend existing test suite.",
          estimatedMinutes: Math.round(decision.estimates.timeMinutes * 0.2),
          filesAffected: testFiles,
        },
        {
          name: "Documentation",
          description: "Update relevant docs (README, code comments).",
          estimatedMinutes: 5,
          filesAffected: ["README.md"],
        },
        {
          name: "Full review",
          description: "Reviewer runs the 7-stage pipeline with architecture check.",
          estimatedMinutes: 8,
          filesAffected: allFiles,
        },
      ],
      affectedFiles: allFiles,
      riskLevel: decision.scores.risk >= 60 ? "high" : decision.scores.risk >= 30 ? "medium" : "low",
      estimatedPrSize: { additions: allFiles.length * 40, deletions: allFiles.length * 8 },
      estimatedDurationMin: Math.round(decision.estimates.timeMinutes * 0.9),
      estimatedTokens: { input: tokensIn, output: tokensOut },
      estimatedCostUsd: Math.round(cost * 1_000_000) / 1_000_000,
      rollbackStrategy: "Revert the merge commit. Tests ensure no regression on rollback.",
      alternatives: [
        "Split into 2 PRs (impl + tests) if PR gets too large",
        "Use a feature branch with gradual rollout",
      ],
      pros: ["Production-ready", "Test coverage included", "Follows conventions", "Reasonable cost"],
      cons: ["Slower than Fast", "More files to review"],
    };
  }

  // ============================================
  // Enterprise strategy
  // ============================================

  private buildEnterpriseStrategy(
    prompt: string,
    decision: ManagerDecision,
    files: string[],
    repo: RepositoryAnalysis,
  ): PlanStrategy {
    const testFiles = files.map((f) => f.replace(/\.(ts|tsx|js|jsx)$/, ".test$&"));
    const integrationTestFiles = files.map((f) => f.replace(/\.(ts|tsx|js|jsx)$/, ".integration.test$&"));
    const docFiles = ["docs/architecture.md", "docs/decisions.md", "README.md"];
    const allFiles = [...files, ...testFiles, ...integrationTestFiles, ...docFiles];
    const tokensIn = Math.ceil(prompt.length / 4) + allFiles.length * 500;
    const tokensOut = allFiles.length * 1000;
    const cost = this.registry.estimateCostUsd("manager", tokensIn, 800)
      + this.registry.estimateCostUsd("builder", tokensIn, tokensOut)
      + this.registry.estimateCostUsd("reviewer", tokensOut, 1500)
      + this.registry.estimateCostUsd("manager", tokensOut, 500);

    return {
      id: generateId("strat-enterprise"),
      type: "enterprise",
      label: "Enterprise",
      emoji: "🏛",
      tagline: "Bullet-proof, full tests + docs + rollback",
      description: "Comprehensive implementation with full test coverage (unit + integration), updated architecture docs, ADR (Architecture Decision Record), rollback runbook. Best for breaking changes or critical paths.",
      phases: [
        {
          name: "Architecture review",
          description: "Manager reviews architecture impact and records an ADR.",
          estimatedMinutes: 10,
          filesAffected: ["docs/decisions.md"],
        },
        {
          name: "Implementation",
          description: "Builder produces the patch with backward compatibility.",
          estimatedMinutes: Math.round(decision.estimates.timeMinutes * 0.6),
          filesAffected: files,
        },
        {
          name: "Unit tests",
          description: "Add comprehensive unit tests for all changed code paths.",
          estimatedMinutes: Math.round(decision.estimates.timeMinutes * 0.3),
          filesAffected: testFiles,
        },
        {
          name: "Integration tests",
          description: "Add integration tests covering the change end-to-end.",
          estimatedMinutes: 15,
          filesAffected: integrationTestFiles,
        },
        {
          name: "Documentation",
          description: "Update architecture docs, ADR, and README.",
          estimatedMinutes: 15,
          filesAffected: docFiles,
        },
        {
          name: "Deep review",
          description: "Reviewer runs full pipeline + security audit + architecture compliance.",
          estimatedMinutes: 20,
          filesAffected: allFiles,
        },
        {
          name: "Rollback preparation",
          description: "Prepare and document rollback runbook.",
          estimatedMinutes: 5,
          filesAffected: ["docs/rollback.md"],
        },
      ],
      affectedFiles: allFiles,
      riskLevel: decision.scores.risk >= 80 ? "critical" : decision.scores.risk >= 50 ? "high" : "medium",
      estimatedPrSize: { additions: allFiles.length * 60, deletions: allFiles.length * 10 },
      estimatedDurationMin: Math.round(decision.estimates.timeMinutes * 1.5),
      estimatedTokens: { input: tokensIn, output: tokensOut },
      estimatedCostUsd: Math.round(cost * 1_000_000) / 1_000_000,
      rollbackStrategy: "Documented rollback runbook in docs/rollback.md. Includes: revert commit, run migrations down, verify tests pass on rollback, notify stakeholders.",
      alternatives: [
        "Use a feature flag with progressive rollout (10% → 50% → 100%)",
        "Deploy behind an API version (v2 endpoint)",
        "Use a dark launch with monitoring",
      ],
      pros: ["Bullet-proof", "Full test coverage", "Documented", "Rollback ready", "Architecture-compliant"],
      cons: ["Highest cost", "Longest duration", "Large PR (split recommended)"],
    };
  }

  // ============================================
  // Heuristic file prediction (fallback)
  // ============================================

  private heuristicFiles(prompt: string, repo: RepositoryAnalysis): string[] {
    const files: string[] = [];
    const lower = prompt.toLowerCase();
    if (/\b(api|endpoint|route)\b/.test(lower)) files.push("src/api/router.ts");
    if (/\b(database|schema|migration)\b/.test(lower)) files.push("src/database/schema.ts");
    if (/\b(auth|login|token)\b/.test(lower)) files.push("src/middleware/auth.ts");
    if (/\b(test|spec)\b/.test(lower)) files.push("tests/");
    if (/\b(doc|readme)\b/.test(lower)) files.push("README.md");
    // Add top hotspot
    if (repo.hotspots.length > 0) files.push(repo.hotspots[0].path);
    return files.length > 0 ? files : ["src/index.ts"];
  }

  // ============================================
  // Render for Telegram
  // ============================================

  render(package_: PlanPackage): string {
    const lines: string[] = [
      `📋 *Plan Package* — ${package_.strategies.length} strategies`,
      ``,
    ];
    for (const s of package_.strategies) {
      const isRec = s.type === package_.recommendedStrategy;
      lines.push(`${isRec ? "⭐ " : ""}${s.emoji} *${s.label}* — ${s.tagline}`);
      lines.push(`_${s.description}_`);
      lines.push(``);
      lines.push(`   ⏱ ~${s.estimatedDurationMin} min · 💰 $${s.estimatedCostUsd.toFixed(4)} · 🔤 ${s.estimatedTokens.input + s.estimatedTokens.out} tokens`);
      lines.push(`   📁 ${s.affectedFiles.length} files · ⚠️ ${s.riskLevel} risk · 📦 +${s.estimatedPrSize.additions}/-${s.estimatedPrSize.deletions}`);
      lines.push(``);
    }
    lines.push(`*Recommended:* ${package_.recommendedStrategy}`);
    lines.push(``);
    lines.push(`Tap a strategy below to choose:`);
    return lines.join("\n");
  }

  renderStrategyDetail(s: PlanStrategy): string {
    const lines: string[] = [
      `${s.emoji} *${s.label} Strategy* — ${s.tagline}`,
      ``,
      s.description,
      ``,
      `*Phases (${s.phases.length}):*`,
    ];
    s.phases.forEach((p, i) => {
      lines.push(`${i + 1}. *${p.name}* (~${p.estimatedMinutes} min)`);
      lines.push(`   ${p.description}`);
    });
    lines.push(``);
    lines.push(`*Estimates:*`);
    lines.push(`⏱ Duration: ~${s.estimatedDurationMin} min`);
    lines.push(`🔤 Tokens: ${s.estimatedTokens.input.toLocaleString()} in / ${s.estimatedTokens.output.toLocaleString()} out`);
    lines.push(`💰 Cost: $${s.estimatedCostUsd.toFixed(4)}`);
    lines.push(`📦 PR size: +${s.estimatedPrSize.additions}/-${s.estimatedPrSize.deletions}`);
    lines.push(`⚠️ Risk: ${s.riskLevel}`);
    lines.push(``);
    lines.push(`*Rollback:* ${s.rollbackStrategy}`);
    lines.push(``);
    lines.push(`*Pros:*`);
    s.pros.forEach((p) => lines.push(`✅ ${p}`));
    lines.push(``);
    lines.push(`*Cons:*`);
    s.cons.forEach((c) => lines.push(`❌ ${c}`));
    return lines.join("\n");
  }
}

// ============================================
// Factory
// ============================================

let _instance: PlanStrategyGenerator | null = null;

export function getPlanStrategyGenerator(env: HadesBindings): PlanStrategyGenerator {
  if (!_instance) _instance = new PlanStrategyGenerator(env);
  return _instance;
}
