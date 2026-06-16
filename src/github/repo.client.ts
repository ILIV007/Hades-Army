/**
 * Hades Army — GitHub Repository Client
 * Repository scanning, file access, and tree operations.
 */

import type { HadesEnv } from '../config/env';
import type { Project } from '../types';
import { Logger } from '../utils/logger';
import { withRetry } from '../utils/helpers';

export class GitHubRepoClient {
  private logger: Logger;

  constructor(
    private env: HadesEnv,
    private project: Project
  ) {
    this.logger = new Logger(env, project.id);
  }

  private get apiBase() {
    return this.env.GITHUB_API_BASE_URL;
  }

  private async headers(): Promise<Record<string, string>> {
    const { decrypt } = require('../utils/crypto');
    const token = await decrypt(this.project.githubTokenEncrypted, this.env.ENCRYPTION_KEY);
    return {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Hades-Army/1.0',
    };
  }

  private get repoPath() {
    return `${this.project.repoOwner}/${this.project.repoName}`;
  }

  // ============================================================
  // REPOSITORY TREE
  // ============================================================

  async getTree(branch?: string): Promise<Array<{
    path: string;
    type: string;
    sha: string;
    size?: number;
  }>> {
    const headers = await this.headers();
    const ref = branch ?? this.project.defaultBranch;

    return withRetry(async () => {
      const res = await fetch(
        `${this.apiBase}/repos/${this.repoPath}/git/trees/${ref}?recursive=1`,
        { headers }
      );
      if (!res.ok) throw new Error(`GitHub tree error: ${res.status}`);
      const data = await res.json() as { tree: Array<{ path: string; type: string; sha: string; size?: number }> };
      return data.tree;
    });
  }

  // ============================================================
  // FILE CONTENT
  // ============================================================

  async getFileContent(path: string, branch?: string): Promise<string | null> {
    const headers = await this.headers();
    const ref = branch ?? this.project.defaultBranch;

    return withRetry(async () => {
      const res = await fetch(
        `${this.apiBase}/repos/${this.repoPath}/contents/${path}?ref=${ref}`,
        { headers }
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub content error: ${res.status}`);

      const data = await res.json() as { content: string; encoding: string };
      if (data.encoding === 'base64') {
        return atob(data.content.replace(/\s/g, ''));
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
    const headers = await this.headers();

    const res = await fetch(
      `${this.apiBase}/repos/${this.repoPath}`,
      { headers }
    );
    if (!res.ok) throw new Error(`GitHub repo info error: ${res.status}`);

    const data = await res.json() as {
      default_branch: string;
      description: string | null;
      language: string | null;
      stargazers_count: number;
      forks_count: number;
    };

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
    const headers = await this.headers();
    const ref = branch ?? this.project.defaultBranch;

    try {
      const res = await fetch(
        `${this.apiBase}/repos/${this.repoPath}/readme?ref=${ref}`,
        { headers }
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GitHub readme error: ${res.status}`);

      const data = await res.json() as { content: string; encoding: string };
      if (data.encoding === 'base64') {
        return atob(data.content.replace(/\s/g, ''));
      }
      return data.content;
    } catch {
      return null;
    }
  }
}
