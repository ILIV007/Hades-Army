
/**
 * Workers Manager - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Background job and queue management:
 * - Job creation and scheduling
 * - Retry logic with backoff
 * - Job status tracking
 * - Queue processing
 * - Dead letter queue
 */

import { eq, desc, and, gte } from "drizzle-orm";
import { logger } from "../utils/logger";
import { generateId, sleep } from "../utils/helpers";
import { HadesError, NotFoundError, ValidationError } from "../utils/errors";
import { jobs } from "../database/schema";
import { createDb } from "../database/client";
import type { HadesBindings, Job, JobStatus, JobPriority } from "../types";

// ============================================
// Types
// ============================================

export interface CreateJobParams {
  type: string;
  payload: Record<string, unknown>;
  priority?: JobPriority;
  scheduledAt?: string;
  maxRetries?: number;
}

export interface JobResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface JobHandler {
  name: string;
  handler: (payload: Record<string, unknown>, env: HadesBindings) => Promise<JobResult>;
}

export interface WorkerStats {
  totalJobs: number;
  pendingJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  retryingJobs: number;
  byType: Record<string, number>;
}

// ============================================
// Workers Manager
// ============================================

export class WorkersManager {
  private handlers: Map<string, JobHandler> = new Map();
  private isProcessing: boolean = false;

  constructor() {
    this.registerDefaultHandlers();
  }

  // ============================================
  // Handler Registration
  // ============================================

  registerHandler(handler: JobHandler): void {
    this.handlers.set(handler.name, handler);
    logger.info(`Job handler registered: ${handler.name}`);
  }

  unregisterHandler(name: string): boolean {
    const removed = this.handlers.delete(name);
    if (removed) {
      logger.info(`Job handler unregistered: ${name}`);
    }
    return removed;
  }

  getHandler(name: string): JobHandler | undefined {
    return this.handlers.get(name);
  }

  getHandlers(): JobHandler[] {
    return Array.from(this.handlers.values());
  }

  private registerDefaultHandlers(): void {
    this.registerHandler({
      name: "agent_task",
      handler: async (payload, env) => {
        logger.info("Processing agent task", { payload });
        return { success: true, data: { processed: true } };
      },
    });

    this.registerHandler({
      name: "review_code",
      handler: async (payload, env) => {
        logger.info("Processing code review", { payload });
        return { success: true, data: { reviewed: true } };
      },
    });

    this.registerHandler({
      name: "send_notification",
      handler: async (payload, env) => {
        logger.info("Sending notification", { payload });
        return { success: true, data: { sent: true } };
      },
    });

    this.registerHandler({
      name: "health_check",
      handler: async (payload, env) => {
        logger.info("Running health check", { payload });
        return { success: true, data: { healthy: true } };
      },
    });

    this.registerHandler({
      name: "cleanup",
      handler: async (payload, env) => {
        logger.info("Running cleanup", { payload });
        return { success: true, data: { cleaned: true } };
      },
    });
  }

  // ============================================
  // Job CRUD
  // ============================================

  async createJob(env: HadesBindings, params: CreateJobParams): Promise<Job> {
    const db = createDb(env.HADES_DB);

    const id = generateId("job");
    const now = new Date().toISOString();

    const job: Job = {
      id,
      type: params.type,
      payload: params.payload,
      priority: params.priority || "normal",
      status: "pending",
      createdAt: now,
      scheduledAt: params.scheduledAt || now,
      retryCount: 0,
      maxRetries: params.maxRetries || 3,
    };

    await db.insert(jobs).values({
      id: job.id,
      type: job.type,
      payload: JSON.stringify(job.payload),
      priority: job.priority,
      status: job.status,
      createdAt: job.createdAt,
      scheduledAt: job.scheduledAt,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
    });

    logger.info(`Job created: ${job.id} (${job.type})`);
    return job;
  }

