/**
 * Hades Army v0.2 — Orchestrator
 * High-level coordinator wiring all components together.
 * Pure ESM.
 */

import type { HadesEnv } from "../config/env";
import { ProjectManager } from "./managers/project.manager";
import { TaskPlanner } from "./managers/task.planner";
import { ExecutionCoordinator } from "./managers/execution.coordinator";
import { ApprovalHandler } from "./managers/approval.handler";
import { TelegramService } from "../services/telegram.service";
import { Logger } from "../utils/logger";
import { D1Client } from "../memory/d1.client";
import { KVClient } from "../memory/kv.client";

export class Orchestrator {
  private projectManager: ProjectManager;
  private taskPlanner: TaskPlanner;
  private executionCoordinator: ExecutionCoordinator;
  private approvalHandler: ApprovalHandler;
  private telegram: TelegramService;
  private logger: Logger;
  private d1: D1Client;
  private kv: KVClient;

  constructor(private env: HadesEnv) {
    this.projectManager = new ProjectManager(env);
    this.taskPlanner = new TaskPlanner(env);
    this.executionCoordinator = new ExecutionCoordinator(env);
    this.approvalHandler = new ApprovalHandler(env);
    this.telegram = new TelegramService(env);
    this.logger = new Logger(env);
    this.d1 = new D1Client(env);
    this.kv = new KVClient(env);
  }

  async handleTelegramMessage(userId: number, chatId: number, text: string): Promise<void> {
    await this.logger.info("orchestrator", `Message from ${userId}: ${text.slice(0, 100)}`);

    if (text.startsWith("/")) {
      await this.handleCommand(userId, chatId, text);
      return;
    }

    if (text.startsWith("approve:") || text.startsWith("reject:") || text.startsWith("changes:")) {
      await this.handleCallback(userId, chatId, text);
      return;
    }

    await this.handleNaturalLanguage(userId, chatId, text);
  }

  private async handleCommand(userId: number, chatId: number, text: string): Promise<void> {
    const [command, ...args] = text.slice(1).split(" ");

    switch (command.toLowerCase()) {
      case "newproject":
        await this.cmdNewProject(userId, chatId, args);
        break;
      case "projects":
        await this.cmdProjects(userId, chatId);
        break;
      case "status":
        await this.cmdStatus(userId, chatId);
        break;
      case "tasks":
        await this.cmdTasks(userId, chatId);
        break;
      case "help":
        await this.cmdHelp(chatId);
        break;
      case "start":
        await this.cmdStart(chatId);
        break;
      default:
        await this.telegram.sendMessage(chatId, `⚠️ Unknown: /${command}\nUse /help`);
    }
  }

  private async handleCallback(userId: number, chatId: number, data: string): Promise<void> {
    const [action, taskId] = data.split(":");
    if (!taskId) { await this.telegram.sendMessage(chatId, "⚠️ Invalid"); return; }

    let decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
    if (action === "approve") decision = "APPROVED";
    else if (action === "reject") decision = "REJECTED";
    else if (action === "changes") decision = "CHANGES_REQUESTED";
    else { await this.telegram.sendMessage(chatId, "⚠️ Unknown"); return; }

    await this.telegram.sendTyping(chatId);
    const response = await this.approvalHandler.handleApproval(userId, chatId, taskId, decision);
    await this.telegram.sendMessage(chatId, response);
  }

  private async handleNaturalLanguage(userId: number, chatId: number, text: string): Promise<void> {
    await this.telegram.sendTyping(chatId);

    let user = await this.d1.getUserByTelegramId(userId);
    if (!user) {
      const userIdStr = await this.d1.createUser(userId);
      user = { id: userIdStr };
    }

    const activeProjectId = await this.kv.getUserActiveProject(userId);
    if (!activeProjectId) {
      await this.telegram.sendMessage(chatId, "🧠 Welcome! Use /newproject to start.");
      return;
    }

    const project = await this.d1.getProject(activeProjectId);
    if (!project) {
      await this.telegram.sendMessage(chatId, "⚠️ Active project not found.");
      return;
    }

    await this.telegram.reportProgress(chatId, "Analyzing", "Understanding your request...");

    try {
      await this.telegram.reportProgress(chatId, "Planning", "Breaking down request...");
      const context = await this.getProjectContext(project.id);
      const tasksToCreate = await this.taskPlanner.plan(text, context);

      if (tasksToCreate.length === 0) {
        await this.telegram.sendMessage(chatId, "🧠 Couldn't break into tasks. More details?");
        return;
      }

      const createdTasks = [];
      for (const input of tasksToCreate) {
        const task = await this.d1.createTask({
          projectId: project.id,
          title: input.description.slice(0, 100),
          description: input.description,
          state: "CREATED",
          priority: input.priority,
          assignedAgent: null,
          dependencies: input.dependencies,
          requiredFiles: input.requiredFiles,
          constraints: input.constraints,
          expectedOutput: input.expectedOutput,
          maxRetries: 3,
        });
        const taskObj = await this.d1.getTask(task);
        if (taskObj) createdTasks.push(taskObj);
      }

      await this.telegram.sendTaskBreakdown(chatId, createdTasks.map(t => ({ id: t.id, title: t.title, priority: t.priority })));

      if (createdTasks.length > 0) {
        await this.executionCoordinator.executeTask(project, createdTasks[0], chatId);
      }

    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await this.logger.error("orchestrator", `Request failed: ${err}`, { userId, projectId: project.id });
      await this.telegram.sendMessage(chatId, `⚠️ Error: ${err}`);
    }
  }

