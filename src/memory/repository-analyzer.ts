/**
 * Repository Analyzer - Cloudflare Workers Edition
 * Hades Army v0.9.0 — Architecture Completion & Production Readiness
 *
 * Section 5: GitHub-Centric Workflow
 *
 * Extends the v0.8.5 RepositoryScanner with deeper analysis:
 *   - Technical Debt detection (TODO/FIXME/HACK markers, deprecated deps)
 *   - Hotspot detection (files most likely to need attention)
 *   - Dependency graph (high-level)
 *   - Package manager detection
 *   - Architecture pattern refinement
 *
 * This module is ADDITIVE — it uses RepositoryScanner under the hood
 * and adds an analysis layer on top. The Manager MUST run this
 * before planning any task.
 */

import { logger } from "../utils/logger";
import type { HadesBindings } from "../types";
import { RepositoryScanner, type DetailedScanResult } from "./repository-scanner";

// ============================================
// Types
// ============================================

export interface TechnicalDebtItem {
  type: "todo" | "fixme" | "hack" | "deprecated" | "any" | "console_log" | "ts_any" | "eslint_disable";
  file: string;
  line: number;
  snippet: string;
  severity: "low" | "medium" | "high";
}

export interface HotspotFile {
  path: string;
  /** 0-100, higher = more attention needed */
  attentionScore: number;
  reasons: string[];
}

export interface DependencyGraphNode {
  name: string;
  version: string;
  type: "prod" | "dev";
  direct: boolean;
}

export interface DependencyGraphEdge {
  from: string;
  to: string;
}

export interface PackageInfo {
  name: string;
  version: string;
  description: string;
  license: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export interface RepositoryAnalysis {
  scan: DetailedScanResult;
  technicalDebt: TechnicalDebtItem[];
  hotspots: HotspotFile[];
  dependencyGraph: {
    nodes: DependencyGraphNode[];
    edges: DependencyGraphEdge[];
    totalProd: number;
    totalDev: number;
    deprecated: string[];
  };
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "pip" | "poetry" | "go" | "cargo" | "unknown";
  packageInfo: PackageInfo | null;
  architecturePattern: string;
  insights: string[];
  healthScore: number; // 0-100
}

// ============================================
// Analyzer
// ============================================

export class RepositoryAnalyzer {
  private env: HadesBindings;
  private scanner: RepositoryScanner;

  constructor(env: HadesBindings) {
    this.env = env;
    this.scanner = new RepositoryScanner(env);
  }

  // ============================================
  // Top-level analysis entry point
  // ============================================

  async analyze(repositoryFullName: string): Promise<RepositoryAnalysis> {
    logger.info(`RepositoryAnalyzer: analyzing ${repositoryFullName}`);
    const start = Date.now();

    // 1. Run the v0.8.5 scanner
    const scan = await this.scanner.scan(repositoryFullName);

    // 2. Fetch package manifest (if Node/Python)
    const packageInfo = await this.fetchPackageInfo(repositoryFullName, scan);

    // 3. Detect package manager
    const packageManager = this.detectPackageManager(scan);

    // 4. Build dependency graph
    const dependencyGraph = this.buildDependencyGraph(packageInfo);

    // 5. Detect technical debt (sample files)
    const technicalDebt = await this.detectTechnicalDebt(repositoryFullName, scan);

    // 6. Detect hotspots
    const hotspots = this.detectHotspots(scan, technicalDebt);

    // 7. Refine architecture pattern
    const architecturePattern = this.refineArchitecturePattern(scan, packageInfo);

    // 8. Generate insights
    const insights = this.generateInsights(scan, technicalDebt, hotspots, dependencyGraph);

    // 9. Compute health score
    const healthScore = this.computeHealthScore(scan, technicalDebt, hotspots);

    const analysis: RepositoryAnalysis = {
      scan,
      technicalDebt,
      hotspots,
      dependencyGraph,
      packageManager,
      packageInfo,
      architecturePattern,
      insights,
      healthScore,
    };

    logger.info(`RepositoryAnalyzer: complete in ${Date.now() - start}ms`, {
      debt: technicalDebt.length,
      hotspots: hotspots.length,
      healthScore,
    });
    return analysis;
  }

  // ============================================
  // Package info
  // ============================================

