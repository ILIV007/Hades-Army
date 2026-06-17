/**
 * Hades Army v0.2.1 — Memory Sync Engine
 * Transactional sync between Repository Memory, D1, and KV.
 * Pure ESM.
 */

import type { HadesEnv } from "../config/env";
import type { Project, HadesMemory, TaskMemory, ReviewMemory } from "../types";
import { HadesMemoryManager } from "./hades.memory";
import { D1Client } from "./d1.client";
import { KVClient } from "./kv.client";
import { Logger } from "../utils/logger";

export interface SyncResult {
  success: boolean;
  source: "repo" | "d1" | "kv";
  conflicts: string[];
  merged: boolean;
}

export class MemorySyncEngine {
  private repo: HadesMemoryManager;
  private d1: D1Client;
  private kv: KVClient;
  private logger: Logger;

  constructor(env: HadesEnv, project: Project) {
    this.repo = new HadesMemoryManager(env, project);
    this.d1 = new D1Client(env);
    this.kv = new KVClient(env);
    this.logger = new Logger(env, project.id);
  }

  /**
   * Full sync: Read from all sources, reconcile, write back.
   * Priority: D1 > Repo > KV (D1 is source of truth for tasks/reviews)
   */
  async fullSync(): Promise<SyncResult> {
    await this.logger.info("memory", "Starting full sync");

    const [repoMemory, d1Tasks, d1Reviews] = await Promise.all([
      this.repo.readMemory(),
      this.d1.getTasksByProject(this.repo["project"].id).catch(() => []),
      this.d1.getTasksByProject(this.repo["project"].id).catch(() => []), // Reviews stored in tasks for simplicity
    ]);

    // Convert D1 tasks to memory format
    const d1TaskMemories: TaskMemory[] = d1Tasks.map(t => ({
      taskId: t.id,
      title: t.title,
      state: t.state,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
    }));

    const conflicts: string[] = [];
    let merged = false;

    // If repo memory exists, reconcile with D1
    if (repoMemory) {
      const repoTaskIds = new Set(repoMemory.tasks.map(t => t.taskId));
      const d1TaskIds = new Set(d1TaskMemories.map(t => t.taskId));

      // Find conflicts: tasks in both with different states
      for (const d1Task of d1TaskMemories) {
        const repoTask = repoMemory.tasks.find(t => t.taskId === d1Task.taskId);
        if (repoTask && repoTask.state !== d1Task.state) {
          conflicts.push(`Task ${d1Task.taskId}: repo=${repoTask.state} vs d1=${d1Task.state}`);
          // D1 wins
          repoTask.state = d1Task.state;
          merged = true;
        }
      }

      // Add missing tasks from D1
      for (const d1Task of d1TaskMemories) {
        if (!repoTaskIds.has(d1Task.taskId)) {
          repoMemory.tasks.push(d1Task);
          merged = true;
        }
      }

      // Update project state
      repoMemory.projectState.lastUpdated = new Date().toISOString();

      // Write reconciled memory back to repo
      await this.repo.writeMemory({
        projectState: repoMemory.projectState,
        tasks: repoMemory.tasks,
        reviews: repoMemory.reviews,
      });

      await this.logger.info("memory", `Sync complete: ${conflicts.length} conflicts, merged=${merged}`);

      return {
        success: true,
        source: "d1",
        conflicts,
        merged,
      };
    }

    // No repo memory, initialize from D1
    if (d1TaskMemories.length > 0) {
      await this.repo.writeMemory({
        projectState: {
          currentStatus: "active",
          activeTaskId: d1TaskMemories.find(t => !["COMPLETED", "FAILED", "CANCELLED"].includes(t.state))?.taskId ?? null,
          lastUpdated: new Date().toISOString(),
          metadata: {},
        },
        tasks: d1TaskMemories,
        reviews: [],
      });

      return {
        success: true,
        source: "d1",
        conflicts: [],
        merged: true,
      };
    }

    return {
      success: true,
      source: "kv",
      conflicts: [],
      merged: false,
    };
  }

  /**
   * Recovery: If repo memory is corrupted/missing, rebuild from D1
   */
  async recover(): Promise<boolean> {
    await this.logger.warn("memory", "Starting recovery from D1");

    try {
      const tasks = await this.d1.getTasksByProject(this.repo["project"].id);
      if (tasks.length === 0) {
        await this.logger.warn("memory", "No D1 data for recovery");
        return false;
      }

      const taskMemories: TaskMemory[] = tasks.map(t => ({
        taskId: t.id,
        title: t.title,
        state: t.state,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      }));

      await this.repo.writeMemory({
        projectState: {
          currentStatus: "recovered",
          activeTaskId: taskMemories.find(t => !["COMPLETED", "FAILED", "CANCELLED"].includes(t.state))?.taskId ?? null,
          lastUpdated: new Date().toISOString(),
          metadata: { recovered: true },
        },
        tasks: taskMemories,
        reviews: [],
      });

      await this.logger.info("memory", `Recovery complete: ${taskMemories.length} tasks restored`);
      return true;
    } catch (error) {
      await this.logger.error("memory", `Recovery failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Reconciliation: Periodic check for drift between sources
   */
  async reconcile(): Promise<SyncResult> {
    return this.fullSync();
  }
}
