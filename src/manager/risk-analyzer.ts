/**
 * Pre-Build Risk Analyzer - Cloudflare Workers Edition
 * Hades Army v0.9.2 — Manager Improvements
 *
 * Priority 3: Risk Analysis before Build
 *
 * Before sending any Task to the Builder, the Manager MUST run this
 * analyzer to identify:
 *   - Sensitive files (auth, database, payment, secrets)
 *   - Complexity Score (Low / Medium / High / Critical)
 *   - Impact Analysis (Frontend / Backend / Database / Infrastructure)
 *
 * The output gates the workflow:
 *   - Critical complexity or critical impact → Manager must request
 *     user approval BEFORE Builder execution
 *   - Sensitive file detected → Manager must run Secret Scanner
 *     on the patch in addition to the standard pre-PR scan
 */

import { logger } from "../utils/logger";
import type { HadesBindings } from "../types";
import type { RepositoryAnalysis } from "../memory/repository-analyzer";

// ============================================
// Types
// ============================================

export type ComplexityLevel = "low" | "medium" | "high" | "critical";

export interface SensitiveFileMatch {
  path: string;
  category: "authentication" | "database" | "payment" | "secrets" | "security" | "infrastructure" | "core";
  severity: "high" | "critical";
  reason: string;
}

export type ImpactArea = "frontend" | "backend" | "database" | "infrastructure" | "tests" | "docs" | "unknown";

export interface ImpactAnalysis {
  areas: ImpactArea[];
  primary: ImpactArea;
  summary: string;
  crossCutting: boolean;
}

export interface PreBuildRiskAnalysis {
  sensitiveFiles: SensitiveFileMatch[];
  complexity: ComplexityLevel;
  complexityScore: number;     // 0-100
  impact: ImpactAnalysis;
  requiresExplicitApproval: boolean;
  requiresAdditionalSecretScan: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
  recommendation: "proceed" | "needs_approval" | "needs_clarification" | "abort";
  reason: string;
}

// ============================================
// Sensitive file patterns
// ============================================

interface SensitivePattern {
  pattern: RegExp;
  category: SensitiveFileMatch["category"];
  severity: SensitiveFileMatch["severity"];
  reason: string;
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  // Authentication
  { pattern: /\/auth\/|\/authentication\/|auth\.ts$|auth\.js$|login\.ts$|login\.js$|session\.ts$/i,
    category: "authentication", severity: "critical",
    reason: "Authentication code — unauthorized changes could break login or compromise accounts" },
  { pattern: /\/middleware\/auth/i,
    category: "authentication", severity: "high",
    reason: "Auth middleware — affects all protected routes" },
  { pattern: /password|passwd|credential/i,
    category: "authentication", severity: "critical",
    reason: "Password/credential handling" },

  // Database
  { pattern: /\/database\/|schema\.ts$|schema\.js$|migration/i,
    category: "database", severity: "high",
    reason: "Database schema or migration — affects data integrity" },
  { pattern: /\.sql$|prisma\/schema/i,
    category: "database", severity: "high",
    reason: "SQL or Prisma schema — direct data layer" },
  { pattern: /drizzle\.config|drizzle\.ts/i,
    category: "database", severity: "high",
    reason: "ORM configuration" },

  // Payment
  { pattern: /payment|stripe|paypal|checkout|billing/i,
    category: "payment", severity: "critical",
    reason: "Payment processing — errors can cause financial loss" },

  // Secrets
  { pattern: /\.env$|\.env\.|secrets?\/|credentials/i,
    category: "secrets", severity: "critical",
    reason: "Secrets file — must never be committed" },
  { pattern: /crypto\.ts$|crypto\.js$|encryption/i,
    category: "secrets", severity: "high",
    reason: "Crypto/encryption code — security-sensitive" },

  // Security
  { pattern: /\/security\/|security\.ts$|permission/i,
    category: "security", severity: "high",
    reason: "Security module — affects access control" },
  { pattern: /jwt|token.*verify|signature/i,
    category: "security", severity: "high",
    reason: "JWT/token verification — auth-critical" },

  // Infrastructure
  { pattern: /wrangler\.toml|terraform|cloudformation|docker-compose|Dockerfile/i,
    category: "infrastructure", severity: "high",
    reason: "Infrastructure config — affects deployment" },
  { pattern: /\.github\/workflows\/|ci\.yml|cd\.yml/i,
    category: "infrastructure", severity: "high",
    reason: "CI/CD pipeline — affects all future deploys" },

  // Core entry points
  { pattern: /src\/index\.ts$|src\/main\.ts$|src\/app\.ts$/,
    category: "core", severity: "high",
    reason: "Application entry point — affects everything" },
];

// ============================================
// Impact area patterns
// ============================================