  async getJob(env: HadesBindings, id: string): Promise<Job | null> {
    const db = createDb(env.HADES_DB);

    const result = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.rowToJob(result[0]);
  }

  async getJobs(
    env: HadesBindings,
    options?: {
      status?: JobStatus;
      type?: string;
      priority?: JobPriority;
      limit?: number;
      offset?: number;
    }
  ): Promise<Job[]> {
    const db = createDb(env.HADES_DB);
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    let query = db
      .select()
      .from(jobs)
      .orderBy(desc(jobs.createdAt))
      .limit(limit)
      .offset(offset);

    const results = await query;
    return results.map((row) => this.rowToJob(row));
  }

  async getPendingJobs(env: HadesBindings, limit: number = 10): Promise<Job[]> {
    const db = createDb(env.HADES_DB);
    const now = new Date().toISOString();

    const results = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), gte(jobs.scheduledAt, now)))
      .orderBy(desc(jobs.priority))
      .limit(limit);

    return results.map((row) => this.rowToJob(row));
  }

  async cancelJob(env: HadesBindings, id: string): Promise<Job | null> {
    const db = createDb(env.HADES_DB);

    const job = await this.getJob(env, id);
    if (!job) {
      return null;
    }

    if (job.status === "running") {
      throw new ValidationError("Cannot cancel a running job");
    }

    if (job.status === "completed" || job.status === "failed") {
      throw new ValidationError(`Cannot cancel a ${job.status} job`);
    }

    await db
      .update(jobs)
      .set({ status: "cancelled" })
      .where(eq(jobs.id, id));

    logger.info(`Job cancelled: ${id}`);
    return this.getJob(env, id);
  }

  async deleteJob(env: HadesBindings, id: string): Promise<boolean> {
    const db = createDb(env.HADES_DB);

    const job = await this.getJob(env, id);
    if (!job) {
      return false;
    }

    await db.delete(jobs).where(eq(jobs.id, id));
    logger.info(`Job deleted: ${id}`);
    return true;
  }

  // ============================================
  // Job Processing
  // ============================================

  async processJob(env: HadesBindings, jobId: string): Promise<JobResult> {
    const db = createDb(env.HADES_DB);

    const job = await this.getJob(env, jobId);
    if (!job) {
      throw new NotFoundError(`Job with ID "${jobId}" not found`);
    }

    if (job.status !== "pending" && job.status !== "retrying") {
      throw new ValidationError(`Job is ${job.status}, cannot process`);
    }

    // Mark as running
    const startedAt = new Date().toISOString();
    await db
      .update(jobs)
      .set({ status: "running", startedAt })
      .where(eq(jobs.id, jobId));

    logger.info(`Job started: ${jobId} (${job.type})`);

    try {
      // Find handler
      const handler = this.handlers.get(job.type);
      if (!handler) {
        throw new HadesError(`No handler registered for job type: ${job.type}`, "NO_HANDLER", 500);
      }

      // Execute handler
      const result = await handler.handler(job.payload, env);

      if (result.success) {
        // Mark as completed
        await db
          .update(jobs)
          .set({
            status: "completed",
            completedAt: new Date().toISOString(),
            result: JSON.stringify(result.data),
          })
          .where(eq(jobs.id, jobId));

        logger.info(`Job completed: ${jobId}`);
      } else {
        // Mark for retry or failure
        await this.handleJobFailure(env, jobId, result.error || "Unknown error");
      }

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.handleJobFailure(env, jobId, errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async processNextJob(env: HadesBindings): Promise<JobResult | null> {
    const pending = await this.getPendingJobs(env, 1);
    if (pending.length === 0) {
      return null;
    }

    return this.processJob(env, pending[0].id);
  }

  async processBatch(env: HadesBindings, batchSize: number = 5): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const pending = await this.getPendingJobs(env, batchSize);
    let succeeded = 0;
    let failed = 0;

    for (const job of pending) {
      const result = await this.processJob(env, job.id);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    return {
      processed: pending.length,
      succeeded,
      failed,
    };
  }

  // ============================================
  // Retry Logic
  // ============================================

  private async handleJobFailure(env: HadesBindings, jobId: string, error: string): Promise<void> {
    const db = createDb(env.HADES_DB);

    const job = await this.getJob(env, jobId);
    if (!job) return;

    const newRetryCount = job.retryCount + 1;

    if (newRetryCount >= job.maxRetries) {
      // Mark as failed
      await db
        .update(jobs)
        .set({
          status: "failed",
          completedAt: new Date().toISOString(),
          error,
          retryCount: newRetryCount,
        })
        .where(eq(jobs.id, jobId));

      logger.error(`Job failed permanently: ${jobId} after ${newRetryCount} retries`, { error });
    } else {
      // Schedule retry with exponential backoff
      const backoffMs = Math.pow(2, newRetryCount) * 1000;
      const scheduledAt = new Date(Date.now() + backoffMs).toISOString();

      await db
        .update(jobs)
        .set({
          status: "retrying",
          error,
          retryCount: newRetryCount,
          scheduledAt,
        })
        .where(eq(jobs.id, jobId));

      logger.warn(`Job retry scheduled: ${jobId} (attempt ${newRetryCount}/${job.maxRetries})`, {
        backoffMs,
        scheduledAt,
      });
    }
  }

  async retryJob(env: HadesBindings, jobId: string): Promise<Job | null> {
    const db = createDb(env.HADES_DB);

    const job = await this.getJob(env, jobId);
    if (!job) {
      return null;
    }

    if (job.status !== "failed" && job.status !== "cancelled") {
      throw new ValidationError(`Cannot retry a ${job.status} job`);
    }

    await db
      .update(jobs)
      .set({
        status: "pending",
        retryCount: 0,
        error: null,
        scheduledAt: new Date().toISOString(),
      })
      .where(eq(jobs.id, jobId));

    logger.info(`Job queued for retry: ${jobId}`);
    return this.getJob(env, jobId);
  }

  // ============================================
  // Statistics
  // ============================================

  async getStats(env: HadesBindings): Promise<WorkerStats> {
    const db = createDb(env.HADES_DB);
    const allJobs = await db.select().from(jobs);

    const byType: Record<string, number> = {};
    for (const job of allJobs) {
      byType[job.type] = (byType[job.type] || 0) + 1;
    }

    return {
      totalJobs: allJobs.length,
      pendingJobs: allJobs.filter((j) => j.status === "pending").length,
      runningJobs: allJobs.filter((j) => j.status === "running").length,
      completedJobs: allJobs.filter((j) => j.status === "completed").length,
      failedJobs: allJobs.filter((j) => j.status === "failed").length,
      retryingJobs: allJobs.filter((j) => j.status === "retrying").length,
      byType,
    };
  }

  // ============================================
  // Cleanup
  // ============================================

  async cleanup(env: HadesBindings, options?: {
    olderThan?: string;
    status?: JobStatus[];
  }): Promise<number> {
    const db = createDb(env.HADES_DB);

    // In production, use proper DELETE queries
    // For now, just log the cleanup
    logger.info("Job cleanup requested", options);
    return 0;
  }

  // ============================================
  // Helpers
  // ============================================

  private rowToJob(row: Record<string, unknown>): Job {
    return {
      id: row.id as string,
      type: row.type as string,
      payload: JSON.parse((row.payload as string) || "{}"),
      priority: row.priority as JobPriority,
      status: row.status as JobStatus,
      createdAt: row.createdAt as string,
      scheduledAt: row.scheduledAt as string,
      startedAt: (row.startedAt as string) || undefined,
      completedAt: (row.completedAt as string) || undefined,
      retryCount: row.retryCount as number,
      maxRetries: row.maxRetries as number,
      error: (row.error as string) || undefined,
      result: row.result ? JSON.parse(row.result as string) : undefined,
    };
  }
}

export const workersManager = new WorkersManager();
