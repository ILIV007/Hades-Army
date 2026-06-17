/**
 * Hades Army v0.2.1 — Workflow Engine v2
 * Central orchestrator: Task Routing, Retry, Approval, Memory Sync, GitHub Sync.
 * Pure ESM.
 */

import type { HadesEnv } from "../config/env";
import type { Task, TaskState, WorkflowContext } from "../types";
import { TaskService } from "../services/task.service";
import { Logger } from "../utils/logger";
import { KVClient } from "../memory/kv.client";
import { D1Client } from "../memory/d1.client";

export class WorkflowEngine {
  private taskService: TaskService;
  private kv: KVClient;
  private d1: D1Client;
  private logger: Logger;
  private projectId: string;  // ← FIX HIGH #1: Store projectId locally

  constructor(env: HadesEnv, projectId: string) {
    this.taskService = new TaskService(env, projectId);
    this.kv = new KVClient(env);
    this.d1 = new D1Client(env);
    this.logger = new Logger(env, projectId);
    this.projectId = projectId;  // ← FIX HIGH #1: Store locally
  }

  async initializeWorkflow(taskId: string): Promise<WorkflowContext> {
    const context: WorkflowContext = {
      projectId: this.projectId,  // ← FIX HIGH #1: Use local projectId
      taskId,
      currentState: "CREATED",
      retryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.kv.setWorkflowContext(taskId, context);
    await this.logger.info("workflow", `Initialized ${taskId}`);
    return context;
  }

  async transition(taskId: string, newState: TaskState, reason: string): Promise<void> {
    const context = await this.kv.getWorkflowContext(taskId);
    if (!context) throw new Error(`No workflow context for ${taskId}`);

    const prev = context.currentState as TaskState;
    if (!this.isValidTransition(prev, newState)) {
      throw new Error(`Invalid: ${prev} -> ${newState}`);
    }

    await this.taskService.transitionState(taskId, newState, reason);

    const updated: WorkflowContext = {
      ...context,
      currentState: newState,
      updatedAt: new Date().toISOString(),
      retryCount: newState === "FAILED" ? (context.retryCount ?? 0) + 1 : context.retryCount,
    };
    await this.kv.setWorkflowContext(taskId, updated);

    await this.logger.info("workflow", `${prev} -> ${newState}`, { taskId, reason, retry: updated.retryCount });
  }

  // FIX HIGH #2: Retry goes back to previous state, not always BUILDING
  async executeWithRetry(
    taskId: string,
    previousState: TaskState,  // ← FIX HIGH #2: Accept previous state
    operation: () => Promise<void>
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await this.logger.error("workflow", `Operation failed: ${err}`, { taskId });

      const canRetry = await this.taskService.canRetry(taskId);
      if (canRetry) {
        await this.taskService.incrementRetry(taskId);
        // FIX HIGH #2: Go back to previous state, not hardcoded BUILDING
        await this.transition(taskId, previousState, `Retry after error: ${err}`);
        throw new Error(`RETRY_NEEDED: ${err}`);
      } else {
        await this.transition(taskId, "FAILED", `Max retries exceeded: ${err}`);
        throw error;
      }
    }
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

  async getState(taskId: string): Promise<WorkflowContext | null> {
    return this.kv.getWorkflowContext(taskId);
  }

  async canRetry(taskId: string): Promise<boolean> {
    const context = await this.kv.getWorkflowContext(taskId);
    if (!context) return false;
    const task = await this.d1.getTask(taskId);
    if (!task) return false;
    return (context.retryCount ?? 0) < task.maxRetries;
  }

  async cleanup(taskId: string): Promise<void> {
    await this.kv.deleteWorkflowContext(taskId);
    await this.logger.info("workflow", `Cleaned up ${taskId}`);
  }
}
