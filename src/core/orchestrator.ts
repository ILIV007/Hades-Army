/**
 * Task Orchestrator - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";

export interface Task {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  priority: number;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: string;
}

export class Orchestrator {
  private tasks: Map<string, Task> = new Map();

  async createTask(type: string, payload: Record<string, unknown>, priority: number = 5): Promise<Task> {
    const task: Task = {
      id: generateId("task"),
      type,
      payload,
      priority,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);
    logger.info(`Task created: ${task.id} (${type})`);
    return task;
  }

  async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.status = "running";
    logger.info(`Task executing: ${taskId}`);
    // Simulate execution
    task.status = "completed";
    logger.info(`Task completed: ${taskId}`);
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }
}

export const orchestrator = new Orchestrator();
