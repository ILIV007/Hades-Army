/**
 * Hades Army v0.2 — GitHub Repository Client
 * Repository scanning, file access, and tree operations.
 * Extends GitHubBaseClient. Pure ESM.
 */

import type { HadesEnv } from "../../config/env";
import type { Project } from "../../types";
import { GitHubBaseClient } from "./base.client";
import { Logger } from "../../utils/logger";
import { withRetry } from "../../utils/helpers";

export class GitHubRepoClient extends GitHubBaseClient {
  private logger: Logger;

  constructor(env: HadesEnv, project: Project) {
    super(env, project);
    this.logger = new Logger(env, project.id);
  }

  // ============================================================
  // REPOSITORY TREE
  // ============================================================

  async getTree(branch?: string): Promise<
    Array<{ path: string; type: string; sha: string; size?: number }>
  > {
    const ref = branch ?? this.project.defaultBranch;

    return withRetry(async () => {
      const data = await this.get<{ tree: Array<{ path: string; type: string; sha: string; size?: number }> }>(
        `/repos/${this.repoPath}/git/trees/${ref}?recursive=1`
      );
      return data.tree;
    });
  }

  // ============================================================
  // FILE CONTENT
  // ============================================================

  async getFileContent(path: string, branch?: string): Promise<string | null> {
    const ref = branch ?? this.project.defaultBranch;

    return withRetry(async () => {
      const headers = await this.headers();
      const res = await fetch(
        `${this.apiBase}/repos/${this.repoPath}/contents/${path}?ref=${ref}`,
        { headers }
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub content error: ${res.status}`);

      const data = (await res.json()) as { content: string; encoding: string };
      if (data.encoding === "base64") {
        return atob(data.content.replace(/\s/g, ""));
      }
      return data.content;
    });
  }

  // ============================================================
  // REPOSITORY INFO
  // ============================================================

  async getRepoInfo(): Promise<{
    defaultBranch: string;
    description: string | null;
    language: string | null;
    stars: number;
    forks: number;
  }> {
    const data = await this.get<{
      default_branch: string;
      description: string | null;
      language: string | null;
      stargazers_count: number;
      forks_count: number;
    }>(`/repos/${this.repoPath}`);

    return {
      defaultBranch: data.default_branch,
      description: data.description,
      language: data.language,
      stars: data.stargazers_count,
      forks: data.forks_count,
    };
  }

  // ============================================================
  // README
  // ============================================================

  async getReadme(branch?: string): Promise<string | null> {
    const ref = branch ?? this.project.defaultBranch;

    try {
      const headers = await this.headers();
      const res = await fetch(
        `${this.apiBase}/repos/${this.repoPath}/readme?ref=${ref}`,
        { headers }
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub readme error: ${res.status}`);

      const data = (await res.json()) as { content: string; encoding: string };
      if (data.encoding === "base64") {
        return atob(data.content.replace(/\s/g, ""));
      }
      return data.content;
    } catch {
      return null;
    }
  }
}
