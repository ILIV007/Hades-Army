/**
 * Hades Army v0.2 — Approval Handler
 * Handles user approval decisions: Approve / Reject / Changes Requested.
 * Pure ESM.
 */

import type { HadesEnv } from "../../config/env";
import { D1Client } from "../../memory/d1.client";
import { TaskService } from "../../services/task.service";
import { GitHubService } from "../../services/github.service";
import { HadesMemoryManager } from "../../memory/hades.memory";
import { TelegramService } from "../../services/telegram.service";
import { WorkflowEngine } from "../workflow";
import { Logger } from "../../utils/logger";

export class ApprovalHandler {
  private d1: D1Client;
  private telegram: TelegramService;
  private logger: Logger;

  constructor(private env: HadesEnv) {
    this.d1 = new D1Client(env);
    this.telegram = new TelegramService(env);
    this.logger = new Logger(env);
  }

  async handleApproval(
    userId: number,
    chatId: number,
    taskId: string,
    decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED",
    comment?: string
  ): Promise<string> {
    const task = await this.d1.getTask(taskId);
    if (!task) return `⚠️ Task not found: ${taskId}`;

    const project = await this.d1.getProject(task.projectId);
    if (!project) return `⚠️ Project not found`;

    const taskService = new TaskService(this.env, project.id);
    const github = new GitHubService(this.env, project);
    const memory = new HadesMemoryManager(this.env, project);
    const workflow = new WorkflowEngine(this.env, project.id);

    await this.d1.updateApprovalStatus(taskId, decision, userId, comment);

    if (decision === "APPROVED") {
      const approval = await this.d1.getApprovalByTask(taskId);
      if (!approval) return `⚠️ No PR found`;

      await this.telegram.reportProgress(chatId, "Merging", "Merging approved changes...");
      await github.pr.merge(approval.prNumber, `[${taskId}] Approved by user`);

      await workflow.transition(taskId, "MERGED", "User approved");
      await workflow.transition(taskId, "COMPLETED", "Task done");
      await taskService.unlockTaskFiles(taskId);

      const hadesMemory = await memory.readMemory();
      if (hadesMemory) {
        const tm = hadesMemory.tasks.find(t => t.taskId === taskId);
        if (tm) { tm.state = "COMPLETED"; tm.completedAt = new Date().toISOString(); }
        hadesMemory.projectState.activeTaskId = null;
        await memory.writeMemory({ projectState: hadesMemory.projectState, tasks: hadesMemory.tasks });
      }

      return `✅ Task completed! Changes merged into ${project.defaultBranch}.`;

    } else if (decision === "REJECTED") {
      await workflow.transition(taskId, "CANCELLED", "User rejected");
      await taskService.unlockTaskFiles(taskId);
      return `❌ Changes rejected. Task cancelled.`;

    } else {
      await workflow.transition(taskId, "BUILDING", "User requested changes");
      await taskService.unlockTaskFiles(taskId);
      return `📝 Changes requested. Task will be rebuilt.\n\nFeedback: ${comment ?? "None"}`;
    }
  }
}
