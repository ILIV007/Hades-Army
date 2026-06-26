/**
 * GitHub OAuth Manager - Cloudflare Workers Edition
 * Hades Army v9.6 — GitHub Token Flow
 *
 * Priority 1+2: Full OAuth flow with per-user encrypted token storage.
 *
 * Flow:
 *   1. User taps "Connect GitHub" → bot sends OAuth URL
 *   2. User authorizes on GitHub
 *   3. GitHub redirects to /oauth/callback?code=...&state=...
 *   4. Worker exchanges code for access token
 *   5. Token encrypted + stored in KV (per-user)
 *   6. Worker fetches user's repository list
 *   7. User selects repository
 *   8. Manager validates + creates project
 *
 * Each user has their OWN token — never uses a shared global token.
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  publicRepos: number;
  privateRepos: number;
}

export interface GitHubRepoInfo {
  id: number;
  fullName: string;
  name: string;
  description: string | null;
  private: boolean;
  language: string | null;
  defaultBranch: string;
  updatedAt: string;
  stargazersCount: number;
  htmlUrl: string;
}

export interface OAuthSession {
  state: string;
  telegramUserId: string;
  chatId: number;
  createdAt: string;
}

export interface StoredToken {
  telegramUserId: string;
  githubUserId: number;
  githubLogin: string;
  /** XOR-encrypted token (not plaintext) */
  encryptedToken: string;
  scopes: string[];
  createdAt: string;
}

// ============================================
// OAuth Manager
// ============================================

const OAUTH_SESSION_PREFIX = "oauth-session:";
const TOKEN_PREFIX = "github-token:";
const GITHUB_CLIENT_ID = "OAUTH_GITHUB_CLIENT_ID";  // env var
const GITHUB_CLIENT_SECRET = "OAUTH_GITHUB_CLIENT_SECRET";  // env var

// XOR encryption (simple but sufficient for KV storage — use Web Crypto for production)
function encryptToken(token: string, key: string): string {
  if (!key) return token; // no encryption if no key
  const result: string[] = [];
  for (let i = 0; i < token.length; i++) {
    result.push(String.fromCharCode(token.charCodeAt(i) ^ key.charCodeAt(i % key.length)));
  }
  return btoa(result.join(""));
}

function decryptToken(encrypted: string, key: string): string {
  if (!key) return encrypted;
  try {
    const decoded = atob(encrypted);
    const result: string[] = [];
    for (let i = 0; i < decoded.length; i++) {
      result.push(String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length)));
    }
    return result.join("");
  } catch {
    return encrypted;
  }
}

export class GitHubOAuthManager {
  private env: HadesBindings;

  constructor(env: HadesBindings) {
    this.env = env;
  }

  /**
   * Check if OAuth is configured (client ID + secret set).
   */
  isOAuthConfigured(): boolean {
    const clientId = (this.env as any)[GITHUB_CLIENT_ID];
    const clientSecret = (this.env as any)[GITHUB_CLIENT_SECRET];
    return !!(clientId && clientSecret);
  }

  /**
   * Get the worker's base URL from the request.
   */
  getWorkerUrl(request: Request): string {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  }

  /**
   * Step 1: Create OAuth session + generate authorization URL.
   */
  async createAuthorizationUrl(
    telegramUserId: string,
    chatId: number,
    workerUrl: string,
  ): Promise<{ url: string; state: string } | { error: string }> {
    const clientId = (this.env as any)[GITHUB_CLIENT_ID];
    if (!clientId) {
      return {
        error: "GitHub OAuth is not configured. The admin must set OAUTH_GITHUB_CLIENT_ID and OAUTH_GITHUB_CLIENT_SECRET.",
      };
    }

    const state = generateId("oauth");
    const session: OAuthSession = {
      state,
      telegramUserId,
      chatId,
      createdAt: new Date().toISOString(),
    };

    // Store session in KV (10 minute TTL)
    if (this.env.HADES_KV) {
      await this.env.HADES_KV.put(`${OAUTH_SESSION_PREFIX}${state}`, JSON.stringify(session), {
        expirationTtl: 600,
      });
    }

    const redirectUri = `${workerUrl}/oauth/callback`;
    const scopes = ["repo", "user:email"].join(" ");
    const url = [
      `https://github.com/login/oauth/authorize`,
      `?client_id=${encodeURIComponent(clientId)}`,
      `&redirect_uri=${encodeURIComponent(redirectUri)}`,
      `&scope=${encodeURIComponent(scopes)}`,
      `&state=${encodeURIComponent(state)}`,
    ].join("");

    logger.info("GitHubOAuth: created authorization URL", { telegramUserId, state });
    return { url, state };
  }

