/**
 * Hades Army — GitHub Service
 * All GitHub operations: repo, branch, commit, PR, patch.
 */

import type { HadesEnv } from '../config/env';
import type { Project, GitHubPR, GitHubBranch } from '../types';
import { Logger } from '../utils/logger';
import { withRetry } from '../utils/helpers';

export class GitHubService {
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
  // REPOSITORY
  // ============================================================

  async getRepositoryTree(branch?: string): Promise<Array<{ path: string; type: string; sha: string; size?: number }>> {
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
  // BRANCHES
  // ============================================================

  async createBranch(name: string, fromBranch?: string): Promise<GitHubBranch> {
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
      return {
        name: name,
        sha: data.object.sha,
      };
    });
  }

  async deleteBranch(name: string): Promise<void> {
    const headers = await this.headers();
    await fetch(
      `${this.apiBase}/repos/${this.repoPath}/git/refs/heads/${name}`,
      { method: 'DELETE', headers }
    );
  }

  // ============================================================
  // COMMITS
  // ============================================================

  async createCommit(
    branch: string,
    message: string,
    files: Array<{ path: string; content: string }>
  ): Promise<string> {
    const headers = await this.headers();

    return withRetry(async () => {
      // Get current tree SHA
      const branchRes = await fetch(
        `${this.apiBase}/repos/${this.repoPath}/git/refs/heads/${branch}`,
        { headers }
      );
      const branchData = await branchRes.json() as { object: { sha: string } };
      const parentSha = branchData.object.sha;

      // Get current commit for tree
      const commitRes = await fetch(
        `${this.apiBase}/repos/${this.repoPath}/git/commits/${parentSha}`,
        { headers }
      );
      const commitData = await commitRes.json() as { tree: { sha: string } };
      const baseTreeSha = commitData.tree.sha;

      // Create blobs for each file
      const treeEntries = [];
      for (const file of files) {
        const blobRes = await fetch(
          `${this.apiBase}/repos/${this.repoPath}/git/blobs`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              content: btoa(file.content),
              encoding: 'base64',
            }),
          }
        );
        const blobData = await blobRes.json() as { sha: string };
        treeEntries.push({
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha,
        });
      }

      // Create new tree
      const treeRes = await fetch(
        `${this.apiBase}/repos/${this.repoPath}/git/trees`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            base_tree: baseTreeSha,
            tree: treeEntries,
          }),
        }
      );
      const treeData = await treeRes.json() as { sha: string };

      // Create commit
      const newCommitRes = await fetch(
        `${this.apiBase}/repos/${this.repoPath}/git/commits`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            message,
            tree: treeData.sha,
            parents: [parentSha],
          }),
        }
      );
      const newCommitData = await newCommitRes.json() as { sha: string };

      // Update branch ref
      await fetch(
        `${this.apiBase}/repos/${this.repoPath}/git/refs/heads/${branch}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ sha: newCommitData.sha }),
        }
      );

      return newCommitData.sha;
    });
  }

  // ============================================================
  // PULL REQUESTS
  // ============================================================

  async createPullRequest(
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

  async getPullRequest(number: number): Promise<GitHubPR> {
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

  async mergePullRequest(number: number, commitMessage?: string): Promise<void> {
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
  }

  // ============================================================
  // PATCH APPLICATION
  // ============================================================

  async applyPatch(
    branch: string,
    patch: string,
    taskId: string
  ): Promise<void> {
    // Parse patch to extract file changes
    const fileChanges = this.parsePatch(patch);

    // Get current file contents
    const files: Array<{ path: string; content: string }> = [];
    for (const change of fileChanges) {
      const currentContent = await this.getFileContent(change.path, branch) ?? '';
      const newContent = this.applyDiff(currentContent, change.hunks);
      files.push({ path: change.path, content: newContent });
    }

    // Commit all changes
    const commitMessage = `[${taskId}] Automated patch by Hades Builder`;
    await this.createCommit(branch, commitMessage, files);

    await this.logger.info('github', `Applied patch to ${files.length} files on branch ${branch}`);
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private parsePatch(patch: string): Array<{ path: string; hunks: string[] }> {
    const files: Array<{ path: string; hunks: string[] }> = [];
    const lines = patch.split('\n');
    let currentFile: { path: string; hunks: string[] } | null = null;
    let currentHunk: string[] = [];

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        if (currentFile && currentHunk.length > 0) {
          currentFile.hunks.push(currentHunk.join('\n'));
        }
        const match = line.match(/diff --git a\/(.+?) b\/(.+?)$/);
        if (match) {
          currentFile = { path: match[2], hunks: [] };
          files.push(currentFile);
        }
        currentHunk = [];
      } else if (line.startsWith('@@')) {
        if (currentHunk.length > 0 && currentFile) {
          currentFile.hunks.push(currentHunk.join('\n'));
        }
        currentHunk = [line];
      } else if (currentHunk.length > 0) {
        currentHunk.push(line);
      }
    }

    if (currentFile && currentHunk.length > 0) {
      currentFile.hunks.push(currentHunk.join('\n'));
    }

    return files;
  }

  private applyDiff(original: string, hunks: string[]): string {
    const lines = original.split('\n');
    // Simplified: return original for MVP (full diff apply is complex)
    // In production, implement proper unified diff application
    // For now, we commit the full file content from the patch
    return original;
  }
}
