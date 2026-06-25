/**
 * GitHub Workflow Enhancements - Cloudflare Workers Edition
 * Hades Army v0.9.2 — GitHub Workflow
 *
 * Priority 6:
 *   - Safe Mode (Push forbidden for new repositories — Plan + Draft only)
 *   - Draft Pull Request (Manager shows change summary before creating PR)
 *   - Branch Cleanup (auto-delete branch after merge)
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";
import { ManagerGitHubOperations, type CommitFile } from "./manager-operations";

// ============================================
// Types
// ============================================

export type SafeModeStatus = "active" | "lifted" | "never_enabled";

export interface DraftPRSummary {
  draftId: string;
  repositoryFullName: string;
  branchName: string;
  baseBranch: string;
  title: string;
  body: string;
  files: Array<{
    path: string;
    status: "added" | "modified" | "deleted";
    additions: number;
    deletions: number;
    preview: string; // first 500 chars of new content
  }>;
  totalAdditions: number;
  totalDeletions: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  readyToCreate: boolean;
  createdAt: string;
}

// ============================================
// Safe Mode Manager
// ============================================

const KV_PREFIX_SAFE_MODE = "safe-mode:";

export class SafeModeManager {
  private env: HadesBindings;

  constructor(env: HadesBindings) {
    this.env = env;
  }

  /**
   * Check if a repository is in Safe Mode (push forbidden).
   * New repositories default to Safe Mode for the first 3 days or
   * until the user explicitly lifts it.
   */
  async getStatus(repositoryFullName: string): Promise<SafeModeStatus> {
    if (!this.env.HADES_KV) return "never_enabled";
    const raw = await this.env.HADES_KV.get(`${KV_PREFIX_SAFE_MODE}${repositoryFullName}`);
    if (!raw) return "never_enabled";
    try {
      const data = JSON.parse(raw) as { status: SafeModeStatus; enabledAt: string };
      if (data.status === "lifted") return "lifted";
      // Auto-lift after 3 days
      const enabledAt = new Date(data.enabledAt).getTime();
      const threeDays = 3 * 24 * 60 * 60 * 1000;
      if (Date.now() - enabledAt > threeDays) {
        return "lifted";
      }
      return "active";
    } catch {
      return "never_enabled";
    }
  }

  /**
   * Enable Safe Mode for a repository (called when repository is connected).
   */
  async enable(repositoryFullName: string): Promise<void> {
    if (!this.env.HADES_KV) return;
    await this.env.HADES_KV.put(
      `${KV_PREFIX_SAFE_MODE}${repositoryFullName}`,
      JSON.stringify({
        status: "active",
        enabledAt: new Date().toISOString(),
      }),
    );
    logger.info(`SafeMode: enabled for ${repositoryFullName}`);
  }

  /**
   * Lift Safe Mode (user explicitly approves push access).
   */
  async lift(repositoryFullName: string): Promise<void> {
    if (!this.env.HADES_KV) return;
    await this.env.HADES_KV.put(
      `${KV_PREFIX_SAFE_MODE}${repositoryFullName}`,
      JSON.stringify({
        status: "lifted",
        enabledAt: new Date().toISOString(),
        liftedAt: new Date().toISOString(),
      }),
    );
    logger.info(`SafeMode: lifted for ${repositoryFullName}`);
  }

  /**
   * Assert that push is allowed. Throws if Safe Mode is active.
   */
  async assertPushAllowed(repositoryFullName: string): Promise<void> {
    const status = await this.getStatus(repositoryFullName);
    if (status === "active") {
      throw new Error(
        `Safe Mode is ACTIVE for ${repositoryFullName}. ` +
        `Push operations are forbidden until the user lifts Safe Mode. ` +
        `Use the "Lift Safe Mode" button in Telegram to allow pushes.`,
      );
    }
  }
}

// ============================================
// Draft PR Builder
// ============================================

export class DraftPRBuilder {
  private env: HadesBindings;
  private githubOps: ManagerGitHubOperations;
  private safeMode: SafeModeManager;

  /** In-memory draft store (per-isolate). In production, mirror to KV. */
  private drafts: Map<string, DraftPRSummary> = new Map();

  constructor(env: HadesBindings) {
    this.env = env;
    this.githubOps = new ManagerGitHubOperations(env);
    this.safeMode = new SafeModeManager(env);
  }

  /**
   * Stage 1: Create a DRAFT PR summary. NO GitHub operations are
   * performed yet. The user reviews the summary and explicitly
   * approves before Stage 2 (createActualPR).
   */
  async createDraft(params: {
    repositoryFullName: string;
    branchName: string;
    baseBranch: string;
    title: string;
    body: string;
    files: CommitFile[];
    riskLevel?: DraftPRSummary["riskLevel"];
  }): Promise<DraftPRSummary> {
    const draftId = generateId("draft-pr");

    // Check Safe Mode — drafts are allowed even in Safe Mode,
    // but the eventual PR creation will be blocked.
    const safeModeStatus = await this.safeMode.getStatus(params.repositoryFullName);

    const files = params.files.map((f) => {
      const content = f.encoding === "base64" ? atob(f.content) : f.content;
      const lines = content.split("\n");
      return {
        path: f.path,
        status: "modified" as const, // would be determined by patch
        additions: lines.length,
        deletions: 0,
        preview: content.slice(0, 500),
      };
    });

    const summary: DraftPRSummary = {
      draftId,
      repositoryFullName: params.repositoryFullName,
      branchName: params.branchName,
      baseBranch: params.baseBranch,
      title: params.title,
      body: params.body,
      files,
      totalAdditions: files.reduce((s, f) => s + f.additions, 0),
      totalDeletions: files.reduce((s, f) => s + f.deletions, 0),
      riskLevel: params.riskLevel ?? "low",
      readyToCreate: safeModeStatus !== "active",
      createdAt: new Date().toISOString(),
    };

    this.drafts.set(draftId, summary);
    logger.info(`DraftPR: created ${draftId} for ${params.repositoryFullName}`, {
      files: files.length,
      safeMode: safeModeStatus,
    });

    return summary;
  }

