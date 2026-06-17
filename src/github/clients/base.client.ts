/**
 * Hades Army v0.2 — GitHub Base Client
 * Shared authentication and request logic for all GitHub clients.
 * Pure ESM.
 */

import type { HadesEnv } from "../../config/env";
import type { Project } from "../../types";
import { decrypt } from "../../utils/crypto";

export class GitHubBaseClient {
  constructor(
    protected env: HadesEnv,
    protected project: Project
  ) {}

  protected get apiBase(): string {
    return this.env.GITHUB_API_BASE_URL;
  }

  protected get repoPath(): string {
    return `${this.project.repoOwner}/${this.project.repoName}`;
  }

  protected async getToken(): Promise<string> {
    return decrypt(this.project.githubTokenEncrypted, this.env.ENCRYPTION_KEY);
  }

  protected async headers(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Hades-Army/1.0",
    };
  }

  protected async headersWithContentType(): Promise<Record<string, string>> {
    const base = await this.headers();
    return { ...base, "Content-Type": "application/json" };
  }

  /**
   * Generic GET request with error handling.
   */
  protected async get<T>(path: string): Promise<T> {
    const headers = await this.headers();
    const res = await fetch(`${this.apiBase}${path}`, { headers });
    if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  /**
   * Generic POST request with error handling.
   */
  protected async post<T>(path: string, body: unknown): Promise<T> {
    const headers = await this.headersWithContentType();
    const res = await fetch(`${this.apiBase}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub POST ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  /**
   * Generic PUT request with error handling.
   */
  protected async put<T>(path: string, body: unknown): Promise<T> {
    const headers = await this.headersWithContentType();
    const res = await fetch(`${this.apiBase}${path}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub PUT ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  }

  /**
   * Generic DELETE request with error handling.
   */
  protected async delete(path: string): Promise<void> {
    const headers = await this.headers();
    const res = await fetch(`${this.apiBase}${path}`, {
      method: "DELETE",
      headers,
    });
    if (!res.ok && res.status !== 422) {
      throw new Error(`GitHub DELETE ${path} failed: ${res.status}`);
    }
  }
}