  private async cmdNewProject(userId: number, chatId: number, args: string[]): Promise<void> {
    if (args.length < 3) {
      await this.telegram.sendMessage(chatId, "📋 Usage: /newproject <name> <repo_url> <github_token>");
      return;
    }
    const [name, repoUrl, ...tokenParts] = args;
    const token = tokenParts.join(" ");

    await this.telegram.sendTyping(chatId);
    await this.telegram.reportProgress(chatId, "Analyzing", "Setting up project...");

    try {
      const projectId = await this.projectManager.createProject(userId, name, repoUrl, token);
      await this.telegram.sendMessage(chatId, `✅ *Project Created!*\n\nName: ${name}\nRepo: ${repoUrl}\nID: \`${projectId}\`\n\nSend a task to start!`, { parseMode: "Markdown" });
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await this.telegram.sendMessage(chatId, `❌ Failed: ${err}`);
    }
  }

  private async cmdProjects(userId: number, chatId: number): Promise<void> {
    const projects = await this.projectManager.getUserProjects(userId);
    if (projects.length === 0) {
      await this.telegram.sendMessage(chatId, "📭 No projects. Use /newproject.");
      return;
    }
    const lines = projects.map((p, i) => `${i + 1}. *${p.name}*\n   ${p.status} — ${p.repoUrl}`);
    await this.telegram.sendMessage(chatId, `📁 *Your Projects*\n\n${lines.join("\n\n")}`, { parseMode: "Markdown" });
  }

  private async cmdStatus(userId: number, chatId: number): Promise<void> {
    const activeId = await this.projectManager.getActiveProjectId(userId);
    if (!activeId) {
      await this.telegram.sendMessage(chatId, "⚠️ No active project.");
      return;
    }
    const status = await this.projectManager.getStatus(activeId);
    await this.telegram.sendMessage(chatId, status, { parseMode: "Markdown" });
  }

  private async cmdTasks(userId: number, chatId: number): Promise<void> {
    const activeId = await this.projectManager.getActiveProjectId(userId);
    if (!activeId) { await this.telegram.sendMessage(chatId, "⚠️ No active project."); return; }

    const tasks = await this.d1.getTasksByProject(activeId);
    if (tasks.length === 0) { await this.telegram.sendMessage(chatId, "📭 No tasks yet."); return; }

    const lines = tasks.slice(0, 10).map((t, i) => `${i + 1}. *${t.title}* — \`${t.state}\` (${t.priority})`);
    await this.telegram.sendMessage(chatId, `📋 *Tasks*\n\n${lines.join("\n")}`, { parseMode: "Markdown" });
  }

  private async cmdHelp(chatId: number): Promise<void> {
    await this.telegram.sendMessage(chatId,
      `⚔️ *Hades Army*\n\n/newproject <name> <repo> <token>\n/projects — List projects\n/status — Active status\n/tasks — List tasks\n/help — This message\n\n*Natural Language:*\nJust type what to build!`,
      { parseMode: "Markdown" }
    );
  }

  private async cmdStart(chatId: number): Promise<void> {
    await this.telegram.sendMessage(chatId,
      `⚔️ *Welcome to Hades Army* ⚔️\n\nYour AI dev team.\n\n• Analyze repos\n• Plan & implement\n• Review & PR\n\nStart with /newproject or type a request!`,
      { parseMode: "Markdown" }
    );
  }

  private async getProjectContext(projectId: string): Promise<string> {
    const tasks = await this.d1.getTasksByProject(projectId);
    const recent = tasks.slice(0, 5).map(t => `- ${t.title} (${t.state})`).join("\n");
    return `Recent tasks:\n${recent}`;
  }
}
