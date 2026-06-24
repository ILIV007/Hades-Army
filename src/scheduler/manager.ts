
/**
 * Scheduler Manager - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Cron job and scheduled task management:
 * - Cron expression parsing
 * - Job scheduling
 * - Recurring tasks
 * - Execution history
 * - Cron trigger integration
 */

import { eq, desc, and, gte } from "drizzle-orm";
import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import { HadesError, NotFoundError, ValidationError } from "../utils/errors";
import { scheduledJobs } from "../database/schema";
import { createDb } from "../database/client";
import type { HadesBindings, ScheduledJob, JobFrequency, ScheduledJobStatus } from "../types";

// ============================================
// Types
// ============================================

export interface CreateScheduledJobParams {
  name: string;
  description: string;
  frequency: JobFrequency;
  cronExpression?: string;
  handler: string;
  payload?: Record<string, unknown>;
  nextRunAt?: string;
  maxFailures?: number;
}

export interface UpdateScheduledJobParams {
  name?: string;
  description?: string;
  frequency?: JobFrequency;
  cronExpression?: string;
  handler?: string;
  payload?: Record<string, unknown>;
  enabled?: boolean;
  maxFailures?: number;
}

export interface CronExpression {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

// ============================================
// Scheduler Manager
// ============================================

export class SchedulerManager {
  // ============================================
  // CRUD Operations
  // ============================================

  async createJob(env: HadesBindings, params: CreateScheduledJobParams): Promise<ScheduledJob> {
    const db = createDb(env.HADES_DB);

    // Validate cron expression if provided
    if (params.cronExpression && !this.validateCronExpression(params.cronExpression)) {
      throw new ValidationError("Invalid cron expression");
    }

    const id = generateId("sch");
    const now = new Date().toISOString();
    const nextRunAt = params.nextRunAt || this.calculateNextRun(params.frequency, params.cronExpression);

    const job: ScheduledJob = {
      id,
      name: params.name,
      description: params.description,
      frequency: params.frequency,
      cronExpression: params.cronExpression,
      nextRunAt,
      status: "pending",
      handler: params.handler,
      payload: params.payload || {},
      runCount: 0,
      failureCount: 0,
      maxFailures: params.maxFailures || 3,
      enabled: true,
    };

    await db.insert(scheduledJobs).values({
      id: job.id,
      name: job.name,
      description: job.description,
      frequency: job.frequency,
      cronExpression: job.cronExpression,
      nextRunAt: job.nextRunAt,
      lastRunAt: job.lastRunAt,
      status: job.status,
      handler: job.handler,
      payload: JSON.stringify(job.payload),
      runCount: job.runCount,
      failureCount: job.failureCount,
      maxFailures: job.maxFailures,
      enabled: job.enabled ? 1 : 0,
    });

    logger.info(`Scheduled job created: ${job.id} - ${job.name} (${job.frequency})`);
    return job;
  }

  async getJob(env: HadesBindings, id: string): Promise<ScheduledJob | null> {
    const db = createDb(env.HADES_DB);

    const result = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.rowToJob(result[0]);
  }

  async getAllJobs(env: HadesBindings, options?: { enabled?: boolean; status?: ScheduledJobStatus }): Promise<ScheduledJob[]> {
    const db = createDb(env.HADES_DB);

    let query = db
      .select()
      .from(scheduledJobs)
      .orderBy(desc(scheduledJobs.createdAt));

    const results = await query;
    return results.map((row) => this.rowToJob(row));
  }

  async updateJob(
    env: HadesBindings,
    id: string,
    params: UpdateScheduledJobParams
  ): Promise<ScheduledJob | null> {
    const db = createDb(env.HADES_DB);

    const existing = await this.getJob(env, id);
    if (!existing) {
      return null;
    }

    // Validate cron expression if updated
    if (params.cronExpression && !this.validateCronExpression(params.cronExpression)) {
      throw new ValidationError("Invalid cron expression");
    }

    const updates: Record<string, unknown> = {};

    if (params.name !== undefined) updates.name = params.name;
    if (params.description !== undefined) updates.description = params.description;
    if (params.frequency !== undefined) updates.frequency = params.frequency;
    if (params.cronExpression !== undefined) updates.cronExpression = params.cronExpression;
    if (params.handler !== undefined) updates.handler = params.handler;
    if (params.payload !== undefined) updates.payload = JSON.stringify(params.payload);
    if (params.enabled !== undefined) updates.enabled = params.enabled ? 1 : 0;
    if (params.maxFailures !== undefined) updates.maxFailures = params.maxFailures;

    await db
      .update(scheduledJobs)
      .set(updates)
      .where(eq(scheduledJobs.id, id));

    logger.info(`Scheduled job updated: ${id}`);
    return this.getJob(env, id);
  }

