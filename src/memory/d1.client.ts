/**
 * Hades Army v0.2 — D1 Database Client
 * All D1 operations. Pure ESM.
 */

import type { HadesEnv } from "../config/env";
import type {
  Project, Task, TaskStateTransition, AgentRun,
  Approval, FileLock, ModelUsage
} from "../types";

export class D1Client {
  constructor(private env: HadesEnv) {}

  private get db() {
    return this.env.HADES_D1;
  }

  async createUser(telegramId: number, settingsJson: string = "{}"): Promise<string> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO users (id, telegram_id, settings_json, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(id, telegramId, settingsJson, new Date().toISOString())
      .run();
    return id;
  }

  async getUserByTelegramId(telegramId: number): Promise<{ id: string } | null> {
    const result = await this.db
      .prepare(`SELECT id FROM users WHERE telegram_id = ?`)
      .bind(telegramId)
      .first<{ id: string }>();
    return result ?? null;
  }

  async createProject(
    project: Omit<Project, "id" | "createdAt" | "updatedAt">
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO projects (id, user_id, name, repo_url, repo_name, repo_owner, default_branch, status, github_token_encrypted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        project.userId,
        project.name,
        project.repoUrl,
        project.repoName,
        project.repoOwner,
        project.defaultBranch,
        project.status,
        project.githubTokenEncrypted,
        now,
        now
      )
      .run();
    return id;
  }

  async getProject(id: string): Promise<Project | null> {
    const result = await this.db
      .prepare(`SELECT * FROM projects WHERE id = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    return result ? this.mapProject(result) : null;
  }

  async getProjectsByUser(userId: string): Promise<Project[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC`
      )
      .bind(userId)
      .all<Record<string, unknown>>();
    return (results ?? []).map((r) => this.mapProject(r));
  }

  async updateProjectStatus(id: string, status: Project["status"]): Promise<void> {
    await this.db
      .prepare(`UPDATE projects SET status = ?, updated_at = ? WHERE id = ?`)
      .bind(status, new Date().toISOString(), id)
      .run();
  }