const IMPACT_PATTERNS: Array<{ area: ImpactArea; pattern: RegExp }> = [
  { area: "frontend", pattern: /\/components\/|\.tsx$|\.jsx$|\.vue$|\.svelte$|\.css$|\.scss$|tailwind|frontend|ui\//i },
  { area: "backend", pattern: /\/api\/|\.ts$|\.go$|\.py$|\.rb$|server\.|route\.|controller\.|service\./i },
  { area: "database", pattern: /\/database\/|schema|migration|\.sql$|prisma|drizzle/i },
  { area: "infrastructure", pattern: /wrangler|terraform|docker|kubernetes|\.ya?ml$|\.toml$|infra/i },
  { area: "tests", pattern: /test|spec|__tests__|\.test\.|\.spec\./i },
  { area: "docs", pattern: /README|CHANGELOG|\.md$|docs\//i },
];

// ============================================
// Analyzer
// ============================================

export class PreBuildRiskAnalyzer {
  /**
   * Analyze a user prompt + repository analysis for risk.
   * Called by the Manager BEFORE creating a Builder task.
   */
  async analyze(
    userPrompt: string,
    predictedAffectedFiles: string[],
    repoAnalysis: RepositoryAnalysis,
  ): Promise<PreBuildRiskAnalysis> {
    logger.info(`PreBuildRiskAnalyzer: analyzing ${predictedAffectedFiles.length} predicted files`);

    // 1. Detect sensitive files
    const sensitiveFiles = this.detectSensitiveFiles(predictedAffectedFiles);

    // 2. Compute complexity
    const complexityResult = this.computeComplexity(userPrompt, predictedAffectedFiles, sensitiveFiles, repoAnalysis);

    // 3. Compute impact
    const impact = this.analyzeImpact(userPrompt, predictedAffectedFiles, repoAnalysis);

    // 4. Decide gating
    const requiresExplicitApproval =
      complexityResult.level === "critical" ||
      sensitiveFiles.some((f) => f.severity === "critical") ||
      impact.crossCutting;
    const requiresAdditionalSecretScan = sensitiveFiles.length > 0;

    // 5. Overall risk level
    const riskLevel = this.computeRiskLevel(complexityResult.level, sensitiveFiles, impact);

    // 6. Recommendation
    let recommendation: PreBuildRiskAnalysis["recommendation"] = "proceed";
    let reason = "No significant risks detected.";
    if (sensitiveFiles.some((f) => f.severity === "critical" && f.category === "secrets")) {
      recommendation = "abort";
      reason = "Patch targets a secrets file — refuse to modify.";
    } else if (complexityResult.level === "critical") {
      recommendation = "needs_approval";
      reason = `Critical complexity (${complexityResult.level}) — requires explicit user approval before build.`;
    } else if (requiresExplicitApproval) {
      recommendation = "needs_approval";
      reason = `Sensitive file(s) detected: ${sensitiveFiles.map((f) => f.path).join(", ")}`;
    } else if (complexityResult.level === "high") {
      recommendation = "needs_clarification";
      reason = "High complexity — Manager should confirm scope with user.";
    }

    return {
      sensitiveFiles,
      complexity: complexityResult.level,
      complexityScore: complexityResult.score,
      impact,
      requiresExplicitApproval,
      requiresAdditionalSecretScan,
      riskLevel,
      recommendation,
      reason,
    };
  }

  // ============================================
  // Sensitive file detection
  // ============================================

  private detectSensitiveFiles(filePaths: string[]): SensitiveFileMatch[] {
    const matches: SensitiveFileMatch[] = [];
    for (const path of filePaths) {
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.pattern.test(path)) {
          matches.push({
            path,
            category: pattern.category,
            severity: pattern.severity,
            reason: pattern.reason,
          });
          break; // one match per file is enough
        }
      }
    }
    return matches;
  }

  // ============================================
  // Complexity scoring
  // ============================================

  private computeComplexity(
    prompt: string,
    affectedFiles: string[],
    sensitiveFiles: SensitiveFileMatch[],
    repo: RepositoryAnalysis,
  ): { level: ComplexityLevel; score: number } {
    let score = 10;

    // Prompt length contributes
    score += Math.min(20, prompt.length / 50);

    // File count contributes
    score += Math.min(25, affectedFiles.length * 3);

    // Sensitive files add a lot
    score += sensitiveFiles.length * 8;
    score += sensitiveFiles.filter((f) => f.severity === "critical").length * 12;

    // Repo health affects
    if (repo.healthScore < 50) score += 15;
    if (repo.technicalDebt.length > 30) score += 8;

    // Cross-cutting impact adds complexity
    const impactAreas = new Set<ImpactArea>();
    for (const file of affectedFiles) {
      for (const { area, pattern } of IMPACT_PATTERNS) {
        if (pattern.test(file)) {
          impactAreas.add(area);
          break;
        }
      }
    }
    if (impactAreas.size > 2) score += 10;

    score = Math.min(100, Math.round(score));

    let level: ComplexityLevel;
    if (score >= 80) level = "critical";
    else if (score >= 60) level = "high";
    else if (score >= 35) level = "medium";
    else level = "low";

    return { level, score };
  }

  // ============================================
  // Impact analysis
  // ============================================

  private analyzeImpact(
    prompt: string,
    affectedFiles: string[],
    repo: RepositoryAnalysis,
  ): ImpactAnalysis {
    const areas = new Set<ImpactArea>();
    const promptLower = prompt.toLowerCase();

    // Prompt-driven impact
    if (/\b(ui|frontend|component|button|page|layout|css|style)\b/.test(promptLower)) areas.add("frontend");
    if (/\b(api|endpoint|route|backend|server|controller)\b/.test(promptLower)) areas.add("backend");
    if (/\b(database|db|schema|migration|sql|table)\b/.test(promptLower)) areas.add("database");
    if (/\b(infrastructure|deploy|docker|terraform|wrangler|ci|cd)\b/.test(promptLower)) areas.add("infrastructure");
    if (/\b(test|spec|coverage)\b/.test(promptLower)) areas.add("tests");
    if (/\b(doc|readme|guide)\b/.test(promptLower)) areas.add("docs");

    // File-driven impact
    for (const file of affectedFiles) {
      for (const { area, pattern } of IMPACT_PATTERNS) {
        if (pattern.test(file)) {
          areas.add(area);
          break;
        }
      }
    }

    const areasList = Array.from(areas);
    if (areasList.length === 0) areasList.push("unknown");

    // Primary impact = most common area in affected files
    const areaCounts = new Map<ImpactArea, number>();
    for (const file of affectedFiles) {
      for (const { area, pattern } of IMPACT_PATTERNS) {
        if (pattern.test(file)) {
          areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
          break;
        }
      }
    }
    let primary: ImpactArea = areasList[0];
    let maxCount = 0;
    for (const [area, count] of areaCounts) {
      if (count > maxCount) {
        maxCount = count;
        primary = area;
      }
    }

    const crossCutting = areasList.length > 2;

    const summary = crossCutting
      ? `Cross-cutting change affecting ${areasList.length} areas: ${areasList.join(", ")}`
      : `Single-area change: ${primary}`;

    return {
      areas: areasList,
      primary,
      summary,
      crossCutting,
    };
  }

  // ============================================
  // Risk level
  // ============================================

  private computeRiskLevel(
    complexity: ComplexityLevel,
    sensitiveFiles: SensitiveFileMatch[],
    impact: ImpactAnalysis,
  ): PreBuildRiskAnalysis["riskLevel"] {
    if (sensitiveFiles.some((f) => f.severity === "critical" && f.category === "secrets")) {
      return "critical";
    }
    if (complexity === "critical" || sensitiveFiles.some((f) => f.severity === "critical")) {
      return "critical";
    }
    if (complexity === "high" || sensitiveFiles.length > 0 || impact.crossCutting) {
      return "high";
    }
    if (complexity === "medium") {
      return "medium";
    }
    return "low";
  }

  // ============================================
  // Render for Telegram
  // ============================================

  render(analysis: PreBuildRiskAnalysis): string {
    const complexityIcon = { low: "🟢", medium: "🟡", high: "🟠", critical: "🔴" }[analysis.complexity];
    const riskIcon = { low: "🟢", medium: "🟡", high: "🟠", critical: "🔴" }[analysis.riskLevel];

    const lines: string[] = [
      `🔍 *Pre-Build Risk Analysis*`,
      ``,
      `${complexityIcon} *Complexity:* ${analysis.complexity.toUpperCase()} (${analysis.complexityScore}/100)`,
      `${riskIcon} *Risk Level:* ${analysis.riskLevel.toUpperCase()}`,
      ``,
      `*Impact Areas:* ${analysis.impact.areas.join(", ")}`,
      `*Primary:* ${analysis.impact.primary}`,
      `*Cross-cutting:* ${analysis.impact.crossCutting ? "Yes" : "No"}`,
      ``,
    ];

    if (analysis.sensitiveFiles.length > 0) {
      lines.push(`*Sensitive Files Detected:*`);
      for (const f of analysis.sensitiveFiles) {
        const icon = f.severity === "critical" ? "🔴" : "🟠";
        lines.push(`${icon} \`${f.path}\` (${f.category})`);
        lines.push(`   _${f.reason}_`);
      }
      lines.push(``);
    } else {
      lines.push(`✅ No sensitive files detected.`);
      lines.push(``);
    }

    if (analysis.requiresExplicitApproval) {
      lines.push(`⚠️ *Requires explicit user approval before build.*`);
    }
    if (analysis.requiresAdditionalSecretScan) {
      lines.push(`🔐 *Will run additional secret scan on patch.*`);
    }
    lines.push(``);
    lines.push(`*Recommendation:* ${analysis.recommendation}`);
    lines.push(`_${analysis.reason}_`);

    return lines.join("\n");
  }
}

// ============================================
// Factory
// ============================================

let _instance: PreBuildRiskAnalyzer | null = null;

export function getPreBuildRiskAnalyzer(): PreBuildRiskAnalyzer {
  if (!_instance) _instance = new PreBuildRiskAnalyzer();
  return _instance;
}