  /**
   * Stage 2: Convert a draft into an actual GitHub PR.
   * This is the ONLY method that performs GitHub write operations.
   * The user must have explicitly approved the draft first.
   */
  async createActualPR(draftId: string, approvedBy: string): Promise<{ prUrl: string; safeModeBlocked: boolean }> {
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new Error(`Draft PR ${draftId} not found`);
    }

    // Re-check Safe Mode at creation time
    const safeModeStatus = await this.safeMode.getStatus(draft.repositoryFullName);
    if (safeModeStatus === "active") {
      logger.warn(`DraftPR: ${draftId} blocked by Safe Mode`);
      return { prUrl: "", safeModeBlocked: true };
    }

    // Convert draft files back to CommitFile format
    const files: CommitFile[] = draft.files.map((f) => ({
      path: f.path,
      content: f.preview, // In production, the full content would be staged in KV
      encoding: "utf-8" as const,
    }));

    const prUrl = await this.githubOps.createPullRequest({
      repositoryFullName: draft.repositoryFullName,
      branchName: draft.branchName,
      baseBranch: draft.baseBranch,
      title: draft.title,
      body: draft.body,
      files,
    });

    // Remove the draft
    this.drafts.delete(draftId);

    logger.info(`DraftPR: ${draftId} converted to PR by ${approvedBy}`, { prUrl });
    return { prUrl, safeModeBlocked: false };
  }

  /**
   * Cancel a draft (user rejected).
   */
  cancelDraft(draftId: string): void {
    this.drafts.delete(draftId);
    logger.info(`DraftPR: ${draftId} cancelled`);
  }

  /**
   * Get a draft by ID (for inspection).
   */
  getDraft(draftId: string): DraftPRSummary | undefined {
    return this.drafts.get(draftId);
  }

  /**
   * Render draft summary for Telegram.
   */
  renderDraft(draft: DraftPRSummary): string {
    const lines: string[] = [
      `📝 *Draft Pull Request*`,
      ``,
      `*Repository:* \`${draft.repositoryFullName}\``,
      `*Branch:* \`${draft.branchName}\` → \`${draft.baseBranch}\``,
      `*Title:* ${draft.title}`,
      `*Risk:* ${draft.riskLevel.toUpperCase()}`,
      `*Files:* ${draft.files.length} (+${draft.totalAdditions}/-${draft.totalDeletions})`,
      ``,
    ];

    if (draft.files.length > 0) {
      lines.push(`*Changed Files:*`);
      for (const f of draft.files.slice(0, 10)) {
        lines.push(`• \`${f.path}\` (+${f.additions}/-${f.deletions})`);
      }
      if (draft.files.length > 10) {
        lines.push(`• ... and ${draft.files.length - 10} more`);
      }
      lines.push(``);
    }

    if (!draft.readyToCreate) {
      lines.push(`🔴 *Safe Mode is ACTIVE — PR creation is blocked.*`);
      lines.push(`Lift Safe Mode first to proceed.`);
    } else {
      lines.push(`✅ Ready to create PR.`);
    }

    return lines.join("\n");
  }
}

// ============================================
// Branch Cleanup Manager
// ============================================

export class BranchCleanupManager {
  private env: HadesBindings;
  private githubOps: ManagerGitHubOperations;

  constructor(env: HadesBindings) {
    this.env = env;
    this.githubOps = new ManagerGitHubOperations(env);
  }

  /**
   * Auto-delete a branch after a successful merge.
   * Called by the Manager after mergePullRequest succeeds.
   *
   * Safety: only deletes branches that match the hades/* pattern.
   * Never deletes the default branch.
   */
  async cleanupAfterMerge(
    repositoryFullName: string,
    branchName: string,
    defaultBranch: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    // Never delete the default branch
    if (branchName === defaultBranch) {
      return { ok: false, reason: `Refusing to delete default branch: ${branchName}` };
    }

    // Only delete hades/* branches
    if (!branchName.startsWith("hades/")) {
      return { ok: false, reason: `Refusing to delete non-hades branch: ${branchName}` };
    }

    try {
      await this.githubOps.deleteBranch(repositoryFullName, branchName);
      logger.info(`BranchCleanup: deleted ${branchName} after merge`, { repositoryFullName });
      return { ok: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(`BranchCleanup: failed to delete ${branchName}`, { reason });
      return { ok: false, reason };
    }
  }
}

// ============================================
// Factory
// ============================================

let _safeMode: SafeModeManager | null = null;
let _draftPR: DraftPRBuilder | null = null;
let _cleanup: BranchCleanupManager | null = null;

export function getSafeModeManager(env: HadesBindings): SafeModeManager {
  if (!_safeMode) _safeMode = new SafeModeManager(env);
  return _safeMode;
}

export function getDraftPRBuilder(env: HadesBindings): DraftPRBuilder {
  if (!_draftPR) _draftPR = new DraftPRBuilder(env);
  return _draftPR;
}

export function getBranchCleanupManager(env: HadesBindings): BranchCleanupManager {
  if (!_cleanup) _cleanup = new BranchCleanupManager(env);
  return _cleanup;
}
