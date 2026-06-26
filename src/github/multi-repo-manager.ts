/**
 * Multi-Repository Manager - Cloudflare Workers Edition
 * Hades Army v0.10 — Multi Repository Support
 *
 * Each user can have MULTIPLE repositories. Each repository:
 *   - Has its own ID
 *   - Has its own Project Brain (memory)
 *   - Has its own state (mode, branch, status)
 *   - Has its own scan results
 *
 * Stored in KV per-user: `repos:user:<userId>` → JSON array
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export type RepositoryStatus = "connected" | "disconnected" | "scanning" | "ready" | "needs_permission";

export interface ManagedRepository {
  id: string;
  userId: string;
  repositoryFullName: string;
  displayName: string;
  owner: string;
  name: string;
  defaultBranch: string;
  visibility: "public" | "private";
  language: string | null;
  framework: string | null;
  status: RepositoryStatus;
  /** path to the Project Brain in KV: brain:<repoId>:<path> */
  brainPrefix: string;
  /** last scan timestamp */
  lastScannedAt: string | null;
  /** last sync timestamp (when .hades/ was last pushed) */
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryListResult {
  repositories: ManagedRepository[];
  activeRepositoryId: string | null;
}

// ============================================
// Multi-Repository Manager
// ============================================

const REPOS_KV_PREFIX = "repos:user:";
const ACTIVE_REPO_KV_PREFIX = "active-repo:user:";

export class MultiRepositoryManager {
  private env: HadesBindings;

  constructor(env: HadesBindings) {
    this.env = env;
  }