  /**
   * Step 2: Exchange code for access token (called from /oauth/callback).
   */
  async exchangeCodeForToken(code: string, state: string): Promise<{
    ok: boolean;
    telegramUserId?: string;
    chatId?: number;
    error?: string;
  }> {
    // Validate state
    if (!this.env.HADES_KV) {
      return { ok: false, error: "KV not available" };
    }

    const sessionRaw = await this.env.HADES_KV.get(`${OAUTH_SESSION_PREFIX}${state}`);
    if (!sessionRaw) {
      return { ok: false, error: "Invalid or expired OAuth session" };
    }

    const session = JSON.parse(sessionRaw) as OAuthSession;

    // Exchange code for token
    const clientId = (this.env as any)[GITHUB_CLIENT_ID];
    const clientSecret = (this.env as any)[GITHUB_CLIENT_SECRET];

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!tokenRes.ok) {
      return { ok: false, error: `GitHub token exchange failed: ${tokenRes.status}` };
    }

    const tokenData = await tokenRes.json() as any;
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return { ok: false, error: "No access_token in GitHub response" };
    }

    // Fetch GitHub user info
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "HadesArmy/9.6",
      },
    });

    if (!userRes.ok) {
      return { ok: false, error: "Failed to fetch GitHub user info" };
    }

    const userData = await userRes.json() as any;

    // Encrypt + store token
    const encryptionKey = this.env.ENCRYPTION_KEY ?? "hades-default-key";
    const encrypted = encryptToken(accessToken, encryptionKey);

    const stored: StoredToken = {
      telegramUserId: session.telegramUserId,
      githubUserId: userData.id,
      githubLogin: userData.login,
      encryptedToken: encrypted,
      scopes: (tokenData.scope ?? "").split(","),
      createdAt: new Date().toISOString(),
    };

    await this.env.HADES_KV.put(`${TOKEN_PREFIX}${session.telegramUserId}`, JSON.stringify(stored));

    // Clean up session
    await this.env.HADES_KV.delete(`${OAUTH_SESSION_PREFIX}${state}`);

    logger.info("GitHubOAuth: token stored", {
      telegramUserId: session.telegramUserId,
      githubLogin: userData.login,
    });

    return {
      ok: true,
      telegramUserId: session.telegramUserId,
      chatId: session.chatId,
    };
  }

  /**
   * Get the stored access token for a user (decrypted).
   */
  async getAccessToken(telegramUserId: string): Promise<string | undefined> {
    if (!this.env.HADES_KV) return undefined;
    const raw = await this.env.HADES_KV.get(`${TOKEN_PREFIX}${telegramUserId}`);
    if (!raw) return undefined;
    try {
      const stored = JSON.parse(raw) as StoredToken;
      const encryptionKey = this.env.ENCRYPTION_KEY ?? "hades-default-key";
      return decryptToken(stored.encryptedToken, encryptionKey);
    } catch {
      return undefined;
    }
  }

  /**
   * Get stored token info (without decrypting the token itself).
   */
  async getTokenInfo(telegramUserId: string): Promise<StoredToken | undefined> {
    if (!this.env.HADES_KV) return undefined;
    const raw = await this.env.HADES_KV.get(`${TOKEN_PREFIX}${telegramUserId}`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as StoredToken;
    } catch {
      return undefined;
    }
  }

  /**
   * Fetch the user's repositories using their stored token.
   */
  async fetchUserRepositories(telegramUserId: string): Promise<GitHubRepoInfo[]> {
    const token = await this.getAccessToken(telegramUserId);
    if (!token) return [];

    const res = await fetch("https://api.github.com/user/repos?sort=updated&per_page=50", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "HadesArmy/9.6",
      },
    });

    if (!res.ok) return [];

    const repos = await res.json() as any[];
    return repos.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      name: r.name,
      description: r.description,
      private: r.private,
      language: r.language,
      defaultBranch: r.default_branch,
      updatedAt: r.updated_at,
      stargazersCount: r.stargazers_count,
      htmlUrl: r.html_url,
    }));
  }

  /**
   * Check if user has a valid token.
   */
  async hasToken(telegramUserId: string): Promise<boolean> {
    const token = await this.getAccessToken(telegramUserId);
    return !!token;
  }

  /**
   * Revoke + delete token.
   */
  async revokeToken(telegramUserId: string): Promise<void> {
    if (!this.env.HADES_KV) return;
    await this.env.HADES_KV.delete(`${TOKEN_PREFIX}${telegramUserId}`);
    logger.info("GitHubOAuth: token revoked", { telegramUserId });
  }
}

// ============================================
// Factory
// ============================================

let _instance: GitHubOAuthManager | null = null;

export function getGitHubOAuthManager(env: HadesBindings): GitHubOAuthManager {
  if (!_instance) _instance = new GitHubOAuthManager(env);
  return _instance;
}
