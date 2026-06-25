/**
 * Integration Tests: Risk Analyzer - Cloudflare Workers Edition
 * Hades Army v0.9.2
 *
 * Priority 10: Testing — Risk Analysis Tests
 *
 * Tests that the Pre-Build Risk Analyzer correctly:
 *   - Detects sensitive files (auth, db, payment, secrets)
 *   - Computes complexity levels (low / medium / high / critical)
 *   - Identifies impact areas (frontend / backend / db / infra)
 *   - Gates workflows requiring explicit approval
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PreBuildRiskAnalyzer } from "../../src/manager/risk-analyzer";
import type { RepositoryAnalysis } from "../../src/memory/repository-analyzer";

function makeMockRepoAnalysis(overrides: Partial<RepositoryAnalysis> = {}): RepositoryAnalysis {
  return {
    scan: {
      repositoryFullName: "owner/repo",
      defaultBranch: "main",
      languages: ["TypeScript"],
      frameworks: ["Hono"],
      architectureStyle: "cloudflare-workers-hono",
      conventions: ["prettier", "eslint"],
      relevantFiles: [],
      languageStats: [{ language: "TypeScript", fileCount: 20, percentage: 100 }],
      frameworksDetected: [{ name: "Hono", evidence: "package.json" }],
      dependencyEdges: [],
      testLayout: "separate",
      linting: { linter: "eslint", formatter: "prettier", configFiles: ["eslint.config.js"] },
      ignoredPaths: [],
    },
    technicalDebt: [],
    hotspots: [],
    dependencyGraph: { nodes: [], edges: [], totalProd: 0, totalDev: 0, deprecated: [] },
    packageManager: "npm",
    packageInfo: null,
    architecturePattern: "cloudflare-workers-hono",
    insights: [],
    healthScore: 75,
    ...overrides,
  };
}

describe("Pre-Build Risk Analyzer Integration", () => {
  let analyzer: PreBuildRiskAnalyzer;

  beforeEach(() => {
    analyzer = new PreBuildRiskAnalyzer();
  });

  describe("Sensitive file detection", () => {
    it("should flag auth files as critical", async () => {
      const result = await analyzer.analyze(
        "Update login flow",
        ["src/auth/login.ts", "src/middleware/auth.ts"],
        makeMockRepoAnalysis(),
      );
      expect(result.sensitiveFiles.length).toBeGreaterThan(0);
      expect(result.sensitiveFiles.some((f) => f.category === "authentication")).toBe(true);
    });

    it("should flag database schema files as high severity", async () => {
      const result = await analyzer.analyze(
        "Add a new table",
        ["src/database/schema.ts"],
        makeMockRepoAnalysis(),
      );
      expect(result.sensitiveFiles.some((f) => f.category === "database")).toBe(true);
    });

    it("should flag payment files as critical", async () => {
      const result = await analyzer.analyze(
        "Update Stripe integration",
        ["src/payment/stripe.ts"],
        makeMockRepoAnalysis(),
      );
      expect(result.sensitiveFiles.some((f) => f.category === "payment" && f.severity === "critical")).toBe(true);
    });

    it("should refuse to modify .env files", async () => {
      const result = await analyzer.analyze(
        "Add a new env var",
        [".env"],
        makeMockRepoAnalysis(),
      );
      expect(result.recommendation).toBe("abort");
      expect(result.reason).toContain("secrets file");
    });

    it("should flag infrastructure files (wrangler.toml, CI/CD)", async () => {
      const result = await analyzer.analyze(
        "Update deploy config",
        ["wrangler.toml", ".github/workflows/ci.yml"],
        makeMockRepoAnalysis(),
      );
      expect(result.sensitiveFiles.some((f) => f.category === "infrastructure")).toBe(true);
    });

    it("should not flag normal source files as sensitive", async () => {
      const result = await analyzer.analyze(
        "Update a utility function",
        ["src/utils/helpers.ts"],
        makeMockRepoAnalysis(),
      );
      expect(result.sensitiveFiles.length).toBe(0);
    });
  });

  describe("Complexity scoring", () => {
    it("should rate simple changes as low", async () => {
      const result = await analyzer.analyze(
        "Fix typo in README",
        ["README.md"],
        makeMockRepoAnalysis(),
      );
      expect(result.complexity).toBe("low");
    });

    it("should rate multi-file changes as higher complexity", async () => {
      const result = await analyzer.analyze(
        "Refactor the entire API surface",
        ["src/api/router.ts", "src/api/routes/agents.ts", "src/api/routes/reviews.ts", "src/api/routes/memory.ts"],
        makeMockRepoAnalysis({ healthScore: 40 }),
      );
      expect(["medium", "high", "critical"]).toContain(result.complexity);
    });

    it("should rate critical when many sensitive files touched", async () => {
      const result = await analyzer.analyze(
        "Major security overhaul",
        ["src/auth/login.ts", "src/database/schema.ts", ".env", "wrangler.toml", "src/payment/stripe.ts"],
        makeMockRepoAnalysis({ healthScore: 30 }),
      );
      expect(result.complexity).toBe("critical");
    });
  });

  describe("Impact analysis", () => {
    it("should detect frontend impact", async () => {
      const result = await analyzer.analyze(
        "Update the UI for the login page",
        ["src/components/Login.tsx", "src/styles/login.css"],
        makeMockRepoAnalysis(),
      );
      expect(result.impact.areas).toContain("frontend");
      expect(result.impact.primary).toBe("frontend");
    });

    it("should detect backend impact", async () => {
      const result = await analyzer.analyze(
        "Add a new API endpoint",
        ["src/api/routes/users.ts"],
        makeMockRepoAnalysis(),
      );
      expect(result.impact.areas).toContain("backend");
    });

    it("should detect database impact", async () => {
      const result = await analyzer.analyze(
        "Add a new table to the database",
        ["src/database/schema.ts", "migrations/001.sql"],
        makeMockRepoAnalysis(),
      );
      expect(result.impact.areas).toContain("database");
    });

    it("should detect cross-cutting changes", async () => {
      const result = await analyzer.analyze(
        "Refactor auth across frontend, backend, and database",
        ["src/components/Login.tsx", "src/api/auth.ts", "src/database/schema.ts", "src/middleware/auth.ts"],
        makeMockRepoAnalysis(),
      );
      expect(result.impact.crossCutting).toBe(true);
      expect(result.impact.areas.length).toBeGreaterThan(2);
    });
  });

  describe("Recommendation", () => {
    it("should recommend proceed for low-risk changes", async () => {
      const result = await analyzer.analyze(
        "Update docs",
        ["README.md"],
        makeMockRepoAnalysis(),
      );
      expect(result.recommendation).toBe("proceed");
    });

    it("should recommend needs_approval for critical complexity", async () => {
      const result = await analyzer.analyze(
        "Major refactor",
        ["src/auth/login.ts", "src/database/schema.ts", "src/api/router.ts", "src/payment/stripe.ts"],
        makeMockRepoAnalysis({ healthScore: 30 }),
      );
      expect(["needs_approval", "abort"]).toContain(result.recommendation);
    });

    it("should recommend abort for secrets file modifications", async () => {
      const result = await analyzer.analyze(
        "Update secrets",
        [".env"],
        makeMockRepoAnalysis(),
      );
      expect(result.recommendation).toBe("abort");
    });
  });

  describe("Gating", () => {
    it("should require explicit approval for sensitive files", async () => {
      const result = await analyzer.analyze(
        "Update auth",
        ["src/auth/login.ts"],
        makeMockRepoAnalysis(),
      );
      expect(result.requiresExplicitApproval).toBe(true);
    });

    it("should require additional secret scan when sensitive files present", async () => {
      const result = await analyzer.analyze(
        "Update auth",
        ["src/auth/login.ts"],
        makeMockRepoAnalysis(),
      );
      expect(result.requiresAdditionalSecretScan).toBe(true);
    });

    it("should not require approval for normal files", async () => {
      const result = await analyzer.analyze(
        "Update docs",
        ["docs/guide.md"],
        makeMockRepoAnalysis(),
      );
      expect(result.requiresExplicitApproval).toBe(false);
    });
  });
});
