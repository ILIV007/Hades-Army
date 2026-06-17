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

  // ============================================================
  // APPLY PATCH TO BRANCH (full pipeline)
  // ============================================================

  async applyPatch(
    branch: string,
    patchText: string,
    commitMessage: string
  ): Promise<string> {
    return withRetry(async () => {
      // Step 1: Parse the patch
      const patches = parsePatch(patchText);
      if (patches.length === 0) {
        throw new Error("No valid patches found in diff");
      }

      // Step 2: Get current commit SHA for the branch
      const branchRef = await this.get<{ object: { sha: string } }>(
        `/repos/${this.repoPath}/git/refs/heads/${branch}`
      );
      const parentCommitSha = branchRef.object.sha;

      // Step 3: Get current tree SHA
      const parentCommit = await this.get<{ tree: { sha: string } }>(
        `/repos/${this.repoPath}/git/commits/${parentCommitSha}`
      );
      const baseTreeSha = parentCommit.tree.sha;

      // Step 4: For each patch, get current content, apply diff, create blob
      const treeEntries: Array<{
        path: string;
        mode: string;
        type: string;
        sha: string;
      }> = [];

      for (const patch of patches) {
        // Get current file content (or empty for new files)
        let currentContent = "";
        if (!patch.isNewFile) {
          currentContent = await this.getFileContent(patch.oldPath, branch) ?? "";
        }

        // Apply patch
        const newContent = applyPatchToContent(currentContent, patch);

        // Create blob
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

      // Step 5: Create new tree
      const newTree = await this.post<{ sha: string }>(
        `/repos/${this.repoPath}/git/trees`,
        {
          base_tree: baseTreeSha,
          tree: treeEntries,
        }
      );

      // Step 6: Create commit
      const newCommit = await this.post<{ sha: string }>(
        `/repos/${this.repoPath}/git/commits`,
        {
          message: commitMessage,
          tree: newTree.sha,
          parents: [parentCommitSha],
        }
      );

      // Step 7: Update branch ref
      await this.put(`/repos/${this.repoPath}/git/refs/heads/${branch}`, {
        sha: newCommit.sha,
      });

      await this.logger.info("github", `Applied ${patches.length} patches to ${branch}`, {
        commitSha: newCommit.sha,
      });

      return newCommit.sha;
    });
  }

  // ============================================================
  // GET FILE CONTENT (helper for patch application)
  // ============================================================

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
