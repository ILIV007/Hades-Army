/**
 * Repository Validator - Cloudflare Workers Edition
 * Hades Army v9.5 — Repository Validation
 *
 * Priority 5: Before connecting a repository, the Manager validates:
 *   - Repository exists
 *   - GitHub access (token has permission)
 *   - Default branch
 *   - Permission level (read/write)
 *   - Project language
 *   - Framework detection
 *   - Project size
 *   - License
 *   - Private/Public visibility
 *   - Estimated indexing time
 *
 * If any check fails, the exact reason is shown to the user.
 */

import { logger } from "../utils/logger";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export type ValidationCheckStatus = "pass" | "fail" | "warning";

export interface ValidationCheck {
  name: string;
  emoji: string;
  status: ValidationCheckStatus;
  detail: string;
}

export interface RepositoryValidationResult {
  ok: boolean;
  repositoryFullName: string;
  checks: ValidationCheck[];
  summary: {
    exists: boolean;
    accessible: boolean;
    defaultBranch: string;
    canWrite: boolean;
    language: string;
    framework: string | null;
    sizeKb: number;
    license: string | null;
    visibility: "public" | "private";
    estimatedIndexMinutes: number;
  };
  error?: string;
}

// ============================================
// Validator
// ============================================

export class RepositoryValidator {
  private env: HadesBindings;

  constructor(env: HadesBindings) {
    this.env = env;
  }