  async deleteJob(env: HadesBindings, id: string): Promise<boolean> {
    const db = createDb(env.HADES_DB);

    const existing = await this.getJob(env, id);
    if (!existing) {
      return false;
    }

    await db.delete(scheduledJobs).where(eq(scheduledJobs.id, id));
    logger.info(`Scheduled job deleted: ${id}`);
    return true;
  }

  // ============================================
  // Job Execution
  // ============================================

  async executeJob(env: HadesBindings, id: string): Promise<{ success: boolean; error?: string }> {
    const db = createDb(env.HADES_DB);

    const job = await this.getJob(env, id);
    if (!job) {
      throw new NotFoundError(`Scheduled job with ID "${id}" not found`);
    }

    if (!job.enabled) {
      throw new ValidationError("Cannot execute a disabled job");
    }

    // Mark as running
    const now = new Date().toISOString();
    await db
      .update(scheduledJobs)
      .set({ status: "running", lastRunAt: now })
      .where(eq(scheduledJobs.id, id));

    logger.info(`Scheduled job started: ${id} - ${job.name}`);

    try {
      // Execute the handler
      // In production, this would dispatch to the appropriate handler
      const result = await this.executeHandler(job.handler, job.payload, env);

      if (result.success) {
        // Mark as completed
        const nextRunAt = this.calculateNextRun(job.frequency, job.cronExpression);
        await db
          .update(scheduledJobs)
          .set({
            status: "completed",
            nextRunAt,
            runCount: job.runCount + 1,
          })
          .where(eq(scheduledJobs.id, id));

        logger.info(`Scheduled job completed: ${id} - ${job.name}`);
      } else {
        // Mark as failed
        const newFailureCount = job.failureCount + 1;
        const shouldDisable = newFailureCount >= job.maxFailures;

        await db
          .update(scheduledJobs)
          .set({
            status: "failed",
            failureCount: newFailureCount,
            enabled: shouldDisable ? 0 : 1,
          })
          .where(eq(scheduledJobs.id, id));

        logger.error(`Scheduled job failed: ${id} - ${job.name}`, { error: result.error });

        if (shouldDisable) {
          logger.warn(`Scheduled job disabled due to max failures: ${id} - ${job.name}`);
        }
      }

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      const newFailureCount = job.failureCount + 1;
      const shouldDisable = newFailureCount >= job.maxFailures;

      await db
        .update(scheduledJobs)
        .set({
          status: "failed",
          failureCount: newFailureCount,
          enabled: shouldDisable ? 0 : 1,
        })
        .where(eq(scheduledJobs.id, id));

      logger.error(`Scheduled job error: ${id} - ${job.name}`, { error: errorMessage });

      return { success: false, error: errorMessage };
    }
  }

