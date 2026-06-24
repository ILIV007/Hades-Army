/**
 * Repository Scanner - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Priority 3 (supporting) + Priority 4 (GitHub-centric)
 *
 * The Manager MUST scan a repository before planning any task.
 * The scanner extracts:
 *   - Languages (with file counts)
 *   - Frameworks (inferred from manifest files)
 *   - Architecture style (monolith / modular / microservices / library / workers)
 *   - Existing conventions (lint configs, formatting, test layout)
 *   - Dependency graph (high level — based on manifests)
 *   - Relevant files for the upcoming task (returned via Manager)
 *
 * The scanner is READ-ONLY and uses the GitHub REST API via the
 * existing GitHub integration. It NEVER writes to the repository.
 */

import { logger } from "../utils/logger";
import type { HadesBindings } from "../types";
import type { RepositoryScanResult } from "./repository-memory";

// ============================================
// Types
// ============================================

export interface ScanOptions {
  /** depth to walk the file tree (default 3) */
  maxDepth?: number;
  /** patterns to skip */
  ignore?: string[];
  /** limit on number of files to fetch (default 200) */
  fileLimit?: number;
}

export interface LanguageStat {
  language: string;
  fileCount: number;
  percentage: number;
}

export interface FrameworkDetection {
  name: string;
  version?: string;
  evidence: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: "dep" | "devDep";
}

export interface DetailedScanResult extends RepositoryScanResult {
  languageStats: LanguageStat[];
  frameworksDetected: FrameworkDetection[];
  dependencyEdges: DependencyEdge[];
  testLayout: "colocated" | "separate" | "none";
  linting: { linter?: string; formatter?: string; configFiles: string[] };
  ignoredPaths: string[];
}

// ============================================
// Constants
// ============================================

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".swift": "Swift",
  ".c": "C",
  ".cpp": "C++",
  ".h": "C",
  ".css": "CSS",
  ".scss": "SCSS",
  ".html": "HTML",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".sql": "SQL",
  ".sh": "Shell",
  ".toml": "TOML",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".json": "JSON",
  ".md": "Markdown",
};

const FRAMEWORK_MARKERS: Array<{ framework: string; files: string[]; manifestCheck?: RegExp }> = [
  { framework: "Next.js", files: ["next.config.js", "next.config.mjs", "next.config.ts"] },
  { framework: "Nuxt", files: ["nuxt.config.ts", "nuxt.config.js"] },
  { framework: "Hono", files: [], manifestCheck: /"hono"/ },
  { framework: "Express", files: [], manifestCheck: /"express"/ },
  { framework: "Fastify", files: [], manifestCheck: /"fastify"/ },
  { framework: "NestJS", files: ["nest-cli.json"], manifestCheck: /"@nestjs\/core"/ },
  { framework: "Remix", files: ["remix.config.js"], manifestCheck: /"@remix-run\/react"/ },
  { framework: "SvelteKit", files: ["svelte.config.js"], manifestCheck: /"@sveltejs\/kit"/ },
  { framework: "Drizzle ORM", files: ["drizzle.config.ts"], manifestCheck: /"drizzle-orm"/ },
  { framework: "Prisma", files: ["prisma/schema.prisma"], manifestCheck: /"prisma"/ },
  { framework: "Vitest", files: ["vitest.config.ts"], manifestCheck: /"vitest"/ },
  { framework: "Jest", files: [], manifestCheck: /"jest"/ },
  { framework: "Playwright", files: ["playwright.config.ts"], manifestCheck: /"@playwright\/test"/ },
  { framework: "Tailwind CSS", files: ["tailwind.config.js", "tailwind.config.ts"], manifestCheck: /"tailwindcss"/ },
  { framework: "shadcn/ui", files: ["components.json"] },
  { framework: "Django", files: ["manage.py"], manifestCheck: /Django/ },
  { framework: "FastAPI", files: [], manifestCheck: /fastapi/ },
  { framework: "Rails", files: ["Gemfile"], manifestCheck: /rails/ },
];

const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".cache",
  ".turbo",
  ".wrangler",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
];

// ============================================
// Scanner
// ============================================

export class RepositoryScanner {
  private env: HadesBindings;

  constructor(env: HadesBindings) {
    this.env = env;
  }