  async validate(repositoryFullName: string): Promise<RepositoryValidationResult> {
    logger.info("RepoValidator: validating", { repositoryFullName });

    const checks: ValidationCheck[] = [];
    const [owner, name] = repositoryFullName.split("/");
    if (!owner || !name) {
      return {
        ok: false,
        repositoryFullName,
        checks: [],
        summary: this.emptySummary(),
        error: `Invalid format: expected "owner/name", got "${repositoryFullName}"`,
      };
    }

    if (!this.env.GITHUB_TOKEN) {
      return {
        ok: false,
        repositoryFullName,
        checks: [],
        summary: this.emptySummary(),
        error: "GITHUB_TOKEN is not configured on the Worker. The admin must set it via `wrangler secret put GITHUB_TOKEN`.",
      };
    }

    // === Check 1: Repository exists + GitHub access ===
    let repoData: any = null;
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
        headers: {
          Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "HadesArmy/9.5",
        },
      });

      if (res.status === 404) {
        checks.push({ name: "Repository exists", emoji: "📦", status: "fail", detail: `Repository "${repositoryFullName}" not found. Check the spelling or make sure it's not private with a token that lacks access.` });
        return this.buildResult(repositoryFullName, checks, this.emptySummary(), "Repository not found (404)");
      }
      if (res.status === 403) {
        checks.push({ name: "GitHub access", emoji: "🔑", status: "fail", detail: "GitHub API returned 403 — rate limit or token lacks permission." });
        return this.buildResult(repositoryFullName, checks, this.emptySummary(), "GitHub API 403");
      }
      if (!res.ok) {
        checks.push({ name: "GitHub access", emoji: "🔑", status: "fail", detail: `GitHub API returned ${res.status}` });
        return this.buildResult(repositoryFullName, checks, this.emptySummary(), `GitHub API ${res.status}`);
      }

      repoData = await res.json();
      checks.push({ name: "Repository exists", emoji: "📦", status: "pass", detail: `Found: ${repoData.full_name}` });
      checks.push({ name: "GitHub access", emoji: "🔑", status: "pass", detail: "Token has read access" });
    } catch (err) {
      checks.push({ name: "GitHub access", emoji: "🔑", status: "fail", detail: `Network error: ${err instanceof Error ? err.message : String(err)}` });
      return this.buildResult(repositoryFullName, checks, this.emptySummary(), "Network error");
    }

    // === Check 2: Default branch ===
    const defaultBranch = repoData.default_branch ?? "main";
    checks.push({ name: "Default branch", emoji: "🌿", status: "pass", detail: defaultBranch });

    // === Check 3: Permission level ===
    const canWrite = repoData.permissions?.push === true || repoData.permissions?.admin === true;
    if (canWrite) {
      checks.push({ name: "Write permission", emoji: "✏️", status: "pass", detail: "Token can push to this repository" });
    } else {
      checks.push({ name: "Write permission", emoji: "✏️", status: "warning", detail: "Token has read-only access — Build mode will not be able to create PRs. Use a token with `repo` scope." });
    }

    // === Check 4: Language ===
    const language = repoData.language ?? "Unknown";
    checks.push({ name: "Language", emoji: "💻", status: "pass", detail: language });

    // === Check 5: Framework detection ===
    let framework: string | null = null;
    try {
      const packageRes = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/package.json`, {
        headers: {
          Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github.raw",
          "User-Agent": "HadesArmy/9.5",
        },
      });
      if (packageRes.ok) {
        const pkg = await packageRes.json() as any;
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        if (deps["next"]) framework = "Next.js";
        else if (deps["hono"]) framework = "Hono";
        else if (deps["express"]) framework = "Express";
        else if (deps["@nestjs/core"]) framework = "NestJS";
        else if (deps["react"]) framework = "React";
        else if (deps["vue"]) framework = "Vue";
        else if (deps["svelte"]) framework = "Svelte";
        else if (deps["fastapi"]) framework = "FastAPI";
        else if (deps["django"]) framework = "Django";
      }
    } catch {}
    checks.push({
      name: "Framework",
      emoji: "🏗️",
      status: "pass",
      detail: framework ?? "Not detected (will be inferred during scan)",
    });

    // === Check 6: Project size ===
    const sizeKb = repoData.size ?? 0;
    const sizeMb = sizeKb / 1024;
    if (sizeMb > 500) {
      checks.push({ name: "Project size", emoji: "📐", status: "warning", detail: `${sizeMb.toFixed(1)} MB — large repository, indexing may take longer` });
    } else {
      checks.push({ name: "Project size", emoji: "📐", status: "pass", detail: `${sizeMb.toFixed(1)} MB` });
    }

    // === Check 7: License ===
    const license = repoData.license?.spdx_id ?? null;
    if (license) {
      checks.push({ name: "License", emoji: "📜", status: "pass", detail: license });
    } else {
      checks.push({ name: "License", emoji: "📜", status: "warning", detail: "No license detected — check before contributing" });
    }

    // === Check 8: Visibility ===
    const visibility: "public" | "private" = repoData.private ? "private" : "public";
    checks.push({
      name: "Visibility",
      emoji: repoData.private ? "🔒" : "🌐",
      status: "pass",
      detail: visibility === "private" ? "Private repository" : "Public repository",
    });

    // === Check 9: Estimated indexing time ===
    // Rough: 1 minute per 10 MB, min 1 minute
    const estimatedIndexMinutes = Math.max(1, Math.round(sizeMb / 10));
    checks.push({
      name: "Indexing estimate",
      emoji: "⏱️",
      status: "pass",
      detail: `~${estimatedIndexMinutes} minute(s)`,
    });

    const allOk = checks.every((c) => c.status !== "fail");
    const summary = {
      exists: true,
      accessible: true,
      defaultBranch,
      canWrite,
      language,
      framework,
      sizeKb,
      license,
      visibility,
      estimatedIndexMinutes,
    };

    logger.info("RepoValidator: validation complete", { repositoryFullName, allOk, checks: checks.length });
    return { ok: allOk, repositoryFullName, checks, summary };
  }

  private emptySummary() {
    return {
      exists: false,
      accessible: false,
      defaultBranch: "",
      canWrite: false,
      language: "",
      framework: null,
      sizeKb: 0,
      license: null,
      visibility: "public" as const,
      estimatedIndexMinutes: 0,
    };
  }

  private buildResult(
    repositoryFullName: string,
    checks: ValidationCheck[],
    summary: RepositoryValidationResult["summary"],
    error: string,
  ): RepositoryValidationResult {
    return { ok: false, repositoryFullName, checks, summary, error };
  }

  /**
   * Render for Telegram.
   */
  render(result: RepositoryValidationResult): string {
    const lines: string[] = [
      `🔍 *Repository Validation*`,
      ``,
      `*Repository:* \`${result.repositoryFullName}\``,
      ``,
    ];

    for (const check of result.checks) {
      const icon = check.status === "pass" ? "✅" : check.status === "warning" ? "⚠️" : "❌";
      lines.push(`${icon} ${check.emoji} *${check.name}*`);
      lines.push(`   ${check.detail}`);
    }

    if (result.error) {
      lines.push(``);
      lines.push(`❌ *Error:* ${result.error}`);
    }

    return lines.join("\n");
  }
}

// ============================================
// Factory
// ============================================

let _instance: RepositoryValidator | null = null;

export function getRepositoryValidator(env: HadesBindings): RepositoryValidator {
  if (!_instance) _instance = new RepositoryValidator(env);
  return _instance;
}
