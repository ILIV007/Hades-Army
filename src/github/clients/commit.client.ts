/**
 * Hades Army v0.2 — GitHub Commit Client
 * Full commit pipeline: Blob → Tree → Commit → Ref Update
 * This is the REAL implementation that applies patches to GitHub.
 * Extends GitHubBaseClient. Pure ESM.
 */

import type { HadesEnv } from "../../config/env";
import type { Project } from "../../types";
import { GitHubBaseClient } from "./base.client";
import { Logger } from "../../utils/logger";
import { withRetry } from "../../utils/helpers";
import { parsePatch, applyPatchToContent } from "../../utils/patch-parser";

export class GitHubCommitClient extends GitHubBaseClient {
  private logger: Logger;

  constructor(env: HadesEnv, project: Project) {
    super(env, project);
    this.logger = new Logger(env, project.id);
  }

  async applyPatch(
    branch: string,
    patchText: string,
    commitMessage: string
  ): Promise<string> {
    return withRetry(async () => {
      const patches = parsePatch(patchText);
      if (patches.length === 0) {
        throw new Error("No valid patches found in diff");
      }

      const branchRef = await this.get<{ object: { sha: string } }>(
        `/repos/${this.repoPath}/git/refs/heads/${branch}`
      );
      const parentCommitSha = branchRef.object.sha;

      const parentCommit = await this.get<{ tree: { sha: string } }>(
        `/repos/${this.repoPath}/git/commits/${parentCommitSha}`
      );
      const baseTreeSha = parentCommit.tree.sha;

      const treeEntries: Array<{
        path: string;
        mode: string;
        type: string;
        sha: string;
      }> = [];

      for (const patch of patches) {
        let currentContent = "";
        if (!patch.isNewFile) {
          currentContent = await this.getFileContent(patch.oldPath, branch) ?? "";
        }

        const newContent = applyPatchToContent(currentContent, patch);

        const blob = await this.post<{ sha: string }>(
          `/repos/${this.repoPath}/git/blobs`,
          {
            content: btoa(newContent),
            encoding: "base64",
          }
        );

        treeEntries.push({
          path: patch.newPath,
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        });
      }

      const newTree = await this.post<{ sha: string }>(
        `/repos/${this.repoPath}/git/trees`,
        {
          base_tree: baseTreeSha,
          tree: treeEntries,
        }
      );

      const newCommit = await this.post<{ sha: string }>(
        `/repos/${this.repoPath}/git/commits`,
        {
          message: commitMessage,
          tree: newTree.sha,
          parents: [parentCommitSha],
        }
      );

      await this.put(`/repos/${this.repoPath}/git/refs/heads/${branch}`, {
        sha: newCommit.sha,
      });

      await this.logger.info("github", `Applied ${patches.length} patches to ${branch}`, {
        commitSha: newCommit.sha,
      });

      return newCommit.sha;
    });
  }

  private async getFileContent(path: string, branch?: string): Promise<string | null> {
    const ref = branch ?? this.project.defaultBranch;
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
  }
}