  /**
   * List all repositories for a user.
   */
  async listForUser(userId: string): Promise<ManagedRepository[]> {
    if (!this.env.HADES_KV) return [];
    const raw = await this.env.HADES_KV.get(`${REPOS_KV_PREFIX}${userId}`);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as ManagedRepository[];
    } catch {
      return [];
    }
  }

  /**
   * Add a repository for a user. Returns the managed repository record.
   */
  async addRepository(
    userId: string,
    info: {
      repositoryFullName: string;
      displayName: string;
      owner: string;
      name: string;
      defaultBranch: string;
      visibility: "public" | "private";
      language: string | null;
      framework: string | null;
    },
  ): Promise<ManagedRepository> {
    const now = new Date().toISOString();
    const repoId = generateId("repo");

    const repo: ManagedRepository = {
      id: repoId,
      userId,
      repositoryFullName: info.repositoryFullName,
      displayName: info.displayName,
      owner: info.owner,
      name: info.name,
      defaultBranch: info.defaultBranch,
      visibility: info.visibility,
      language: info.language,
      framework: info.framework,
      status: "connected",
      brainPrefix: `brain:${repoId}`,
      lastScannedAt: null,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const list = await this.listForUser(userId);
    // Replace if same full name exists
    const filtered = list.filter((r) => r.repositoryFullName !== info.repositoryFullName);
    filtered.push(repo);
    await this.persist(userId, filtered);

    logger.info("MultiRepo: added", { userId, repoId, fullName: info.repositoryFullName });
    return repo;
  }

  /**
   * Get a specific repository by ID.
   */
  async getRepository(userId: string, repoId: string): Promise<ManagedRepository | undefined> {
    const list = await this.listForUser(userId);
    return list.find((r) => r.id === repoId);
  }

  /**
   * Get a repository by full name.
   */
  async getRepositoryByName(userId: string, fullName: string): Promise<ManagedRepository | undefined> {
    const list = await this.listForUser(userId);
    return list.find((r) => r.repositoryFullName === fullName);
  }

  /**
   * Update a repository's status or fields.
   */
  async updateRepository(
    userId: string,
    repoId: string,
    updates: Partial<ManagedRepository>,
  ): Promise<ManagedRepository | undefined> {
    const list = await this.listForUser(userId);
    const idx = list.findIndex((r) => r.id === repoId);
    if (idx < 0) return undefined;

    list[idx] = { ...list[idx], ...updates, updatedAt: new Date().toISOString() };
    await this.persist(userId, list);
    return list[idx];
  }

  /**
   * Remove a repository.
   */
  async removeRepository(userId: string, repoId: string): Promise<boolean> {
    const list = await this.listForUser(userId);
    const filtered = list.filter((r) => r.id !== repoId);
    if (filtered.length === list.length) return false;
    await this.persist(userId, filtered);

    // Clear active if it was this repo
    const active = await this.getActiveRepositoryId(userId);
    if (active === repoId) {
      await this.setActiveRepositoryId(userId, null);
    }

    logger.info("MultiRepo: removed", { userId, repoId });
    return true;
  }

  /**
   * Set the active repository for a user.
   */
  async setActiveRepositoryId(userId: string, repoId: string | null): Promise<void> {
    if (!this.env.HADES_KV) return;
    if (repoId) {
      await this.env.HADES_KV.put(`${ACTIVE_REPO_KV_PREFIX}${userId}`, repoId);
    } else {
      await this.env.HADES_KV.delete(`${ACTIVE_REPO_KV_PREFIX}${userId}`);
    }
  }

  /**
   * Get the active repository ID for a user.
   */
  async getActiveRepositoryId(userId: string): Promise<string | null> {
    if (!this.env.HADES_KV) return null;
    const id = await this.env.HADES_KV.get(`${ACTIVE_REPO_KV_PREFIX}${userId}`);
    return id ?? null;
  }

  /**
   * Get the active repository record.
   */
  async getActiveRepository(userId: string): Promise<ManagedRepository | undefined> {
    const activeId = await this.getActiveRepositoryId(userId);
    if (!activeId) return undefined;
    return this.getRepository(userId, activeId);
  }

  /**
   * Mark a repository as scanning.
   */
  async markScanning(userId: string, repoId: string): Promise<void> {
    await this.updateRepository(userId, repoId, { status: "scanning" });
  }

  /**
   * Mark a repository as ready (scan complete).
   */
  async markReady(userId: string, repoId: string): Promise<void> {
    await this.updateRepository(userId, repoId, {
      status: "ready",
      lastScannedAt: new Date().toISOString(),
    });
  }

  /**
   * Render the repository list for Telegram.
   */
  renderList(repos: ManagedRepository[], activeRepoId: string | null): {
    text: string;
    replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
  } {
    if (repos.length === 0) {
      return {
        text: [
          `📦 *My Repositories*`,
          ``,
          `No repositories connected yet.`,
          ``,
          `Tap "Connect GitHub" to add your first repository.`,
        ].join("\n"),
        replyMarkup: {
          inline_keyboard: [
            [{ text: "🔗 Connect GitHub", callback_data: "home:connect_repo" }],
            [{ text: "🔙 Home", callback_data: "home:main" }],
          ],
        },
      };
    }

    const statusEmoji: Record<RepositoryStatus, string> = {
      connected: "✅",
      disconnected: "⚫",
      scanning: "⏳",
      ready: "🟢",
      needs_permission: "⚠️",
    };

    const lines: string[] = [
      `📦 *My Repositories* (${repos.length})`,
      ``,
    ];

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
    for (const repo of repos) {
      const isActive = repo.id === activeRepoId;
      const vis = repo.visibility === "private" ? "🔒" : "🌐";
      const active = isActive ? "● " : "○ ";
      const status = statusEmoji[repo.status];

      keyboard.push([{
        text: `${active}${status} ${vis} ${repo.repositoryFullName}`,
        callback_data: `repos:detail:${repo.id}`,
      }]);
    }
    keyboard.push([{ text: "🔗 Connect GitHub", callback_data: "home:connect_repo" }]);
    keyboard.push([{ text: "🔙 Home", callback_data: "home:main" }]);

    return { text: lines.join("\n"), replyMarkup: { inline_keyboard: keyboard } };
  }

  /**
   * Render a single repository detail view.
   */
  renderDetail(repo: ManagedRepository, isActive: boolean): {
    text: string;
    replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
  } {
    const vis = repo.visibility === "private" ? "🔒 Private" : "🌐 Public";
    const statusEmoji: Record<RepositoryStatus, string> = {
      connected: "✅",
      disconnected: "⚫",
      scanning: "⏳",
      ready: "🟢",
      needs_permission: "⚠️",
    };

    const text = [
      `📦 *Repository Detail*`,
      ``,
      `*Name:* ${repo.displayName}`,
      `*Full name:* \`${repo.repositoryFullName}\``,
      `*Visibility:* ${vis}`,
      `*Language:* ${repo.language ?? "Unknown"}`,
      `*Framework:* ${repo.framework ?? "Not detected"}`,
      `*Default branch:* \`${repo.defaultBranch}\``,
      `*Status:* ${statusEmoji[repo.status]} ${repo.status}`,
      `*Active:* ${isActive ? "✅ Yes" : "No"}`,
      `*Last scan:* ${repo.lastScannedAt ?? "never"}`,
      `*Last sync:* ${repo.lastSyncedAt ?? "never"}`,
      `*Repository ID:* \`${repo.id}\``,
    ].join("\n");

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
      [
        { text: isActive ? "✅ Active" : "○ Set Active", callback_data: `repos:activate:${repo.id}` },
        { text: "🔄 Rescan", callback_data: `repos:rescan:${repo.id}` },
      ],
      [
        { text: "🧠 Project Brain", callback_data: `repos:brain:${repo.id}` },
        { text: "📊 Status", callback_data: `repos:status:${repo.id}` },
      ],
      [{ text: "🗑 Disconnect", callback_data: `repos:remove:${repo.id}` }],
      [{ text: "🔙 Back to List", callback_data: "home:repositories" }],
    ];

    return { text, replyMarkup: { inline_keyboard: keyboard } };
  }

  // ============================================
  // Private
  // ============================================

  private async persist(userId: string, list: ManagedRepository[]): Promise<void> {
    if (!this.env.HADES_KV) return;
    await this.env.HADES_KV.put(`${REPOS_KV_PREFIX}${userId}`, JSON.stringify(list));
  }
}

// ============================================
// Factory
// ============================================

let _instance: MultiRepositoryManager | null = null;

export function getMultiRepositoryManager(env: HadesBindings): MultiRepositoryManager {
  if (!_instance) _instance = new MultiRepositoryManager(env);
  return _instance;
}
