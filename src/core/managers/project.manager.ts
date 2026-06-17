/**
 * Hades Army v0.2 — Project Manager
 * Handles project CRUD, onboarding, and .hades initialization.
 * Pure ESM.
 */

import type { HadesEnv } from "../../config/env";
import type { Project } from "../../types";
import { D1Client } from "../../memory/d1.client";
import { KVClient } from "../../memory/kv.client";
import { HadesMemoryManager } from "../../memory/hades.memory";
import { Logger } from "../../utils/logger";
import { encrypt } from "../../utils/crypto";

export class ProjectManager {
  private d1: D1Client;
  private kv: KVClient;
  private logger: Logger;

  constructor(private env: HadesEnv) {
    this.d1 = new D1Client(env);
    this.kv = new KVClient(env);
    this.logger = new Logger(env);
  }

  async createProject(userId: number, name: string, repoUrl: string, githubToken: string): Promise<string> {
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\.git)?/);
    if (!match) throw new Error("Invalid GitHub URL");

    const [, owner, repoName] = match;
    const cleanRepoName = repoName.replace(/\.git$/, "");
    const encryptedToken = await encrypt(githubToken, this.env.ENCRYPTION_KEY);

    let user = await this.d1.getUserByTelegramId(userId);
    if (!user) {
      const userIdStr = await this.d1.createUser(userId);
      user = { id: userIdStr };
    }

    const projectId = await this.d1.createProject({
      userId: user.id,
      name,
      repoUrl,
      repoName: cleanRepoName,
      repoOwner: owner,
      defaultBranch: "main",
      status: "onboarding",
      githubTokenEncrypted: encryptedToken,
    });

    await this.kv.setUserActiveProject(userId, projectId);

    const project = await this.d1.getProject(projectId);
    if (project) {
      const memory = new HadesMemoryManager(this.env, project);
      await memory.initializeHadesDirectory();
    }

    await this.d1.updateProjectStatus(projectId, "active");
    await this.logger.info("project", `Created ${projectId}`, { name, repo: repoUrl });

    return projectId;
  }

  async getUserProjects(userId: number): Promise<Array<{ id: string; name: string; status: string; repoUrl: string }>> {
    const user = await this.d1.getUserByTelegramId(userId);
    if (!user) return [];
    const projects = await this.d1.getProjectsByUser(user.id);
    return projects.map(p => ({ id: p.id, name: p.name, status: p.status, repoUrl: p.repoUrl }));
  }

  async setActiveProject(userId: number, projectId: string): Promise<boolean> {
    const project = await this.d1.getProject(projectId);
    if (!project) return false;
    await this.kv.setUserActiveProject(userId, projectId);
    return true;
  }

  async getActiveProjectId(userId: number): Promise<string | null> {
    return this.kv.getUserActiveProject(userId);
  }

  async getStatus(projectId: string): Promise<string> {
    const project = await this.d1.getProject(projectId);
    if (!project) return "Project not found";

    const tasks = await this.d1.getTasksByProject(projectId);
    const active = tasks.filter(t => !["COMPLETED", "FAILED", "CANCELLED"].includes(t.state));
    const completed = tasks.filter(t => t.state === "COMPLETED");

    return `📊 *${project.name}*\n\nStatus: ${project.status}\nRepo: ${project.repoUrl}\n\n📋 Tasks: ${tasks.length}\n🔥 Active: ${active.length}\n✅ Completed: ${completed.length}\n\n${active.length > 0 ? `Current: ${active[0].title} (${active[0].state})` : "No active tasks"}`;
  }
}
