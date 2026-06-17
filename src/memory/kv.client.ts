/**
 * Hades Army v0.2 — KV Runtime State Client
 * Fast ephemeral state. Lost on reset.
 * Pure ESM.
 */

import type { HadesEnv } from "../config/env";
import type { TaskState } from "../types";

export class KVClient {
  constructor(private env: HadesEnv) {}

  private get kv() {
    return this.env.HADES_KV;
  }

  // ============================================================
  // USER SESSION STATE
  // ============================================================

  async setUserActiveProject(telegramId: number, projectId: string): Promise<void> {
    await this.kv.put(`user:${telegramId}:active_project`, projectId, { expirationTtl: 86400 });
  }

  async getUserActiveProject(telegramId: number): Promise<string | null> {
    return this.kv.get(`user:${telegramId}:active_project`);
  }

  async setUserState(telegramId: number, state: string, data?: Record<string, unknown>): Promise<void> {
    const value = JSON.stringify({ state, data, updatedAt: new Date().toISOString() });
    await this.kv.put(`user:${telegramId}:state`, value, { expirationTtl: 3600 });
  }

  async getUserState(telegramId: number): Promise<{ state: string; data?: Record<string, unknown> } | null> {
    const raw = await this.kv.get(`user:${telegramId}:state`);
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async clearUserState(telegramId: number): Promise<void> {
    await this.kv.delete(`user:${telegramId}:state`);
  }

  // ============================================================
  // TASK RUNTIME STATE
  // ============================================================

  async setActiveTask(projectId: string, taskId: string): Promise<void> {
    await this.kv.put(`project:${projectId}:active_task`, taskId, { expirationTtl: 86400 });
  }

  async getActiveTask(projectId: string): Promise<string | null> {
    return this.kv.get(`project:${projectId}:active_task`);
  }

  async setTaskState(taskId: string, state: TaskState): Promise<void> {
    await this.kv.put(`task:${taskId}:state`, state, { expirationTtl: 86400 });
  }

  async getTaskState(taskId: string): Promise<TaskState | null> {
    const state = await this.kv.get(`task:${taskId}:state`);
    return state as TaskState | null;
  }

  // ============================================================
  // WORKFLOW CONTEXT
  // ============================================================

  async setWorkflowContext(taskId: string, context: Record<string, unknown>): Promise<void> {
    await this.kv.put(`workflow:${taskId}:context`, JSON.stringify(context), { expirationTtl: 86400 });
  }

  async getWorkflowContext(taskId: string): Promise<Record<string, unknown> | null> {
    const raw = await this.kv.get(`workflow:${taskId}:context`);
    return raw ? JSON.parse(raw) : null;
  }

  async deleteWorkflowContext(taskId: string): Promise<void> {
    await this.kv.delete(`workflow:${taskId}:context`);
  }

  // ============================================================
  // REPOSITORY INDEX CACHE
  // ============================================================

  async setRepoIndex(projectId: string, indexJson: string): Promise<void> {
    await this.kv.put(`project:${projectId}:repo_index`, indexJson, { expirationTtl: 604800 });
  }

  async getRepoIndex(projectId: string): Promise<string | null> {
    return this.kv.get(`project:${projectId}:repo_index`);
  }

  // ============================================================
  // RATE LIMITING
  // ============================================================

  async incrementRateLimit(key: string, windowSeconds: number): Promise<number> {
    const count = await this.kv.get(`ratelimit:${key}`);
    const current = count ? parseInt(count, 10) : 0;
    const next = current + 1;
    await this.kv.put(`ratelimit:${key}`, String(next), { expirationTtl: windowSeconds });
    return next;
  }

  async getRateLimitCount(key: string): Promise<number> {
    const count = await this.kv.get(`ratelimit:${key}`);
    return count ? parseInt(count, 10) : 0;
  }
}