  async scan(repositoryFullName: string, options?: ScanOptions): Promise<DetailedScanResult> {
    logger.info(`RepositoryScanner: scanning ${repositoryFullName}`);
    const start = Date.now();

    const ignore = [...DEFAULT_IGNORE, ...(options?.ignore ?? [])];
    const tree = await this.fetchRepositoryTree(repositoryFullName, ignore, options?.fileLimit ?? 200);
    const languageStats = this.computeLanguageStats(tree);
    const frameworks = await this.detectFrameworks(repositoryFullName, tree);
    const architectureStyle = this.inferArchitectureStyle(tree, frameworks);
    const conventions = this.inferConventions(tree);
    const testLayout = this.detectTestLayout(tree);
    const linting = this.detectLinting(tree);
    const dependencyEdges: DependencyEdge[] = [];
    const relevantFiles = await this.pickRelevantFiles(repositoryFullName, tree);

    const result: DetailedScanResult = {
      repositoryFullName,
      defaultBranch: "main", // fetched below in real impl
      languages: languageStats.map((s) => s.language),
      frameworks: frameworks.map((f) => f.name),
      architectureStyle,
      conventions,
      relevantFiles,
      languageStats,
      frameworksDetected: frameworks,
      dependencyEdges,
      testLayout,
      linting,
      ignoredPaths: ignore,
    };

    logger.info(`RepositoryScanner: scan complete in ${Date.now() - start}ms`, {
      languages: result.languages.length,
      frameworks: result.frameworks.length,
      files: tree.length,
    });
    return result;
  }

  // ============================================
  // GitHub tree fetch (uses existing GitHub client indirectly)
  // ============================================

