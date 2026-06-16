/**
 * Hades Army — GitHub Branch Client
 * Branch creation, deletion, and management.
 */

import type { HadesEnv } from '../config/env';
import type { Project, GitHubBranch } from '../types';
import { Logger } from '../utils/logger';
import { withRetry } from '../utils/helpers';

export class GitHubBranchClient {
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
  // CREATE BRANCH
  // ============================================================

  async create(name: string, fromBranch?: string): Promise<GitHubBranch> {
    const headers = await this.headers();
    const base = fromBranch ?? this.project.defaultBranch;

    return withRetry(async () => {
      // Get base branch SHA
      const baseRes = await fetch(
        `${this.apiBase}/repos/${this.repoPath}/git/refs/heads/${base}`,
        { headers }
      );
      if (!baseRes.ok) throw new Error(`Failed to get base branch: ${baseRes.status}`);
      const baseData = await baseRes.json() as { object: { sha: string } };

      // Create new branch
      const res = await fetch(
        `${this.apiBase}/repos/${this.repoPath}/git/refs`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ref: `refs/heads/${name}`,
            sha: baseData.object.sha,
          }),
        }
      );
      if (!res.ok) throw new Error(`Failed to create branch: ${res.status}`);

      const data = await res.json() as { ref: string; object: { sha: string } };

      await this.logger.info('github', `Created branch: ${name}`);

      return {
        name: name,
        sha: data.object.sha,
      };
    });
  }

  // ============================================================
  // DELETE BRANCH
  // ============================================================

  async delete(name: string): Promise<void> {
    const headers = await this.headers();

    const res = await fetch(
      `${this.apiBase}/repos/${this.repoPath}/git/refs/heads/${name}`,
      { method: 'DELETE', headers }
    );

    if (!res.ok && res.status !== 422) { // 422 = already deleted
      throw new Error(`Failed to delete branch: ${res.status}`);
    }

    await this.logger.info('github', `Deleted branch: ${name}`);
  }

  // ============================================================
  // LIST BRANCHES
  // ============================================================

  async list(): Promise<GitHubBranch[]> {
    const headers = await this.headers();

    const res = await fetch(
      `${this.apiBase}/repos/${this.repoPath}/git/refs/heads`,
      { headers }
    );
    if (!res.ok) throw new Error(`Failed to list branches: ${res.status}`);

    const data = await res.json() as Array<{
      ref: string;
      object: { sha: string };
    }>;

    return data.map(b => ({
      name: b.ref.replace('refs/heads/', ''),
      sha: b.object.sha,
    }));
  }

  // ============================================================
  // CHECK IF EXISTS
  // ============================================================

  async exists(name: string): Promise<boolean> {
    const headers = await this.headers();

    const res = await fetch(
      `${this.apiBase}/repos/${this.repoPath}/git/refs/heads/${name}`,
      { headers }
    );

    return res.status === 200;
  }
}
