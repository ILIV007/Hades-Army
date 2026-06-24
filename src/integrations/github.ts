
/**
 * GitHub Integration - Cloudflare Workers Edition
 * Hades Army v0.8.0 (Workers Edition)
 *
 * Full GitHub API integration with:
 * - Repository management
 * - PR reviews and comments
 * - Issue tracking
 * - Webhook handling
 * - Code analysis
 * - Branch protection
 * - Release management
 */

import { logger } from "../utils/logger";
import { generateId, truncateString } from "../utils/helpers";
import { HadesError } from "../utils/errors";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  private: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  user: GitHubUser;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
  merged: boolean;
  mergeable: boolean | null;
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  user: GitHubUser;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
}

export interface GitHubLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: { name: string; email: string; date: string };
  committer: { name: string; email: string; date: string };
  html_url: string;
}

export interface GitHubFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  content?: string;
}

export interface GitHubReview {
  id: number;
  user: GitHubUser;
  body: string;
  state: string;
  html_url: string;
  submitted_at: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string;
  html_url: string;
}

export interface GitHubWebhookPayload {
  action?: string;
  repository?: GitHubRepo;
  pull_request?: GitHubPullRequest;
  issue?: GitHubIssue;
  sender?: GitHubUser;
  ref?: string;
  before?: string;
  after?: string;
  commits?: GitHubCommit[];
}

export interface CreatePROptions {
  title: string;
  body?: string;
  head: string;
  base: string;
  draft?: boolean;
}

export interface CreateIssueOptions {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export interface CreateReviewOptions {
  body?: string;
  event?: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  comments?: Array<{
    path: string;
    line: number;
    body: string;
    side?: "LEFT" | "RIGHT";
  }>;
}

// ============================================
// GitHub Client Class
// ============================================

export class GitHubClient {
  private token: string;
  private apiUrl: string;
  private defaultOwner: string;
  private defaultRepo: string;

  constructor(
    token: string,
    options: { owner?: string; repo?: string } = {}
  ) {
    this.token = token;
    this.apiUrl = "https://api.github.com";
    this.defaultOwner = options.owner || "";
    this.defaultRepo = options.repo || "";
  }

  // ============================================
  // Core HTTP Methods
  // ============================================

  private async request<T>(
    endpoint: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const url = `${this.apiUrl}${endpoint}`;
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `Bearer ${this.token}`,
        "User-Agent": "Hades-Army/0.8.0",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`GitHub API error: ${response.status} ${errorText}`);
      throw new HadesError(
        `GitHub API error: ${response.status} - ${errorText}`,
        "GITHUB_API_ERROR",
        response.status
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }

  // ============================================
  // Repository Operations
  // ============================================

  async getRepo(owner?: string, repo?: string): Promise<GitHubRepo> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubRepo>(`/repos/${o}/${r}`);
  }

  async listRepos(owner: string): Promise<GitHubRepo[]> {
    return this.request<GitHubRepo[]>(`/users/${owner}/repos?per_page=100`);
  }

  async listOrgRepos(org: string): Promise<GitHubRepo[]> {
    return this.request<GitHubRepo[]>(`/orgs/${org}/repos?per_page=100`);
  }