  private async fetchPackageInfo(repo: string, scan: DetailedScanResult): Promise<PackageInfo | null> {
    if (scan.languages.includes("TypeScript") || scan.languages.includes("JavaScript")) {
      const content = await this.scanner.fetchFile(repo, "package.json");
      if (content) {
        try {
          const pkg = JSON.parse(content);
          return {
            name: String(pkg.name ?? ""),
            version: String(pkg.version ?? ""),
            description: String(pkg.description ?? ""),
            license: String(pkg.license ?? ""),
            scripts: (pkg.scripts as Record<string, string>) ?? {},
            dependencies: (pkg.dependencies as Record<string, string>) ?? {},
            devDependencies: (pkg.devDependencies as Record<string, string>) ?? {},
          };
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  // ============================================
  // Package manager detection
  // ============================================

  private detectPackageManager(scan: DetailedScanResult): RepositoryAnalysis["packageManager"] {
    const allPaths = scan.relevantFiles.map((f) => f.path);
    // Check the scan's languageStats (which contains language info)
    // We use a heuristic based on lockfile presence
    const has = (name: string) => allPaths.includes(name) || scan.relevantFiles.some((f) => f.path === name);

    if (has("bun.lockb") || has("bun.lock")) return "bun";
    if (has("pnpm-lock.yaml")) return "pnpm";
    if (has("yarn.lock")) return "yarn";
    if (has("package-lock.json")) return "npm";
    if (has("poetry.lock")) return "poetry";
    if (has("Pipfile.lock") || has("requirements.txt")) return "pip";
    if (has("go.sum")) return "go";
    if (has("Cargo.lock")) return "cargo";
    return "unknown";
  }

  // ============================================
  // Dependency graph
  // ============================================

  private buildDependencyGraph(packageInfo: PackageInfo | null): RepositoryAnalysis["dependencyGraph"] {
    if (!packageInfo) {
      return { nodes: [], edges: [], totalProd: 0, totalDev: 0, deprecated: [] };
    }

    const nodes: DependencyGraphNode[] = [];
    const edges: DependencyGraphEdge[] = [];
    const deprecated: string[] = [];

    const prodDeps = packageInfo.dependencies ?? {};
    const devDeps = packageInfo.devDependencies ?? {};

    for (const [name, version] of Object.entries(prodDeps)) {
      nodes.push({ name, version, type: "prod", direct: true });
      edges.push({ from: packageInfo.name || "root", to: name });
      if (version.includes("deprecated") || name.startsWith("deprecated-")) deprecated.push(name);
    }
    for (const [name, version] of Object.entries(devDeps)) {
      nodes.push({ name, version, type: "dev", direct: true });
      edges.push({ from: packageInfo.name || "root", to: name });
    }

    return {
      nodes,
      edges,
      totalProd: Object.keys(prodDeps).length,
      totalDev: Object.keys(devDeps).length,
      deprecated,
    };
  }

  // ============================================
  // Technical debt detection
  // ============================================

  private async detectTechnicalDebt(
    repo: string,
    scan: DetailedScanResult,
  ): Promise<TechnicalDebtItem[]> {
    const debt: TechnicalDebtItem[] = [];

    // Sample up to 30 source files for debt markers
    const sourceFiles = scan.relevantFiles
      .map((f) => f.path)
      .filter((p) => /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php)$/i.test(p))
      .slice(0, 30);

    for (const path of sourceFiles) {
      const content = await this.scanner.fetchFile(repo, path);
      if (!content) continue;

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // TODO
        if (/\bTODO\b/.test(line)) {
          debt.push({ type: "todo", file: path, line: i + 1, snippet: line.trim().slice(0, 120), severity: "low" });
        }
        // FIXME
        if (/\bFIXME\b/.test(line)) {
          debt.push({ type: "fixme", file: path, line: i + 1, snippet: line.trim().slice(0, 120), severity: "medium" });
        }
        // HACK
        if (/\bHACK\b/.test(line)) {
          debt.push({ type: "hack", file: path, line: i + 1, snippet: line.trim().slice(0, 120), severity: "high" });
        }
        // @deprecated
        if (/@deprecated\b/.test(line)) {
          debt.push({ type: "deprecated", file: path, line: i + 1, snippet: line.trim().slice(0, 120), severity: "medium" });
        }
        // console.log (in production code)
        if (/console\.log\s*\(/.test(line) && !/test|spec/i.test(path)) {
          debt.push({ type: "console_log", file: path, line: i + 1, snippet: line.trim().slice(0, 120), severity: "low" });
        }
        // `any` type in TS
        if (/:\s*any\b/.test(line) && /\.(ts|tsx)$/i.test(path)) {
          debt.push({ type: "ts_any", file: path, line: i + 1, snippet: line.trim().slice(0, 120), severity: "low" });
        }
        // eslint-disable
        if (/eslint-disable/.test(line)) {
          debt.push({ type: "eslint_disable", file: path, line: i + 1, snippet: line.trim().slice(0, 120), severity: "medium" });
        }
      }

      if (debt.length > 200) break; // safety cap
    }

    return debt;
  }

  // ============================================
  // Hotspot detection
  // ============================================

  private detectHotspots(scan: DetailedScanResult, debt: TechnicalDebtItem[]): HotspotFile[] {
    const scores = new Map<string, { score: number; reasons: Set<string> }>();

    const bump = (path: string, points: number, reason: string) => {
      const entry = scores.get(path) ?? { score: 0, reasons: new Set() };
      entry.score = Math.min(100, entry.score + points);
      entry.reasons.add(reason);
      scores.set(path, entry);
    };

    // Files with high debt concentration
    const debtByFile = new Map<string, number>();
    for (const d of debt) {
      debtByFile.set(d.file, (debtByFile.get(d.file) ?? 0) + 1);
    }
    for (const [path, count] of debtByFile.entries()) {
      bump(path, Math.min(40, count * 8), `${count} debt marker(s)`);
    }

    // Large files (heuristic: paths that look like main entry points)
    for (const f of scan.relevantFiles) {
      if (/index\.(ts|js)$/.test(f.path) || /main\.(ts|js|py|go)$/.test(f.path)) {
        bump(f.path, 15, "Entry point");
      }
      if (/\/(api|routes|handlers)\//.test(f.path)) {
        bump(f.path, 10, "API handler");
      }
      if (/\/(auth|security|crypto)\//.test(f.path)) {
        bump(f.path, 15, "Security-sensitive");
      }
    }

    return Array.from(scores.entries())
      .map(([path, { score, reasons }]) => ({
        path,
        attentionScore: score,
        reasons: Array.from(reasons),
      }))
      .sort((a, b) => b.attentionScore - a.attentionScore)
      .slice(0, 20);
  }

  // ============================================
  // Architecture pattern refinement
  // ============================================

  private refineArchitecturePattern(scan: DetailedScanResult, packageInfo: PackageInfo | null): string {
    const base = scan.architectureStyle;
    if (!packageInfo) return base;

    const deps = Object.keys(packageInfo.dependencies ?? {});
    if (deps.includes("hono") && deps.includes("@cloudflare/workers-types")) {
      return "cloudflare-workers-hono";
    }
    if (deps.includes("next")) return "next.js-app-router";
    if (deps.includes("express")) return "express-rest";
    if (deps.includes("@nestjs/core")) return "nestjs-modular";
    return base;
  }

  // ============================================
  // Insights
  // ============================================

  private generateInsights(
    scan: DetailedScanResult,
    debt: TechnicalDebtItem[],
    hotspots: HotspotFile[],
    graph: RepositoryAnalysis["dependencyGraph"],
  ): string[] {
    const insights: string[] = [];

    if (debt.length > 50) {
      insights.push(`⚠️ High technical debt: ${debt.length} markers detected across the codebase.`);
    } else if (debt.length > 10) {
      insights.push(`🟡 Moderate technical debt: ${debt.length} markers detected.`);
    } else {
      insights.push(`✅ Low technical debt: ${debt.length} markers detected.`);
    }

    if (hotspots.length > 0) {
      insights.push(`🔥 Top hotspot: ${hotspots[0].path} (score ${hotspots[0].attentionScore}).`);
    }

    if (graph.deprecated.length > 0) {
      insights.push(`📦 ${graph.deprecated.length} deprecated dependency(ies) detected: ${graph.deprecated.slice(0, 3).join(", ")}.`);
    }

    if (scan.testLayout === "none") {
      insights.push(`⚠️ No tests detected — adding tests should be the first priority.`);
    }

    if (scan.linting.linter === undefined) {
      insights.push(`⚠️ No linter configured — adding ESLint would improve code quality.`);
    }

    if (scan.conventions.length === 0 || scan.conventions.includes("no-explicit-conventions")) {
      insights.push(`⚠️ No explicit coding conventions detected — document them in .hades/architecture.md.`);
    }

    if (insights.length === 0) {
      insights.push(`✅ Repository is in good shape — proceed with planning.`);
    }

    return insights;
  }

  // ============================================
  // Health score
  // ============================================

  private computeHealthScore(
    scan: DetailedScanResult,
    debt: TechnicalDebtItem[],
    hotspots: HotspotFile[],
  ): number {
    let score = 100;

    // Penalty for technical debt
    score -= Math.min(30, debt.length * 0.5);

    // Penalty for missing tests
    if (scan.testLayout === "none") score -= 20;

    // Penalty for missing linter
    if (!scan.linting.linter) score -= 10;

    // Penalty for missing formatter
    if (!scan.linting.formatter) score -= 5;

    // Penalty for hotspots
    const topHotspotScore = hotspots[0]?.attentionScore ?? 0;
    score -= Math.min(15, topHotspotScore * 0.15);

    // Bonus for explicit conventions
    if (scan.conventions.length > 2) score += 5;

    return Math.max(0, Math.min(100, Math.round(score)));
  }
}
