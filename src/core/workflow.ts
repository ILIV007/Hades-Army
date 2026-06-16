/**
 * Hades Army — Workflow Engine
 * Central orchestrator for task execution lifecycle.
 */

import type { HadesEnv } from '../config/env';
import type { Task, TaskState, WorkflowContext } from '../types';
import { TaskService } from '../services/task.service';
import { Logger } from '../utils/logger';
import { KVClient } from '../memory/kv.client';

export class WorkflowEngine {
  private taskService: TaskService;
  private kv: KVClient;
  private logger: Logger;

  constructor(
    private env: HadesEnv,
    private projectId: string
  ) {
    this.taskService = new TaskService(env, projectId);
    this.kv = new KVClient(env);
    this.logger = new Logger(env, projectId);
  }

  /**
   * Initialize a new workflow for a task.
   */
  async initializeWorkflow(taskId: string): Promise<WorkflowContext> {
    const context: WorkflowContext = {
      projectId: this.projectId,
      taskId,
      currentState: 'CREATED',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.kv.setWorkflowContext(taskId, context);
    await this.logger.info('workflow', `Workflow initialized for task ${taskId}`);

    return context;
  }

  /**
   * Transition workflow to a new state.
   */
  async transition(taskId: string, newState: TaskState, reason: string): Promise<void> {
    const context = await this.kv.getWorkflowContext(taskId);
    if (!context) {
      throw new Error(`Workflow context not found for task ${taskId}`);
    }

    const previousState = context.currentState as TaskState;

    // Validate transition
    if (!this.isValidTransition(previousState, newState)) {
      throw new Error(`Invalid workflow transition: ${previousState} -> ${newState}`);
    }

    // Update task state in D1
    await this.taskService.transitionState(taskId, newState, reason);

    // Update workflow context
    const updatedContext: WorkflowContext = {
      ...context,
      currentState: newState,
      updatedAt: new Date().toISOString(),
    };

    if (newState === 'FAILED') {
      updatedContext.retryCount = (context.retryCount ?? 0) + 1;
    }

    await this.kv.setWorkflowContext(taskId, updatedContext);

    await this.logger.info('workflow', `Transition: ${previousState} -> ${newState}`, {
      taskId,
      reason,
      retryCount: updatedContext.retryCount,
    });
  }

  /**
   * Check if a state transition is valid.
   */
  private isValidTransition(from: TaskState, to: TaskState): boolean {
    const transitions: Record<TaskState, TaskState[]> = {
      'CREATED': ['PLANNING', 'CANCELLED'],
      'PLANNING': ['READY', 'FAILED', 'CANCELLED'],
      'READY': ['BUILDING', 'FAILED', 'CANCELLED'],
      'BUILDING': ['REVIEWING', 'FAILED', 'CANCELLED'],
      'REVIEWING': ['PR_CREATED', 'BUILDING', 'FAILED', 'CANCELLED'],
      'PR_CREATED': ['WAITING_APPROVAL', 'FAILED', 'CANCELLED'],
      'WAITING_APPROVAL': ['MERGED', 'BUILDING', 'CANCELLED'],
      'MERGED': ['COMPLETED', 'FAILED'],
      'COMPLETED': [],
      'FAILED': ['CREATED', 'CANCELLED'],
      'BLOCKED': ['READY', 'CANCELLED'],
      'CANCELLED': [],
    };

    return transitions[from]?.includes(to) ?? false;
  }

  /**
   * Get current workflow state.
   */
  async getState(taskId: string): Promise<WorkflowContext | null> {
    return this.kv.getWorkflowContext(taskId);
  }

  /**
   * Check if a task can be retried.
   */
  async canRetry(taskId: string): Promise<boolean> {
    const context = await this.kv.getWorkflowContext(taskId);
    if (!context) return false;

    const task = await this.taskService.getTask(taskId);
    if (!task) return false;

    return (context.retryCount ?? 0) < task.maxRetries;
  }

  /**
   * Clean up workflow context.
   */
  async cleanup(taskId: string): Promise<void> {
    await this.kv.deleteWorkflowContext(taskId);
    await this.logger.info('workflow', `Cleaned up workflow for task ${taskId}`);
  }
}
