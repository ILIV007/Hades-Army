/**
 * Repository Manager UI - Cloudflare Workers Edition
 * Hades Army v0.9.1 — Production Readiness
 *
 * Priority 5: Repository Management UI
 *
 * Implements the /repositories command:
 *   - List connected repositories (status, visibility, last sync)
 *   - Select repository (sets it as active in ConversationMemory)
 *   - Remove repository (with confirmation)
 *   - Rescan repository (re-runs RepositoryAnalyzer)
 *
 * Also implements Step 5 of the Repository Wizard:
 *   Repository Summary (name, language, branches, size, visibility).
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export interface ConnectedRepository {
  id: string;
  userId: string;
  repositoryFullName: string;
  displayName: string;
  visibility: "public" | "private";
  defaultBranch: string;
  language: string;
  size: number; // KB
  status: "active" | "paused" | "error";
  lastSyncAt: string;
  connectedAt: string;
}

export interface RepositorySummary {
  repositoryFullName: string;
  displayName: string;
  description: string;
  visibility: "public" | "private";
  defaultBranch: string;
  size: number;
  language: string;
  branchesCount: number;
  starsCount: number;
  forksCount: number;
  openIssuesCount: number;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Repository Manager
// ============================================

const KV_PREFIX = "repositories:user:";

export class RepositoryManager {
  private env: HadesBindings;

  constructor(env: HadesBindings) {
    this.env = env;
  }

  // ============================================
  // Connect (record a new repository for a user)
  // ============================================

  async connect(userId: string, repo: Omit<ConnectedRepository, "id" | "userId" | "connectedAt" | "lastSyncAt" | "status">): Promise<ConnectedRepository> {
    const now = new Date().toISOString();
    const record: ConnectedRepository = {
      ...repo,
      id: generateId("repo"),
      userId,
      status: "active",
      connectedAt: now,
      lastSyncAt: now,
    };

    const list = await this.listForUser(userId);
    // Replace if same full name exists
    const filtered = list.filter((r) => r.repositoryFullName !== record.repositoryFullName);
    filtered.push(record);
    await this.persist(userId, filtered);

    logger.info(`RepositoryManager: connected ${record.repositoryFullName} for user ${userId}`);
    return record;
  }

  // ============================================
  // List (with status, visibility, last sync)
  // ============================================

  async listForUser(userId: string): Promise<ConnectedRepository[]> {
    if (!this.env.HADES_KV) return [];
    const raw = await this.env.HADES_KV.get(`${KV_PREFIX}${userId}`);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as ConnectedRepository[];
    } catch {
      return [];
    }
  }

  // ============================================
  // Select (set as active)
  // ============================================

  async select(userId: string, repositoryFullName: string): Promise<{ ok: boolean; reason?: string }> {
    const list = await this.listForUser(userId);
    const found = list.find((r) => r.repositoryFullName === repositoryFullName);
    if (!found) {
      return { ok: false, reason: `Repository ${repositoryFullName} is not connected.` };
    }
    // Active state is managed by ConversationMemory — caller is responsible
    // for calling conversationMemory.setActiveRepository() after this.
    logger.info(`RepositoryManager: selected ${repositoryFullName} for user ${userId}`);
    return { ok: true };
  }

  // ============================================
  // Remove (with confirmation flag)
  // ============================================

  async remove(userId: string, repositoryFullName: string): Promise<{ ok: boolean; reason?: string }> {
    const list = await this.listForUser(userId);
    const filtered = list.filter((r) => r.repositoryFullName !== repositoryFullName);
    if (filtered.length === list.length) {
      return { ok: false, reason: `Repository ${repositoryFullName} is not connected.` };
    }
    await this.persist(userId, filtered);
    logger.info(`RepositoryManager: removed ${repositoryFullName} for user ${userId}`);
    return { ok: true };
  }

  // ============================================
  // Rescan (re-fetch summary from GitHub)
  // ============================================

  async rescan(userId: string, repositoryFullName: string): Promise<RepositorySummary | { ok: false; reason: string }> {
    const summary = await this.fetchSummary(repositoryFullName);
    if (!summary) {
      return { ok: false, reason: `Could not fetch summary for ${repositoryFullName}` };
    }

    // Update the connected record's metadata
    const list = await this.listForUser(userId);
    const idx = list.findIndex((r) => r.repositoryFullName === repositoryFullName);
    if (idx >= 0) {
      list[idx].defaultBranch = summary.defaultBranch;
      list[idx].language = summary.language;
      list[idx].size = summary.size;
      list[idx].visibility = summary.visibility;
      list[idx].lastSyncAt = new Date().toISOString();
      list[idx].status = "active";
      await this.persist(userId, list);
    }
    logger.info(`RepositoryManager: rescanned ${repositoryFullName}`);
    return summary;
  }

  // ============================================
  // Step 5 helper: fetch repository summary from GitHub
  // ============================================

  async fetchSummary(repositoryFullName: string): Promise<RepositorySummary | undefined> {
    if (!this.env.GITHUB_TOKEN) {
      logger.warn("RepositoryManager: GITHUB_TOKEN not set, cannot fetch summary");
      return undefined;
    }
    const [owner, name] = repositoryFullName.split("/");
    if (!owner || !name) return undefined;

    // Repo metadata
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: {
        Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "HadesArmy/0.9.1",
      },
    });
    if (!repoRes.ok) {
      logger.warn(`RepositoryManager: GitHub API ${repoRes.status} for ${repositoryFullName}`);
      return undefined;
    }
    const repo = (await repoRes.json()) as any;

    // Branches count
    let branchesCount = 0;
    try {
      const branchesRes = await fetch(`https://api.github.com/repos/${owner}/${name}/branches?per_page=1`, {
        headers: {
          Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "HadesArmy/0.9.1",
        },
      });
      if (branchesRes.ok) {
        const link = branchesRes.headers.get("link") || "";
        const match = link.match(/page=(\d+)>; rel="last"/);
        branchesCount = match ? parseInt(match[1], 10) : 1;
      }
    } catch {
      // ignore — branches count is best-effort
    }

    return {
      repositoryFullName,
      displayName: repo.full_name?.split("/").pop() || repo.name || repositoryFullName,
      description: repo.description ?? "",
      visibility: repo.private ? "private" : "public",
      defaultBranch: repo.default_branch ?? "main",
      size: repo.size ?? 0, // KB
      language: repo.language ?? "Unknown",
      branchesCount,
      starsCount: repo.stargazers_count ?? 0,
      forksCount: repo.forks_count ?? 0,
      openIssuesCount: repo.open_issues_count ?? 0,
      htmlUrl: repo.html_url ?? `https://github.com/${repositoryFullName}`,
      createdAt: repo.created_at ?? "",
      updatedAt: repo.updated_at ?? "",
    };
  }

  // ============================================
  // Render: list view (for Telegram /repositories)
  // ============================================

  renderList(repos: ConnectedRepository[]): {
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
          `Use *Connect Repository* from the main menu to add one.`,
        ].join("\n"),
        replyMarkup: {
          inline_keyboard: [
            [{ text: "🔗 Connect Repository", callback_data: "menu:connect_repository" }],
            [{ text: "🔙 Back", callback_data: "menu:main" }],
          ],
        },
      };
    }

    const text = [
      `📦 *My Repositories* (${repos.length})`,
      ``,
      ...repos.map((r, i) => {
        const vis = r.visibility === "private" ? "🔒" : "🌐";
        const status = r.status === "active" ? "✅" : r.status === "paused" ? "⏸" : "❌";
        return `${i + 1}. ${status} ${vis} \`${r.repositoryFullName}\`
   • ${r.language} · ${r.defaultBranch} · ${Math.round(r.size)} KB
   • Last sync: ${new Date(r.lastSyncAt).toLocaleDateString()}`;
      }),
      ``,
      `Tap a repository below to select it:`,
    ].join("\n");

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = repos.map((r) => [
      { text: `${r.repositoryFullName}`, callback_data: `repos:select:${r.repositoryFullName}` },
    ]);
    keyboard.push([{ text: "🔙 Back", callback_data: "menu:main" }]);

    return { text, replyMarkup: { inline_keyboard: keyboard } };
  }

  // ============================================
  // Render: detail view (with select / rescan / remove)
  // ============================================

  renderDetail(repo: ConnectedRepository): {
    text: string;
    replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
  } {
    const vis = repo.visibility === "private" ? "🔒 Private" : "🌐 Public";
    const text = [
      `📦 *Repository Detail*`,
      ``,
      `*Name:* \`${repo.repositoryFullName}\``,
      `*Visibility:* ${vis}`,
      `*Language:* ${repo.language}`,
      `*Default branch:* ${repo.defaultBranch}`,
      `*Size:* ${Math.round(repo.size)} KB`,
      `*Status:* ${repo.status}`,
      `*Connected:* ${new Date(repo.connectedAt).toLocaleDateString()}`,
      `*Last sync:* ${new Date(repo.lastSyncAt).toLocaleDateString()}`,
    ].join("\n");

    return {
      text,
      replyMarkup: {
        inline_keyboard: [
          [
            { text: "✅ Select as Active", callback_data: `repos:select:${repo.repositoryFullName}` },
          ],
          [
            { text: "🔄 Rescan", callback_data: `repos:rescan:${repo.repositoryFullName}` },
            { text: "🗑 Remove", callback_data: `repos:remove:${repo.repositoryFullName}` },
          ],
          [{ text: "🔙 Back to List", callback_data: "menu:my_repositories" }],
        ],
      },
    };
  }

  // ============================================
  // Render: Step 5 summary (Repository Wizard)
  // ============================================

  renderSummary(summary: RepositorySummary): string {
    const vis = summary.visibility === "private" ? "🔒 Private" : "🌐 Public";
    return [
      `📦 *Repository Summary*`,
      ``,
      `*Name:* ${summary.displayName}`,
      `*Full name:* \`${summary.repositoryFullName}\``,
      `*Description:* ${summary.description || "(none)"}`,
      `*Visibility:* ${vis}`,
      `*Language:* ${summary.language}`,
      `*Default branch:* \`${summary.defaultBranch}\``,
      `*Size:* ${Math.round(summary.size)} KB`,
      `*Branches:* ${summary.branchesCount}`,
      `*Stars:* ${summary.starsCount} · *Forks:* ${summary.forksCount}`,
      `*Open issues:* ${summary.openIssuesCount}`,
      `*URL:* ${summary.htmlUrl}`,
      ``,
      `_Continue to Manager Repository Analysis?_`,
    ].join("\n");
  }

  // ============================================
  // Private: persist list
  // ============================================

  private async persist(userId: string, list: ConnectedRepository[]): Promise<void> {
    if (!this.env.HADES_KV) return;
    await this.env.HADES_KV.put(`${KV_PREFIX}${userId}`, JSON.stringify(list));
  }
}

// ============================================
// Factory
// ============================================

let _instance: RepositoryManager | null = null;

export function getRepositoryManager(env: HadesBindings): RepositoryManager {
  if (!_instance) _instance = new RepositoryManager(env);
  return _instance;
}