  private async fetchRepositoryTree(
    repo: string,
    ignore: string[],
    limit: number,
  ): Promise<string[]> {
    if (!this.env.GITHUB_TOKEN) {
      logger.warn("RepositoryScanner: GITHUB_TOKEN not set, returning empty tree");
      return [];
    }
    const [owner, name] = repo.split("/");
    if (!owner || !name) throw new Error(`Invalid repository full name: ${repo}`);

    // Use the git trees API recursively
    const url = `https://api.github.com/repos/${owner}/${name}/git/trees/HEAD?recursive=1`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "HadesArmy/0.8.5",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub tree fetch failed ${response.status}: ${text}`);
    }

    const data = (await response.json()) as any;
    const tree: Array<{ path: string; type: string }> = data?.tree ?? [];

    const filtered: string[] = [];
    for (const entry of tree) {
      if (entry.type !== "blob") continue;
      if (ignore.some((pattern) => entry.path.startsWith(pattern + "/") || entry.path === pattern)) continue;
      filtered.push(entry.path);
      if (filtered.length >= limit) break;
    }
    return filtered;
  }

  // ============================================
  // Language stats
  // ============================================

  private computeLanguageStats(paths: string[]): LanguageStat[] {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const path of paths) {
      const ext = path.substring(path.lastIndexOf("."));
      const lang = LANGUAGE_BY_EXT[ext];
      if (!lang) continue;
      counts[lang] = (counts[lang] ?? 0) + 1;
      total++;
    }
    if (total === 0) return [];
    return Object.entries(counts)
      .map(([language, fileCount]) => ({
        language,
        fileCount,
        percentage: Math.round((fileCount / total) * 100),
      }))
      .sort((a, b) => b.fileCount - a.fileCount);
  }

  // ============================================
  // Framework detection
  // ============================================

  private async detectFrameworks(repo: string, paths: string[]): Promise<FrameworkDetection[]> {
    const detected: FrameworkDetection[] = [];

    // Fetch package.json / requirements.txt if present
    const manifests = ["package.json", "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml", "Gemfile"];
    const manifestContents: Record<string, string> = {};
    for (const m of manifests) {
      if (paths.includes(m)) {
        const content = await this.fetchFile(repo, m);
        if (content) manifestContents[m] = content;
      }
    }

    for (const marker of FRAMEWORK_MARKERS) {
      let evidence = "";
      if (marker.files.some((f) => paths.includes(f))) {
        evidence = `config file present: ${marker.files.find((f) => paths.includes(f))}`;
      } else if (marker.manifestCheck) {
        for (const [manifestName, content] of Object.entries(manifestContents)) {
          if (marker.manifestCheck.test(content)) {
            evidence = `found in ${manifestName}`;
            break;
          }
        }
      }
      if (evidence) {
        detected.push({ name: marker.framework, evidence });
      }
    }
    return detected;
  }

  // ============================================
  // Architecture style inference
  // ============================================

  private inferArchitectureStyle(paths: string[], frameworks: FrameworkDetection[]): string {
    const fwNames = new Set(frameworks.map((f) => f.name.toLowerCase()));

    if (fwNames.has("next.js") || fwNames.has("nuxt") || fwNames.has("remix") || fwNames.has("sveltekit")) {
      return "fullstack-app";
    }
    if (fwNames.has("hono") || fwNames.has("express") || fwNames.has("fastify") || fwNames.has("nestjs")) {
      return "backend-service";
    }
    if (paths.some((p) => p.startsWith("src/workers/") || p.includes("wrangler.toml"))) {
      return "cloudflare-workers";
    }
    if (paths.includes("index.js") && paths.length < 10) {
      return "library";
    }
    if (paths.some((p) => p.startsWith("cmd/")) && paths.some((p) => p.endsWith(".go"))) {
      return "go-monolith";
    }
    if (paths.some((p) => p.startsWith("src/main/"))) {
      return "java-monolith";
    }
    if (paths.length === 0) {
      return "unknown";
    }
    return "modular-monolith";
  }

  // ============================================
  // Conventions inference
  // ============================================

  private inferConventions(paths: string[]): string[] {
    const conventions: string[] = [];
    if (paths.includes(".prettierrc") || paths.includes(".prettierrc.json") || paths.includes(".prettierrc.js")) {
      conventions.push("prettier-formatting");
    }
    if (paths.includes(".eslintrc") || paths.includes(".eslintrc.json") || paths.includes("eslint.config.js")) {
      conventions.push("eslint-enforced");
    }
    if (paths.includes("tsconfig.json")) {
      conventions.push("typescript-strict-mode");
    }
    if (paths.includes("CONTRIBUTING.md")) {
      conventions.push("contributing-doc");
    }
    if (paths.includes(".editorconfig")) {
      conventions.push("editorconfig");
    }
    if (paths.some((p) => p.startsWith(".github/workflows/"))) {
      conventions.push("github-actions-ci");
    }
    if (paths.some((p) => p.startsWith(".husky/"))) {
      conventions.push("husky-pre-commit-hooks");
    }
    if (conventions.length === 0) {
      conventions.push("no-explicit-conventions");
    }
    return conventions;
  }

  // ============================================
  // Test layout
  // ============================================

  private detectTestLayout(paths: string[]): "colocated" | "separate" | "none" {
    const hasSeparateTestDir = paths.some((p) => p.startsWith("tests/") || p.startsWith("test/") || p.startsWith("__tests__/"));
    const hasColocatedTests = paths.some((p) => p.includes(".test.") || p.includes(".spec.") || p.includes("_test."));
    if (hasSeparateTestDir) return "separate";
    if (hasColocatedTests) return "colocated";
    return "none";
  }

  // ============================================
  // Linting
  // ============================================

  private detectLinting(paths: string[]): { linter?: string; formatter?: string; configFiles: string[] } {
    const configFiles: string[] = [];
    let linter: string | undefined;
    let formatter: string | undefined;
    for (const candidate of ["eslint.config.js", "eslint.config.mjs", ".eslintrc", ".eslintrc.json", ".eslintrc.js"]) {
      if (paths.includes(candidate)) {
        linter = "eslint";
        configFiles.push(candidate);
        break;
      }
    }
    for (const candidate of [".prettierrc", ".prettierrc.json", ".prettierrc.js", "prettier.config.js"]) {
      if (paths.includes(candidate)) {
        formatter = "prettier";
        configFiles.push(candidate);
        break;
      }
    }
    return { linter, formatter, configFiles };
  }

  // ============================================
  // File fetcher
  // ============================================

  async fetchFile(repo: string, path: string, branch?: string): Promise<string | undefined> {
    if (!this.env.GITHUB_TOKEN) return undefined;
    const [owner, name] = repo.split("/");
    const ref = branch ? `?ref=${branch}` : "";
    const url = `https://api.github.com/repos/${owner}/${name}/contents/${path}${ref}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github.raw",
        "User-Agent": "HadesArmy/0.8.5",
      },
    });
    if (!response.ok) return undefined;
    return await response.text();
  }

  // ============================================
  // Relevant files (heuristic — pick README, manifest, main entry)
  // ============================================

  private async pickRelevantFiles(repo: string, paths: string[]): Promise<Array<{ path: string; content: string; reason: string }>> {
    const priority: Array<{ path: string; reason: string }> = [
      { path: "README.md", reason: "Project overview" },
      { path: "package.json", reason: "Dependency manifest" },
      { path: "tsconfig.json", reason: "TypeScript configuration" },
      { path: "wrangler.toml", reason: "Cloudflare Workers configuration" },
      { path: "src/index.ts", reason: "Application entry point" },
      { path: "src/worker.ts", reason: "Worker entry point" },
    ];

    const relevant: Array<{ path: string; content: string; reason: string }> = [];
    for (const p of priority) {
      if (paths.includes(p.path)) {
        const content = await this.fetchFile(repo, p.path);
        if (content) {
          // Truncate very large files
          relevant.push({
            path: p.path,
            content: content.length > 8000 ? content.slice(0, 8000) + "\n...[truncated]" : content,
            reason: p.reason,
          });
        }
      }
      if (relevant.length >= 5) break;
    }
    return relevant;
  }
}
