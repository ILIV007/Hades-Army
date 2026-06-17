/**
 * Hades Army v0.2 — GitHub Branch Client
 * Branch creation, deletion, and management.
 * Extends GitHubBaseClient. Pure ESM.
 */

import type { HadesEnv } from "../../config/env";
import type { Project, GitHubBranch } from "../../types";
import { GitHubBaseClient } from "./base.client";
import { Logger } from "../../utils/logger";
import { withRetry } from "../../utils/helpers";

export class GitHubBranchClient extends GitHubBaseClient {
  private logger: Logger;

  constructor(env: HadesEnv, project: Project) {
    super(env, project);
    this.logger = new Logger(env, project.id);
  }

  // ============================================================
  // CREATE BRANCH
  // ============================================================

  async create(name: string, fromBranch?: string): Promise<GitHubBranch> {
    const base = fromBranch ?? this.project.defaultBranch;

    return withRetry(async () => {
      // Get base branch SHA
      const baseData = await this.get<{ object: { sha: string } }>(
        `/repos/${this.repoPath}/git/refs/heads/${base}`
      );

      // Create new branch
      const data = await this.post<{ ref: string; object: { sha: string } }>(
        `/repos/${this.repoPath}/git/refs`,
        {
          ref: `refs/heads/${name}`,
          sha: baseData.object.sha,
        }
      );

      await this.logger.info("github", `Created branch: ${name}`);

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
    await this.delete(`/repos/${this.repoPath}/git/refs/heads/${name}`);
    await this.logger.info("github", `Deleted branch: ${name}`);
  }

  // ============================================================
  // LIST BRANCHES
  // ============================================================

  async list(): Promise<GitHubBranch[]> {
    const data = await this.get<
      Array<{ ref: string; object: { sha: string } }>
    >(`/repos/${this.repoPath}/git/refs/heads`);

    return data.map((b) => ({
      name: b.ref.replace("refs/heads/", ""),
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
