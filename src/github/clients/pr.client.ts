/**
 * Hades Army v0.2 — GitHub Pull Request Client
 * PR creation, tracking, and management.
 * Extends GitHubBaseClient. Pure ESM.
 */

import type { HadesEnv } from "../../config/env";
import type { Project, GitHubPR } from "../../types";
import { GitHubBaseClient } from "./base.client";
import { Logger } from "../../utils/logger";
import { withRetry } from "../../utils/helpers";

export class GitHubPRClient extends GitHubBaseClient {
  private logger: Logger;

  constructor(env: HadesEnv, project: Project) {
    super(env, project);
    this.logger = new Logger(env, project.id);
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
    return withRetry(async () => {
      const data = await this.post<{
        number: number;
        title: string;
        body: string;
        head: { ref: string };
        base: { ref: string };
        state: "open" | "closed" | "merged";
        url: string;
        html_url: string;
      }>(`/repos/${this.repoPath}/pulls`, { title, head, base, body });

      await this.logger.info("github", `Created PR #${data.number}: ${title}`);

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
    const data = await this.get<{
      number: number;
      title: string;
      body: string;
      head: { ref: string };
      base: { ref: string };
      state: "open" | "closed" | "merged";
      url: string;
      html_url: string;
    }>(`/repos/${this.repoPath}/pulls/${number}`);

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
    await this.put(`/repos/${this.repoPath}/pulls/${number}/merge`, {
      commit_title: commitMessage ?? `Merge PR #${number}`,
      merge_method: "squash",
    });
    await this.logger.info("github", `Merged PR #${number}`);
  }

  // ============================================================
  // LIST PRs
  // ============================================================

  async list(state: "open" | "closed" | "all" = "open"): Promise<GitHubPR[]> {
    const data = await this.get<
      Array<{
        number: number;
        title: string;
        body: string;
        head: { ref: string };
        base: { ref: string };
        state: "open" | "closed" | "merged";
        url: string;
        html_url: string;
      }>
    >(`/repos/${this.repoPath}/pulls?state=${state}`);

    return data.map((pr) => ({
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
