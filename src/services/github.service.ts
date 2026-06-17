/**
 * Hades Army v0.2.1 — GitHub Service (Unified Facade)
 * Combines all GitHub clients: repo, branch, commit, PR.
 * Pure ESM.
 */

import type { HadesEnv } from "../config/env";
import type { Project, GitHubPR, GitHubBranch } from "../types";
import { GitHubRepoClient } from "../github/clients/repo.client";
import { GitHubBranchClient } from "../github/clients/branch.client";
import { GitHubPRClient } from "../github/clients/pr.client";
import { GitHubCommitClient } from "../github/clients/commit.client";
import { Logger } from "../utils/logger";
import { slugify } from "../utils/helpers";

export class GitHubService {
  private logger: Logger;
  public repo: GitHubRepoClient;
  public branch: GitHubBranchClient;
  public pr: GitHubPRClient;
  public commit: GitHubCommitClient;

  constructor(
    private env: HadesEnv,
    private project: Project
  ) {
    this.logger = new Logger(env, project.id);
    this.repo = new GitHubRepoClient(env, project);
    this.branch = new GitHubBranchClient(env, project);
    this.pr = new GitHubPRClient(env, project);
    this.commit = new GitHubCommitClient(env, project);
  }

  async createPatchPR(
    taskId: string,
    taskTitle: string,
    patchText: string,
    description: string
  ): Promise<GitHubPR> {
    const branchName = `feature/${taskId.slice(0, 8)}-${slugify(taskTitle)}`;
    await this.branch.create(branchName);

    const commitMessage = `[${taskId}] ${taskTitle}`;
    await this.commit.applyPatch(branchName, patchText, commitMessage);

    const pr = await this.pr.create(
      `TASK-${taskId.slice(0, 8)}: ${taskTitle}`,
      branchName,
      this.project.defaultBranch,
      `## Task\n${description}\n\n---\n*Automated by Hades Army*`
    );

    await this.logger.info("github", `Created PR #${pr.number} for task ${taskId}`);
    return pr;
  }

  // FIX #3: Fixed mergeAndCleanup — use prNumber instead of undefined pr variable
  async mergeAndCleanup(prNumber: number, commitMessage?: string): Promise<void> {
    await this.pr.merge(prNumber, commitMessage);
    await this.logger.info("github", `Merged PR #${prNumber}`);  // ← FIX: use prNumber
  }

  async scanRepository(): Promise<{
    tree: Array<{ path: string; type: string; sha: string; size?: number }>;
    readme: string | null;
  }> {
    const [tree, readme] = await Promise.all([
      this.repo.getTree(),
      this.repo.getReadme(),
    ]);

    await this.logger.info("github", `Scanned repository: ${tree.length} files`);
    return { tree, readme };
  }
}