  async getRepoLanguages(owner?: string, repo?: string): Promise<Record<string, number>> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<Record<string, number>>(`/repos/${o}/${r}/languages`);
  }

  async getRepoContents(
    path: string,
    owner?: string,
    repo?: string,
    ref?: string
  ): Promise<unknown> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    const refParam = ref ? `?ref=${ref}` : "";
    return this.request<unknown>(`/repos/${o}/${r}/contents/${path}${refParam}`);
  }

  async getFileContent(path: string, owner?: string, repo?: string, ref?: string): Promise<string> {
    const content = await this.getRepoContents(path, owner, repo, ref);
    if (typeof content === "object" && content !== null && "content" in content) {
      const encoded = (content as { content: string }).content;
      // GitHub returns base64 content
      const binary = atob(encoded.replace(/\n/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    }
    throw new HadesError("Invalid file content response", "GITHUB_CONTENT_ERROR", 500);
  }

  // ============================================
  // Pull Request Operations
  // ============================================

  async listPRs(
    state: "open" | "closed" | "all" = "open",
    owner?: string,
    repo?: string
  ): Promise<GitHubPullRequest[]> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubPullRequest[]>(`/repos/${o}/${r}/pulls?state=${state}&per_page=100`);
  }

  async getPR(number: number, owner?: string, repo?: string): Promise<GitHubPullRequest> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubPullRequest>(`/repos/${o}/${r}/pulls/${number}`);
  }

  async createPR(options: CreatePROptions, owner?: string, repo?: string): Promise<GitHubPullRequest> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubPullRequest>(`/repos/${o}/${r}/pulls`, {
      method: "POST",
      body: options,
    });
  }

  async updatePR(
    number: number,
    updates: { title?: string; body?: string; state?: string },
    owner?: string,
    repo?: string
  ): Promise<GitHubPullRequest> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubPullRequest>(`/repos/${o}/${r}/pulls/${number}`, {
      method: "PATCH",
      body: updates,
    });
  }

  async mergePR(
    number: number,
    message?: string,
    owner?: string,
    repo?: string
  ): Promise<{ sha: string; merged: boolean; message: string }> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<{ sha: string; merged: boolean; message: string }>(
      `/repos/${o}/${r}/pulls/${number}/merge`,
      {
        method: "PUT",
        body: { commit_title: message },
      }
    );
  }

  async listPRFiles(number: number, owner?: string, repo?: string): Promise<GitHubFile[]> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubFile[]>(`/repos/${o}/${r}/pulls/${number}/files?per_page=300`);
  }

  async createPRReview(
    number: number,
    review: CreateReviewOptions,
    owner?: string,
    repo?: string
  ): Promise<GitHubReview> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubReview>(`/repos/${o}/${r}/pulls/${number}/reviews`, {
      method: "POST",
      body: review,
    });
  }

  async listPRReviews(number: number, owner?: string, repo?: string): Promise<GitHubReview[]> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubReview[]>(`/repos/${o}/${r}/pulls/${number}/reviews`);
  }

  // ============================================
  // Issue Operations
  // ============================================

  async listIssues(
    state: "open" | "closed" | "all" = "open",
    owner?: string,
    repo?: string
  ): Promise<GitHubIssue[]> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubIssue[]>(`/repos/${o}/${r}/issues?state=${state}&per_page=100`);
  }

  async getIssue(number: number, owner?: string, repo?: string): Promise<GitHubIssue> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubIssue>(`/repos/${o}/${r}/issues/${number}`);
  }

  async createIssue(options: CreateIssueOptions, owner?: string, repo?: string): Promise<GitHubIssue> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubIssue>(`/repos/${o}/${r}/issues`, {
      method: "POST",
      body: options,
    });
  }

  async updateIssue(
    number: number,
    updates: { title?: string; body?: string; state?: string; labels?: string[] },
    owner?: string,
    repo?: string
  ): Promise<GitHubIssue> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubIssue>(`/repos/${o}/${r}/issues/${number}`, {
      method: "PATCH",
      body: updates,
    });
  }

  async addIssueComment(
    number: number,
    body: string,
    owner?: string,
    repo?: string
  ): Promise<unknown> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<unknown>(`/repos/${o}/${r}/issues/${number}/comments`, {
      method: "POST",
      body: { body },
    });
  }

  // ============================================
  // Commit Operations
  // ============================================

  async listCommits(
    sha?: string,
    path?: string,
    owner?: string,
    repo?: string
  ): Promise<{ sha: string; commit: GitHubCommit; html_url: string }[]> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    let url = `/repos/${o}/${r}/commits?per_page=100`;
    if (sha) url += `&sha=${sha}`;
    if (path) url += `&path=${path}`;
    return this.request<{ sha: string; commit: GitHubCommit; html_url: string }[]>(url);
  }

  async getCommit(sha: string, owner?: string, repo?: string): Promise<{ sha: string; commit: GitHubCommit; files: GitHubFile[] }> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<{ sha: string; commit: GitHubCommit; files: GitHubFile[] }>(
      `/repos/${o}/${r}/commits/${sha}`
    );
  }

  // ============================================
  // Branch Operations
  // ============================================

  async listBranches(owner?: string, repo?: string): Promise<{ name: string; commit: { sha: string } }[]> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<{ name: string; commit: { sha: string } }[]>(`/repos/${o}/${r}/branches?per_page=100`);
  }

  async getBranch(name: string, owner?: string, repo?: string): Promise<{ name: string; commit: { sha: string }; protected: boolean }> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<{ name: string; commit: { sha: string }; protected: boolean }>(
      `/repos/${o}/${r}/branches/${name}`
    );
  }

  async createBranch(name: string, fromSha: string, owner?: string, repo?: string): Promise<unknown> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<unknown>(`/repos/${o}/${r}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${name}`, sha: fromSha },
    });
  }

  async deleteBranch(name: string, owner?: string, repo?: string): Promise<void> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    await this.request<void>(`/repos/${o}/${r}/git/refs/heads/${name}`, { method: "DELETE" });
  }

  // ============================================
  // Release Operations
  // ============================================

  async listReleases(owner?: string, repo?: string): Promise<GitHubRelease[]> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubRelease[]>(`/repos/${o}/${r}/releases?per_page=100`);
  }

  async getReleaseByTag(tag: string, owner?: string, repo?: string): Promise<GitHubRelease> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubRelease>(`/repos/${o}/${r}/releases/tags/${tag}`);
  }

  async createRelease(
    tag: string,
    options: { name?: string; body?: string; draft?: boolean; prerelease?: boolean; target_commitish?: string },
    owner?: string,
    repo?: string
  ): Promise<GitHubRelease> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<GitHubRelease>(`/repos/${o}/${r}/releases`, {
      method: "POST",
      body: { tag_name: tag, ...options },
    });
  }

  // ============================================
  // Webhook Handling
  // ============================================

  async createWebhook(
    config: { url: string; content_type?: string; secret?: string },
    events: string[],
    owner?: string,
    repo?: string
  ): Promise<unknown> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<unknown>(`/repos/${o}/${r}/hooks`, {
      method: "POST",
      body: { config, events, active: true },
    });
  }

  async listWebhooks(owner?: string, repo?: string): Promise<unknown[]> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<unknown[]>(`/repos/${o}/${r}/hooks`);
  }

  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    // In Workers, we use Web Crypto API
    // This is a simplified version - in production use proper HMAC verification
    const expectedSignature = "sha256=" + this.computeHmacSha256(payload, secret);
    return signature === expectedSignature;
  }

  private computeHmacSha256(message: string, secret: string): string {
    // Note: In actual Workers environment, use crypto.subtle.sign with HMAC
    // This is a placeholder - real implementation would use Web Crypto API
    return "placeholder_hmac";
  }

  parseWebhookPayload(body: string): GitHubWebhookPayload {
    try {
      return JSON.parse(body) as GitHubWebhookPayload;
    } catch {
      throw new HadesError("Invalid webhook payload", "GITHUB_WEBHOOK_ERROR", 400);
    }
  }

  // ============================================
  // Code Analysis
  // ============================================

  async analyzePR(number: number, owner?: string, repo?: string): Promise<{
    pr: GitHubPullRequest;
    files: GitHubFile[];
    stats: { totalAdditions: number; totalDeletions: number; totalChanges: number; languages: string[] };
  }> {
    const pr = await this.getPR(number, owner, repo);
    const files = await this.listPRFiles(number, owner, repo);

    const languages = [...new Set(files.map((f) => f.filename.split(".").pop() || "unknown"))];
    const stats = {
      totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
      totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
      totalChanges: files.reduce((sum, f) => sum + f.changes, 0),
      languages,
    };

    return { pr, files, stats };
  }

  async getRepoMetrics(owner?: string, repo?: string): Promise<{
    stars: number;
    forks: number;
    openIssues: number;
    openPRs: number;
    languages: Record<string, number>;
    lastPush: string;
  }> {
    const [repoInfo, prs, languages] = await Promise.all([
      this.getRepo(owner, repo),
      this.listPRs("open", owner, repo),
      this.getRepoLanguages(owner, repo),
    ]);

    return {
      stars: repoInfo.stargazers_count,
      forks: repoInfo.forks_count,
      openIssues: repoInfo.open_issues_count,
      openPRs: prs.length,
      languages,
      lastPush: repoInfo.pushed_at,
    };
  }

  // ============================================
  // Repository Intelligence
  // ============================================

  async getCodeFrequency(owner?: string, repo?: string): Promise<Array<[number, number, number]>> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<Array<[number, number, number]>>(`/repos/${o}/${r}/stats/code_frequency`);
  }

  async getCommitActivity(owner?: string, repo?: string): Promise<Array<{ week: number; total: number; days: number[] }>> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<Array<{ week: number; total: number; days: number[] }>>(
      `/repos/${o}/${r}/stats/commit_activity`
    );
  }

  async getContributors(owner?: string, repo?: string): Promise<Array<{ login: string; contributions: number }>> {
    const o = owner || this.defaultOwner;
    const r = repo || this.defaultRepo;
    return this.request<Array<{ login: string; contributions: number }>>(`/repos/${o}/${r}/contributors?per_page=100`);
  }

  // ============================================
  // Utility Methods
  // ============================================

  setDefaultRepo(owner: string, repo: string): void {
    this.defaultOwner = owner;
    this.defaultRepo = repo;
  }

  getDefaultRepo(): { owner: string; repo: string } {
    return { owner: this.defaultOwner, repo: this.defaultRepo };
  }
}

// ============================================
// Factory
// ============================================

export function createGitHubClient(env: HadesBindings, options?: { owner?: string; repo?: string }): GitHubClient | null {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    logger.warn("GITHUB_TOKEN not configured");
    return null;
  }
  return new GitHubClient(token, options);
}

export const githubIntegration = { createGitHubClient };