  async executeDueJobs(env: HadesBindings): Promise<{
    executed: number;
    succeeded: number;
    failed: number;
  }> {
    const db = createDb(env.HADES_DB);
    const now = new Date().toISOString();

    // Get jobs that are due
    const dueJobs = await db
      .select()
      .from(scheduledJobs)
      .where(
        and(
          eq(scheduledJobs.enabled, 1),
          eq(scheduledJobs.status, "pending"),
          gte(scheduledJobs.nextRunAt, now)
        )
      );

    let succeeded = 0;
    let failed = 0;

    for (const jobRow of dueJobs) {
      const job = this.rowToJob(jobRow);
      const result = await this.executeJob(env, job.id);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    return {
      executed: dueJobs.length,
      succeeded,
      failed,
    };
  }

  private async executeHandler(
    handler: string,
    payload: Record<string, unknown>,
    env: HadesBindings
  ): Promise<{ success: boolean; error?: string }> {
    // In production, this would dispatch to registered handlers
    // For now, simulate execution
    logger.debug(`Executing handler: ${handler}`, { payload });

    switch (handler) {
      case "health_check":
        return { success: true };
      case "cleanup":
        return { success: true };
      case "metrics_collection":
        return { success: true };
      case "backup":
        return { success: true };
      default:
        return { success: true };
    }
  }

  // ============================================
  // Job Control
  // ============================================

  async enableJob(env: HadesBindings, id: string): Promise<ScheduledJob | null> {
    return this.updateJob(env, id, { enabled: true });
  }

  async disableJob(env: HadesBindings, id: string): Promise<ScheduledJob | null> {
    return this.updateJob(env, id, { enabled: false });
  }

  async pauseJob(env: HadesBindings, id: string): Promise<ScheduledJob | null> {
    const db = createDb(env.HADES_DB);

    await db
      .update(scheduledJobs)
      .set({ status: "paused" })
      .where(eq(scheduledJobs.id, id));

    logger.info(`Scheduled job paused: ${id}`);
    return this.getJob(env, id);
  }

  async resumeJob(env: HadesBindings, id: string): Promise<ScheduledJob | null> {
    const db = createDb(env.HADES_DB);

    const job = await this.getJob(env, id);
    if (!job) return null;

    const nextRunAt = this.calculateNextRun(job.frequency, job.cronExpression);

    await db
      .update(scheduledJobs)
      .set({ status: "pending", nextRunAt })
      .where(eq(scheduledJobs.id, id));

    logger.info(`Scheduled job resumed: ${id}`);
    return this.getJob(env, id);
  }

  // ============================================
  // Cron Expression Parsing
  // ============================================

  validateCronExpression(expression: string): boolean {
    const parts = expression.split(" ");
    if (parts.length !== 5) {
      return false;
    }

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    return (
      this.validateCronField(minute, 0, 59) &&
      this.validateCronField(hour, 0, 23) &&
      this.validateCronField(dayOfMonth, 1, 31) &&
      this.validateCronField(month, 1, 12) &&
      this.validateCronField(dayOfWeek, 0, 7)
    );
  }

  private validateCronField(field: string, min: number, max: number): boolean {
    if (field === "*") return true;

    // Handle ranges (e.g., "1-5")
    if (field.includes("-")) {
      const [start, end] = field.split("-").map(Number);
      return !isNaN(start) && !isNaN(end) && start >= min && end <= max && start <= end;
    }

    // Handle lists (e.g., "1,3,5")
    if (field.includes(",")) {
      const values = field.split(",").map(Number);
      return values.every((v) => !isNaN(v) && v >= min && v <= max);
    }

    // Handle steps (e.g., "*/5")
    if (field.includes("/")) {
      const [base, step] = field.split("/");
      if (base !== "*") return false;
      return !isNaN(Number(step)) && Number(step) > 0;
    }

    // Single value
    const value = Number(field);
    return !isNaN(value) && value >= min && value <= max;
  }

  // ============================================
  // Next Run Calculation
  // ============================================

  private calculateNextRun(frequency: JobFrequency, cronExpression?: string): string {
    const now = new Date();

    switch (frequency) {
      case "once":
        return now.toISOString();
      case "minute":
        now.setMinutes(now.getMinutes() + 1);
        return now.toISOString();
      case "hourly":
        now.setHours(now.getHours() + 1);
        now.setMinutes(0);
        return now.toISOString();
      case "daily":
        now.setDate(now.getDate() + 1);
        now.setHours(0);
        now.setMinutes(0);
        return now.toISOString();
      case "weekly":
        now.setDate(now.getDate() + 7);
        now.setHours(0);
        now.setMinutes(0);
        return now.toISOString();
      case "monthly":
        now.setMonth(now.getMonth() + 1);
        now.setDate(1);
        now.setHours(0);
        now.setMinutes(0);
        return now.toISOString();
      case "custom":
        if (cronExpression) {
          // In production, use a proper cron parser
          now.setMinutes(now.getMinutes() + 5);
          return now.toISOString();
        }
        return now.toISOString();
      default:
        return now.toISOString();
    }
  }

  // ============================================
  // Statistics
  // ============================================

  async getStats(env: HadesBindings): Promise<{
    totalJobs: number;
    enabledJobs: number;
    disabledJobs: number;
    byFrequency: Record<string, number>;
    byStatus: Record<string, number>;
    totalRuns: number;
    totalFailures: number;
  }> {
    const jobs = await this.getAllJobs(env);

    const byFrequency: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalRuns = 0;
    let totalFailures = 0;

    for (const job of jobs) {
      byFrequency[job.frequency] = (byFrequency[job.frequency] || 0) + 1;
      byStatus[job.status] = (byStatus[job.status] || 0) + 1;
      totalRuns += job.runCount;
      totalFailures += job.failureCount;
    }

    return {
      totalJobs: jobs.length,
      enabledJobs: jobs.filter((j) => j.enabled).length,
      disabledJobs: jobs.filter((j) => !j.enabled).length,
      byFrequency,
      byStatus,
      totalRuns,
      totalFailures,
    };
  }

  // ============================================
  // Helpers
  // ============================================

  private rowToJob(row: Record<string, unknown>): ScheduledJob {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      frequency: row.frequency as JobFrequency,
      cronExpression: (row.cronExpression as string) || undefined,
      nextRunAt: row.nextRunAt as string,
      lastRunAt: (row.lastRunAt as string) || undefined,
      status: row.status as ScheduledJobStatus,
      handler: row.handler as string,
      payload: JSON.parse((row.payload as string) || "{}"),
      runCount: row.runCount as number,
      failureCount: row.failureCount as number,
      maxFailures: row.maxFailures as number,
      enabled: Boolean(row.enabled),
    };
  }
}

export const schedulerManager = new SchedulerManager();
