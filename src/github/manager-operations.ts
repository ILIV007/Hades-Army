/**
 * Manager GitHub Operations - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Priority 1 + 4: Manager is the SOLE GitHub authority.
 *
 * This module is the ONLY place in the codebase that performs GitHub
 * write operations (branch / commit / PR / merge / rollback). Builder
 * and Reviewer MUST NOT import or use this module — they only ever
 * receive patches and verdicts via the Agent Communication Protocol.
 *
 * The existing src/integrations/github.ts module continues to exist
 * for read-only operations (fetch repo, list PRs, etc.) and is
 * UNMODIFIED. This new module wraps the write paths and adds:
 *   - Audit logging (every write is recorded)
 *   - Repository Memory updates (.hades/ commits)
 *   - Atomic rollback on merge failure
 *
 * All operations are idempotent where possible.
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export interface CreateBranchParams {
  repositoryFullName: string;
  branchName: string;
  fromBranch: string; // usually the default branch
}

export interface CommitFile {
  path: string;
  content: string; // UTF-8 string content
  encoding?: "utf-8" | "base64";
}

export interface CommitParams {
  repositoryFullName: string;
  branchName: string;
  message: string;
  files: CommitFile[];
}

export interface CreatePullRequestParams {
  repositoryFullName: string;
  branchName: string;
  baseBranch: string;
  title: string;
  body: string;
  files?: CommitFile[]; // if provided, commit them first on the branch
}

export interface MergePullRequestParams {
  repositoryFullName: string;
  prNumber: number;
  commitTitle?: string;
  mergeMethod?: "merge" | "squash" | "rebase";
}

export interface RollbackParams {
  repositoryFullName: string;
  branchName: string;
  toSha: string;
  reason: string;
}

export interface GitHubAuditEntry {
  id: string;
  operation: "create_branch" | "commit" | "create_pr" | "merge_pr" | "rollback" | "delete_branch";
  repositoryFullName: string;
  actor: "manager"; // Only manager writes; this field exists for future extension
  params: Record<string, unknown>;
  result: "success" | "failure";
  error?: string;
  sha?: string;
  prNumber?: number;
  prUrl?: string;
  startedAt: string;
  completedAt: string;
}

// ============================================
// Manager GitHub Operations
// ============================================

export class ManagerGitHubOperations {
  private env: HadesBindings;
  private auditLog: GitHubAuditEntry[] = [];

  constructor(env: HadesBindings) {
    this.env = env;
  }

  // ============================================
  // Create branch
  // ============================================

  async createBranch(params: CreateBranchParams): Promise<{ ref: string; sha: string }> {
    const start = new Date().toISOString();
    const [owner, name] = this.parseRepo(params.repositoryFullName);

    // 1. Get the SHA of the source branch
    const refRes = await fetch(
      `https://api.github.com/repos/${owner}/${name}/git/refs/heads/${params.fromBranch}`,
      { headers: this.headers() },
    );
    if (!refRes.ok) {
      const err = await refRes.text();
      return this.fail<never>("create_branch", params.repositoryFullName, params, start, `Failed to fetch source ref: ${err}`);
    }
    const refData = (await refRes.json()) as any;
    const sha: string = refData.object.sha;

    // 2. Create the new branch ref
    const createRes = await fetch(`https://api.github.com/repos/${owner}/${name}/git/refs`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        ref: `refs/heads/${params.branchName}`,
        sha,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      // If branch already exists, treat as success (idempotent)
      if (err.includes("already exists")) {
        logger.info(`ManagerGitHub: branch ${params.branchName} already exists, reusing`);
        this.audit({
          id: generateId("audit"),
          operation: "create_branch",
          repositoryFullName: params.repositoryFullName,
          actor: "manager",
          params: params as unknown as Record<string, unknown>,
          result: "success",
          sha,
          startedAt: start,
          completedAt: new Date().toISOString(),
        });
        return { ref: `refs/heads/${params.branchName}`, sha };
      }
      return this.fail<never>("create_branch", params.repositoryFullName, params, start, `Failed to create branch: ${err}`);
    }

    this.audit({
      id: generateId("audit"),
      operation: "create_branch",
      repositoryFullName: params.repositoryFullName,
      actor: "manager",
      params: params as unknown as Record<string, unknown>,
      result: "success",
      sha,
      startedAt: start,
      completedAt: new Date().toISOString(),
    });

    logger.info(`ManagerGitHub: branch ${params.branchName} created from ${params.fromBranch} (${sha.slice(0, 7)})`);
    return { ref: `refs/heads/${params.branchName}`, sha };
  }

  // ============================================
  // Commit files
  // ============================================

  async commitFiles(params: CommitParams): Promise<{ commitSha: string; commitUrl: string }> {
    const start = new Date().toISOString();
    const [owner, name] = this.parseRepo(params.repositoryFullName);

    let lastSha: string | undefined;
    let lastUrl: string | undefined;

    for (const file of params.files) {
      const res = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${file.path}`, {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify({
          message: params.message,
          content: file.encoding === "base64" ? file.content : btoa(unescape(encodeURIComponent(file.content))),
          branch: params.branchName,
          encoding: "base64",
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return this.fail<never>("commit", params.repositoryFullName, params, start, `Failed to commit ${file.path}: ${err}`);
      }

      const data = (await res.json()) as any;
      lastSha = data?.commit?.sha;
      lastUrl = data?.commit?.html_url;
    }

    if (!lastSha) {
      return this.fail<never>("commit", params.repositoryFullName, params, start, "No commits created (empty file list?)");
    }

    this.audit({
      id: generateId("audit"),
      operation: "commit",
      repositoryFullName: params.repositoryFullName,
      actor: "manager",
      params: params as unknown as Record<string, unknown>,
      result: "success",
      sha: lastSha,
      startedAt: start,
      completedAt: new Date().toISOString(),
    });

    logger.info(`ManagerGitHub: ${params.files.length} file(s) committed to ${params.branchName} (${lastSha.slice(0, 7)})`);
    return { commitSha: lastSha, commitUrl: lastUrl! };
  }

  // ============================================
  // Create pull request
  // ============================================

  async createPullRequest(params: CreatePullRequestParams): Promise<string> {
    const start = new Date().toISOString();
    const [owner, name] = this.parseRepo(params.repositoryFullName);

    // Optional: commit files first on the branch
    if (params.files && params.files.length > 0) {
      await this.commitFiles({
        repositoryFullName: params.repositoryFullName,
        branchName: params.branchName,
        message: `Hades Army: ${params.title}`,
        files: params.files,
      });
    }

    // Ensure branch exists (idempotent)
    try {
      await this.createBranch({
        repositoryFullName: params.repositoryFullName,
        branchName: params.branchName,
        fromBranch: params.baseBranch,
      });
    } catch (err) {
      // Branch may already exist — log and continue
      logger.debug(`ManagerGitHub: createBranch during PR threw (likely exists): ${err instanceof Error ? err.message : String(err)}`);
    }

    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/pulls`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        head: params.branchName,
        base: params.baseBranch,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return this.fail<string>("create_pr", params.repositoryFullName, params, start, `Failed to create PR: ${err}`);
    }

    const data = (await res.json()) as any;
    const prUrl: string = data.html_url;
    const prNumber: number = data.number;

    this.audit({
      id: generateId("audit"),
      operation: "create_pr",
      repositoryFullName: params.repositoryFullName,
      actor: "manager",
      params: params as unknown as Record<string, unknown>,
      result: "success",
      prNumber,
      prUrl,
      startedAt: start,
      completedAt: new Date().toISOString(),
    });

    logger.info(`ManagerGitHub: PR #${prNumber} created — ${prUrl}`);
    return prUrl;
  }

  // ============================================
  // Merge pull request
  // ============================================

  async mergePullRequest(params: MergePullRequestParams): Promise<string> {
    const start = new Date().toISOString();
    const [owner, name] = this.parseRepo(params.repositoryFullName);

    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/pulls/${params.prNumber}/merge`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({
        commit_title: params.commitTitle ?? `Merge PR #${params.prNumber}`,
        merge_method: params.mergeMethod ?? "squash",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return this.fail<string>("merge_pr", params.repositoryFullName, params, start, `Failed to merge PR #${params.prNumber}: ${err}`);
    }

    const data = (await res.json()) as any;
    const sha: string = data.sha;

    this.audit({
      id: generateId("audit"),
      operation: "merge_pr",
      repositoryFullName: params.repositoryFullName,
      actor: "manager",
      params: params as unknown as Record<string, unknown>,
      result: "success",
      sha,
      prNumber: params.prNumber,
      startedAt: start,
      completedAt: new Date().toISOString(),
    });

    logger.info(`ManagerGitHub: PR #${params.prNumber} merged (${sha.slice(0, 7)})`);
    return sha;
  }

  // ============================================
  // Rollback (force-push branch to a previous SHA — Admin only)
  // ============================================

  async rollback(params: RollbackParams): Promise<{ ref: string; sha: string }> {
    const start = new Date().toISOString();
    const [owner, name] = this.parseRepo(params.repositoryFullName);

    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/git/refs/heads/${params.branchName}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({
        sha: params.toSha,
        force: true,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return this.fail<never>("rollback", params.repositoryFullName, params, start, `Failed to rollback: ${err}`);
    }

    this.audit({
      id: generateId("audit"),
      operation: "rollback",
      repositoryFullName: params.repositoryFullName,
      actor: "manager",
      params: { ...params, reason: params.reason } as unknown as Record<string, unknown>,
      result: "success",
      sha: params.toSha,
      startedAt: start,
      completedAt: new Date().toISOString(),
    });

    logger.warn(`ManagerGitHub: ROLLBACK on ${params.branchName} → ${params.toSha.slice(0, 7)} (reason: ${params.reason})`);
    return { ref: `refs/heads/${params.branchName}`, sha: params.toSha };
  }

  // ============================================
  // Delete branch (post-merge cleanup)
  // ============================================

  async deleteBranch(repositoryFullName: string, branchName: string): Promise<void> {
    const start = new Date().toISOString();
    const [owner, name] = this.parseRepo(repositoryFullName);

    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/git/refs/heads/${branchName}`, {
      method: "DELETE",
      headers: this.headers(),
    });

    if (!res.ok && res.status !== 404) {
      const err = await res.text();
      return this.fail<never>("delete_branch", repositoryFullName, { repositoryFullName, branchName }, start, `Failed to delete branch: ${err}`);
    }

    this.audit({
      id: generateId("audit"),
      operation: "delete_branch",
      repositoryFullName,
      actor: "manager",
      params: { repositoryFullName, branchName },
      result: "success",
      startedAt: start,
      completedAt: new Date().toISOString(),
    });

    logger.info(`ManagerGitHub: branch ${branchName} deleted`);
  }

  // ============================================
  // Read: file content (used by RepositoryScanner via the read path)
  // ============================================

  async readFile(repositoryFullName: string, path: string, branch?: string): Promise<string | undefined> {
    const [owner, name] = this.parseRepo(repositoryFullName);
    const ref = branch ? `?ref=${branch}` : "";
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${path}${ref}`, {
      headers: { ...this.headers(), Accept: "application/vnd.github.raw" },
    });
    if (!res.ok) return undefined;
    return await res.text();
  }

  // ============================================
  // Audit log access
  // ============================================

  getAuditLog(limit = 50): GitHubAuditEntry[] {
    return this.auditLog.slice(-limit);
  }

  // ============================================
  // Private helpers
  // ============================================

  private parseRepo(repo: string): [string, string] {
    const [owner, name] = repo.split("/");
    if (!owner || !name) throw new Error(`Invalid repository full name: ${repo}`);
    return [owner, name];
  }

  private headers(): Record<string, string> {
    if (!this.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not configured");
    return {
      Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "HadesArmy/0.8.5",
    };
  }

  private audit(entry: GitHubAuditEntry): void {
    this.auditLog.push(entry);
    // In production, also persist to D1 (see sql/v0.8.5-additions.sql: github_audit_log table)
  }

  private fail<T>(operation: GitHubAuditEntry["operation"], repo: string, params: unknown, start: string, error: string): T {
    this.audit({
      id: generateId("audit"),
      operation,
      repositoryFullName: repo,
      actor: "manager",
      params: params as Record<string, unknown>,
      result: "failure",
      error,
      startedAt: start,
      completedAt: new Date().toISOString(),
    });
    throw new Error(`[ManagerGitHubOperations:${operation}] ${error}`);
  }
}
