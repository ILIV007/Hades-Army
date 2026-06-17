/**
 * Hades Army v0.2 — Task Service
 * Task CRUD, state management, and file locking.
 * Pure ESM.
 */

import type { HadesEnv } from "../config/env";
import type { Task, TaskState, TaskPriority, TaskInput } from "../types";
import { D1Client } from "../memory/d1.client";
import { KVClient } from "../memory/kv.client";
import { Logger } from "../utils/logger";

export class TaskService {
  private d1: D1Client;
  private kv: KVClient;
  private logger: Logger;

  constructor(private env: HadesEnv, private projectId: string) {
    this.d1 = new D1Client(env);
    this.kv = new KVClient(env);
    this.logger = new Logger(env, projectId);
  }

  async createTask(input: TaskInput): Promise<Task> {
    const id = await this.d1.createTask({
      projectId: this.projectId,
      title: input.description.slice(0, 100),
      description: input.description,
      state: "CREATED",
      priority: input.priority,
      assignedAgent: null,
      parentTaskId: undefined,
      dependencies: input.dependencies,
      requiredFiles: input.requiredFiles,
      constraints: input.constraints,
      expectedOutput: input.expectedOutput,
      maxRetries: 3,
    });

    const task = await this.d1.getTask(id);
    if (!task) throw new Error("Failed to create task");

    await this.logger.info("task", `Created task ${id}`, { title: task.title, priority: task.priority });
    return task;
  }

  async getTask(id: string): Promise<Task | null> {
    return this.d1.getTask(id);
  }

  async getProjectTasks(): Promise<Task[]> {
    return this.d1.getTasksByProject(this.projectId);
  }

  async getActiveTasks(): Promise<Task[]> {
    return this.d1.getActiveTasksByProject(this.projectId);
  }

  async transitionState(taskId: string, newState: TaskState, reason: string): Promise<void> {
    const task = await this.d1.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    if (!this.isValidTransition(task.state, newState)) {
      throw new Error(`Invalid state transition: ${task.state} -> ${newState}`);
    }

    await this.d1.updateTaskState(taskId, newState, reason);
    await this.kv.setTaskState(taskId, newState);

    await this.logger.info("task", `State: ${task.state} -> ${newState}`, { taskId, reason });
  }

  private isValidTransition(from: TaskState, to: TaskState): boolean {
    const transitions: Record<TaskState, TaskState[]> = {
      "CREATED": ["PLANNING", "CANCELLED"],
      "PLANNING": ["READY", "FAILED", "CANCELLED"],
      "READY": ["BUILDING", "FAILED", "CANCELLED"],
      "BUILDING": ["REVIEWING", "FAILED", "CANCELLED"],
      "REVIEWING": ["PR_CREATED", "BUILDING", "FAILED", "CANCELLED"],
      "PR_CREATED": ["WAITING_APPROVAL", "FAILED", "CANCELLED"],
      "WAITING_APPROVAL": ["MERGED", "BUILDING", "CANCELLED"],
      "MERGED": ["COMPLETED", "FAILED"],
      "COMPLETED": [],
      "FAILED": ["CREATED", "CANCELLED"],
      "BLOCKED": ["READY", "CANCELLED"],
      "CANCELLED": [],
    };
    return transitions[from]?.includes(to) ?? false;
  }

  async assignAgent(taskId: string, agent: "manager" | "builder" | "reviewer"): Promise<void> {
    await this.d1.db.prepare(`UPDATE tasks SET assigned_agent = ? WHERE id = ?`).bind(agent, taskId).run();
    await this.kv.setActiveTask(this.projectId, taskId);
    await this.logger.info("task", `Assigned ${agent} to ${taskId}`);
  }

  async canRetry(taskId: string): Promise<boolean> {
    const task = await this.d1.getTask(taskId);
    if (!task) return false;
    return task.retryCount < task.maxRetries;
  }

  async incrementRetry(taskId: string): Promise<void> {
    await this.d1.incrementRetryCount(taskId);
    await this.logger.info("task", `Retry incremented for ${taskId}`);
  }

  async lockFiles(taskId: string, filePaths: string[]): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

    for (const filePath of filePaths) {
      const existing = await this.d1.getFileLock(filePath);
      if (existing && existing.taskId !== taskId) {
        throw new Error(`File locked by another task: ${filePath} (task ${existing.taskId})`);
      }
      await this.d1.createFileLock(filePath, taskId, expiresAt.toISOString());
    }

    await this.logger.info("task", `Locked ${filePaths.length} files for ${taskId}`);
  }

  async unlockFiles(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      await this.d1.releaseFileLock(filePath);
    }
  }

  async unlockTaskFiles(taskId: string): Promise<void> {
    const locks = await this.d1.getLocksByTask(taskId);
    for (const lock of locks) {
      await this.d1.releaseFileLock(lock.filePath);
    }
    await this.logger.info("task", `Released ${locks.length} locks for ${taskId}`);
  }

  async checkFileLocks(filePaths: string[], taskId: string): Promise<{ locked: string[]; available: string[] }> {
    const locked: string[] = [];
    const available: string[] = [];

    for (const filePath of filePaths) {
      const existing = await this.d1.getFileLock(filePath);
      if (existing && existing.taskId !== taskId) {
        locked.push(filePath);
      } else {
        available.push(filePath);
      }
    }

    return { locked, available };
  }
}
