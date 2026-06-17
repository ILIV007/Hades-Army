/**
 * Hades Army v0.2 — Execution Coordinator
 * Orchestrates: Builder → Reviewer → GitHub PR with live progress.
 * Pure ESM.
 */

import type { HadesEnv } from "../../config/env";
import type { Project, Task } from "../../types";
import { AgentRegistryService } from "../../agents/registry";
import { BuilderAgent } from "../../agents/builder";
import { ReviewerAgent } from "../../agents/reviewer";
import { GitHubService } from "../../services/github.service";
import { TaskService } from "../../services/task.service";
import { TelegramService } from "../../services/telegram.service";
import { HadesMemoryManager } from "../../memory/hades.memory";
import { GitHubRepoClient } from "../../github/clients/repo.client";
import { Logger } from "../../utils/logger";
import { WorkflowEngine } from "../workflow";

export class ExecutionCoordinator {
  private registry: AgentRegistryService;
  private telegram: TelegramService;
  private logger: Logger;

  constructor(private env: HadesEnv) {
    this.registry = new AgentRegistryService(env);
    this.telegram = new TelegramService(env);
    this.logger = new Logger(env);
  }

  async executeTask(project: Project, task: Task, chatId: number): Promise<void> {
    const taskService = new TaskService(this.env, project.id);
    const github = new GitHubService(this.env, project);
    const memory = new HadesMemoryManager(this.env, project);
    const workflow = new WorkflowEngine(this.env, project.id);

    await workflow.initializeWorkflow(task.id);
    await workflow.transition(task.id, "BUILDING", "Starting build phase");
    await this.telegram.reportProgress(chatId, "Building", `Task: ${task.title}`);

    try {
      // Lock files
      if (task.requiredFiles.length > 0) {
        const { locked } = await taskService.checkFileLocks(task.requiredFiles, task.id);
        if (locked.length > 0) {
          await workflow.transition(task.id, "BLOCKED", `Files locked: ${locked.join(", ")}`);
          await this.telegram.sendMessage(chatId, `⚠️ Task blocked — files locked by other tasks:\n${locked.join("\n")}`);
          return;
        }
        await taskService.lockFiles(task.id, task.requiredFiles);
      }

      // Build
      const builderConfig = this.registry.getConfig("builder");
      const builder = new BuilderAgent(this.env, builderConfig, project.id);
      const context = await this.buildContext(project, task);
      const builderOutput = await builder.execute(task, context);

      // Review
      await workflow.transition(task.id, "REVIEWING", "Build complete");
      await this.telegram.reportProgress(chatId, "Reviewing", "Validating changes...");

      const reviewerConfig = this.registry.getConfig("reviewer");
      const reviewer = new ReviewerAgent(this.env, reviewerConfig, project.id);
      const architecture = await this.getArchitecture(project);
      const reviewResult = await reviewer.review(task, builderOutput, architecture);

      await this.telegram.sendReviewResults(chatId, reviewResult.status, reviewResult.issues, reviewResult.summary);

      if (reviewResult.status === "FAIL") {
        const canRetry = await taskService.canRetry(task.id);
        if (canRetry) {
          await taskService.incrementRetry(task.id);
          await workflow.transition(task.id, "BUILDING", `Review failed, retry ${task.retryCount + 1}/${task.maxRetries}`);
          await this.telegram.reportProgress(chatId, "Retrying", `Issues found: ${reviewResult.issues.length}`);
          return;
        } else {
          await workflow.transition(task.id, "FAILED", "Max retries exceeded");
          await taskService.unlockTaskFiles(task.id);
          return;
        }
      }

      // Create PR
      await workflow.transition(task.id, "PR_CREATED", "Review passed");
      await this.telegram.reportProgress(chatId, "Creating PR", "Preparing pull request...");

      const pr = await github.createPatchPR(task.id, task.title, builderOutput.patchDiff, task.description);

      // Wait for approval
      await workflow.transition(task.id, "WAITING_APPROVAL", "PR created");
      await this.telegram.sendApprovalRequest(chatId, pr.htmlUrl, task.id);

      // Update memory
      const hadesMemory = await memory.readMemory();
      if (hadesMemory) {
        hadesMemory.tasks.push({ taskId: task.id, title: task.title, state: "WAITING_APPROVAL", createdAt: task.createdAt });
        hadesMemory.projectState.activeTaskId = task.id;
        hadesMemory.projectState.lastUpdated = new Date().toISOString();
        await memory.writeMemory({ projectState: hadesMemory.projectState, tasks: hadesMemory.tasks });
      }

      await this.logger.info("workflow", `Task ${task.id} cycle complete, PR #${pr.number}`);

    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await workflow.transition(task.id, "FAILED", `Error: ${err}`);
      await taskService.unlockTaskFiles(task.id);
      await this.telegram.sendMessage(chatId, `❌ Task failed: ${err}`);
      await this.logger.error("workflow", `Task ${task.id} failed: ${err}`);
    }
  }

  private async buildContext(project: Project, task: Task): Promise<string> {
    const repo = new GitHubRepoClient(this.env, project);
    const memory = new HadesMemoryManager(this.env, project);

    const fileContents: string[] = [];
    for (const file of task.requiredFiles) {
      const content = await repo.getFileContent(file);
      if (content) fileContents.push(`--- ${file} ---\n${content}`);
    }

    const arch = await memory.readMemory();
    const architecture = arch?.context?.workingNotes ?? "No architecture context";

    return `ARCHITECTURE:\n${architecture}\n\nFILES:\n${fileContents.join("\n\n")}`;
  }

  private async getArchitecture(project: Project): Promise<string> {
    const memory = new HadesMemoryManager(this.env, project);
    const hadesMemory = await memory.readMemory();
    return hadesMemory?.context?.workingNotes ?? "No architecture context";
  }
}
