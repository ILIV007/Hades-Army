/**
 * Hades Army — GitHub Pull Request Client
 * PR creation, tracking, and management.
 */

import type { HadesEnv } from '../config/env';
import type { Project, GitHubPR } from '../types';
import { Logger } from '../utils/logger';
import { withRetry } from '../utils/helpers';

export class GitHubPRClient {
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
      'Content-Type': 'application/json',
    };
  }

  private get repoPath() {
    return `${this.project.repoOwner}/${this.project.repoName}`;
  }

  // ============================================================
  // CREATE PR
  // ============================================================

  async create(
    title: string,
    head: string,
    base: string,
    body: string
  ): Promise<GitHubPR> {
    const headers = await this.headers();

    return withRetry(async () => {
      const res = await fetch(
        `${this.apiBase}/repos/${this.repoPath}/pulls`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ title, head, base, body }),
        }
      );
      if (!res.ok) throw new Error(`Failed to create PR: ${res.status}`);

      const data = await res.json() as {
        number: number;
        title: string;
        body: string;
        head: { ref: string };
        base: { ref: string };
        state: 'open' | 'closed' | 'merged';
        url: string;
        html_url: string;
      };

      await this.logger.info('github', `Created PR #${data.number}: ${title}`);

      return {
        number: data.number,
        title: data.title,
        body: data.body,
        head: data.head.ref,
        base: data.base.ref,
        state: data.state,
        url: data.url,
        htmlUrl: data.html_url,
      };
    });
  }

  // ============================================================
  // GET PR
  // ============================================================

  async get(number: number): Promise<GitHubPR> {
    const headers = await this.headers();

    const res = await fetch(
      `${this.apiBase}/repos/${this.repoPath}/pulls/${number}`,
      { headers }
    );
    if (!res.ok) throw new Error(`Failed to get PR: ${res.status}`);

    const data = await res.json() as {
      number: number;
      title: string;
      body: string;
      head: { ref: string };
      base: { ref: string };
      state: 'open' | 'closed' | 'merged';
      url: string;
      html_url: string;
    };

    return {
      number: data.number,
      title: data.title,
      body: data.body,
      head: data.head.ref,
      base: data.base.ref,
      state: data.state,
      url: data.url,
      htmlUrl: data.html_url,
    };
  }

  // ============================================================
  // MERGE PR
  // ============================================================

  async merge(number: number, commitMessage?: string): Promise<void> {
    const headers = await this.headers();

    const res = await fetch(
      `${this.apiBase}/repos/${this.repoPath}/pulls/${number}/merge`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          commit_title: commitMessage ?? `Merge PR #${number}`,
          merge_method: 'squash',
        }),
      }
    );
    if (!res.ok) throw new Error(`Failed to merge PR: ${res.status}`);

    await this.logger.info('github', `Merged PR #${number}`);
  }

  // ============================================================
  // LIST PRs
  // ============================================================

  async list(state: 'open' | 'closed' | 'all' = 'open'): Promise<GitHubPR[]> {
    const headers = await this.headers();

    const res = await fetch(
      `${this.apiBase}/repos/${this.repoPath}/pulls?state=${state}`,
      { headers }
    );
    if (!res.ok) throw new Error(`Failed to list PRs: ${res.status}`);

    const data = await res.json() as Array<{
      number: number;
      title: string;
      body: string;
      head: { ref: string };
      base: { ref: string };
      state: 'open' | 'closed' | 'merged';
      url: string;
      html_url: string;
    }>;

    return data.map(pr => ({
      number: pr.number,
      title: pr.title,
      body: pr.body,
      head: pr.head.ref,
      base: pr.base.ref,
      state: pr.state,
      url: pr.url,
      htmlUrl: pr.html_url,
    }));
  }
}