  private mapProject(row: Record<string, unknown>): Project {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      name: row.name as string,
      repoUrl: row.repo_url as string,
      repoName: row.repo_name as string,
      repoOwner: row.repo_owner as string,
      defaultBranch: row.default_branch as string,
      status: row.status as Project["status"],
      githubTokenEncrypted: row.github_token_encrypted as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  async createTask(
    task: Omit<Task, "id" | "createdAt" | "updatedAt" | "completedAt" | "retryCount">
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, title, description, state, priority, assigned_agent, parent_task_id, dependencies, required_files, constraints, expected_output, created_at, updated_at, retry_count, max_retries)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        task.projectId,
        task.title,
        task.description,
        task.state,
        task.priority,
        task.assignedAgent,
        task.parentTaskId ?? null,
        JSON.stringify(task.dependencies),
        JSON.stringify(task.requiredFiles),
        JSON.stringify(task.constraints),
        task.expectedOutput,
        now,
        now,
        0,
        task.maxRetries ?? 3
      )
      .run();
    return id;
  }

  async getTask(id: string): Promise<Task | null> {
    const result = await this.db
      .prepare(`SELECT * FROM tasks WHERE id = ?`)
      .bind(id)
      .first<Record<string, unknown>>();
    return result ? this.mapTask(result) : null;
  }

  async getTasksByProject(projectId: string): Promise<Task[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC`
      )
      .bind(projectId)
      .all<Record<string, unknown>>();
    return (results ?? []).map((r) => this.mapTask(r));
  }

  async getActiveTasksByProject(projectId: string): Promise<Task[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM tasks WHERE project_id = ? AND state NOT IN ('COMPLETED', 'FAILED', 'CANCELLED') ORDER BY created_at DESC`
      )
      .bind(projectId)
      .all<Record<string, unknown>>();
    return (results ?? []).map((r) => this.mapTask(r));
  }

  async updateTaskState(id: string, newState: Task["state"], reason: string): Promise<void> {
    const task = await this.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    const now = new Date().toISOString();

    await this.db
      .prepare(`UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?`)
      .bind(newState, now, id)
      .run();

    await this.db
      .prepare(
        `INSERT INTO task_states (id, task_id, previous_state, new_state, triggered_by, reason, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        id,
        task.state,
        newState,
        "system",
        reason,
        now
      )
      .run();
  }

  async incrementRetryCount(id: string): Promise<void> {
    await this.db
      .prepare(`UPDATE tasks SET retry_count = retry_count + 1 WHERE id = ?`)
      .bind(id)
      .run();
  }

  private mapTask(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      title: row.title as string,
      description: row.description as string,
      state: row.state as Task["state"],
      priority: row.priority as Task["priority"],
      assignedAgent: row.assigned_agent as Task["assignedAgent"],
      parentTaskId: row.parent_task_id as string | undefined,
      dependencies: JSON.parse(row.dependencies as string),
      requiredFiles: JSON.parse(row.required_files as string),
      constraints: JSON.parse(row.constraints as string),
      expectedOutput: row.expected_output as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      completedAt: row.completed_at as string | undefined,
      retryCount: row.retry_count as number,
      maxRetries: row.max_retries as number,
    };
  }

  async createAgentRun(run: Omit<AgentRun, "id">): Promise<string> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO runs (id, task_id, project_id, agent_role, model, provider, prompt_tokens, completion_tokens, total_tokens, cost_estimate, start_time, end_time, duration_ms, status, output, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        run.taskId,
        run.projectId,
        run.agentRole,
        run.model,
        run.provider,
        run.promptTokens,
        run.completionTokens,
        run.totalTokens,
        run.costEstimate,
        run.startTime,
        run.endTime ?? null,
        run.durationMs ?? null,
        run.status,
        run.output ?? null,
        run.error ?? null
      )
      .run();
    return id;
  }

  async updateAgentRun(
    id: string,
    updates: Partial<
      Pick<AgentRun, "endTime" | "durationMs" | "status" | "output" | "error">
    >
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.endTime !== undefined) {
      sets.push("end_time = ?");
      values.push(updates.endTime);
    }
    if (updates.durationMs !== undefined) {
      sets.push("duration_ms = ?");
      values.push(updates.durationMs);
    }
    if (updates.status !== undefined) {
      sets.push("status = ?");
      values.push(updates.status);
    }
    if (updates.output !== undefined) {
      sets.push("output = ?");
      values.push(updates.output);
    }
    if (updates.error !== undefined) {
      sets.push("error = ?");
      values.push(updates.error);
    }

    if (sets.length === 0) return;
    values.push(id);

    await this.db
      .prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  async createFileLock(filePath: string, taskId: string, expiresAt: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO file_locks (file_path, task_id, locked_at, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET
         task_id = excluded.task_id,
         locked_at = excluded.locked_at,
         expires_at = excluded.expires_at`
      )
      .bind(filePath, taskId, new Date().toISOString(), expiresAt)
      .run();
  }

  async releaseFileLock(filePath: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM file_locks WHERE file_path = ?`)
      .bind(filePath)
      .run();
  }

  async getFileLock(filePath: string): Promise<FileLock | null> {
    const result = await this.db
      .prepare(`SELECT * FROM file_locks WHERE file_path = ?`)
      .bind(filePath)
      .first<Record<string, unknown>>();
    return result
      ? {
          filePath: result.file_path as string,
          taskId: result.task_id as string,
          lockedAt: result.locked_at as string,
          expiresAt: result.expires_at as string,
        }
      : null;
  }

  async getLocksByTask(taskId: string): Promise<FileLock[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM file_locks WHERE task_id = ?`)
      .bind(taskId)
      .all<Record<string, unknown>>();
    return (results ?? []).map((r) => ({
      filePath: r.file_path as string,
      taskId: r.task_id as string,
      lockedAt: r.locked_at as string,
      expiresAt: r.expires_at as string,
    }));
  }

  async releaseExpiredLocks(): Promise<number> {
    const result = await this.db
      .prepare(`DELETE FROM file_locks WHERE expires_at < ?`)
      .bind(new Date().toISOString())
      .run();
    return result.meta.changes ?? 0;
  }

  async createApproval(approval: Omit<Approval, "id">): Promise<string> {
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO approvals (id, task_id, pr_number, status, requested_at, responded_at, responder_telegram_id, comment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        approval.taskId,
        approval.prNumber,
        approval.status,
        approval.requestedAt,
        approval.respondedAt ?? null,
        approval.responderTelegramId ?? null,
        approval.comment ?? null
      )
      .run();
    return id;
  }

  async updateApprovalStatus(
    taskId: string,
    status: Approval["status"],
    responderTelegramId: number,
    comment?: string
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE approvals SET status = ?, responded_at = ?, responder_telegram_id = ?, comment = ? WHERE task_id = ?`
      )
      .bind(
        status,
        new Date().toISOString(),
        responderTelegramId,
        comment ?? null,
        taskId
      )
      .run();
  }

  async getApprovalByTask(taskId: string): Promise<Approval | null> {
    const result = await this.db
      .prepare(`SELECT * FROM approvals WHERE task_id = ? ORDER BY requested_at DESC LIMIT 1`)
      .bind(taskId)
      .first<Record<string, unknown>>();
    return result
      ? {
          id: result.id as string,
          taskId: result.task_id as string,
          prNumber: result.pr_number as number,
          status: result.status as Approval["status"],
          requestedAt: result.requested_at as string,
          respondedAt: result.responded_at as string | undefined,
          responderTelegramId: result.responder_telegram_id as number | undefined,
          comment: result.comment as string | undefined,
        }
      : null;
  }

  async recordModelUsage(usage: Omit<ModelUsage, "id">): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO model_usage (id, provider, model, tokens_used, cost, success, duration_ms, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        usage.provider,
        usage.model,
        usage.tokensUsed,
        usage.cost,
        usage.success ? 1 : 0,
        usage.durationMs,
        usage.timestamp
      )
      .run();
  }

  async cleanExpiredLocks(): Promise<number> {
    const result = await this.db
      .prepare(`DELETE FROM file_locks WHERE expires_at < ?`)
      .bind(new Date().toISOString())
      .run();
    return result.meta.changes ?? 0;
  }
}
