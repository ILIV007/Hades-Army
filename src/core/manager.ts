/**
 * Hades Army — Manager Agent Core
 * The brain of the system. Coordinates all operations.
 */

import type { HadesEnv } from '../config/env';
import type {
  AgentConfig, Task, BuilderOutput, ReviewerOutput,
  TaskState, TaskInput, AgentRun
} from '../types';
import { AgentRegistryService } from '../agents/registry';
import { BuilderAgent } from '../agents/builder';
import { ReviewerAgent } from '../agents/reviewer';
import { LLMService } from '../services/llm.service';
import { PromptService } from '../services/prompt.service';
import { TaskService } from '../services/task.service';
import { GitHubService } from '../services/github.service';
import { HadesMemoryManager } from '../memory/hades.memory';
import { D1Client } from '../memory/d1.client';
import { KVClient } from '../memory/kv.client';
import { Logger } from '../utils/logger';
import { TelegramService } from '../services/telegram.service';
import { encrypt } from '../utils/crypto';
import { slugify } from '../utils/helpers';

export class ManagerAgent {
  private registry: AgentRegistryService;
  private llm: LLMService;
  private prompts: PromptService;
  private d1: D1Client;
  private kv: KVClient;
  private logger: Logger;
  private telegram: TelegramService;

  constructor(private env: HadesEnv) {
    this.registry = new AgentRegistryService(env);
    this.llm = new LLMService(env);
    this.prompts = new PromptService();
    this.d1 = new D1Client(env);
    this.kv = new KVClient(env);
    this.logger = new Logger(env);
    this.telegram = new TelegramService(env);
  }

  // ============================================================
  // USER REQUEST HANDLING
  // ============================================================

  async handleUserRequest(
    userId: number,
    chatId: number,
    message: string
  ): Promise<string> {
    await this.telegram.sendTyping(chatId);

    // Get or create user
    let user = await this.d1.getUserByTelegramId(userId);
    if (!user) {
      const userIdStr = await this.d1.createUser(userId);
      user = { id: userIdStr };
    }

    // Get active project
    const activeProjectId = await this.kv.getUserActiveProject(userId);

    if (!activeProjectId) {
      return `🧠 Welcome to Hades Army!\n\nYou don't have an active project yet.\n\nUse /newproject to get started.`;
    }

    const project = await this.d1.getProject(activeProjectId);
    if (!project) {
      return `⚠️ Active project not found. Use /projects to select one.`;
    }

    // Process the request
    await this.telegram.reportProgress(chatId, 'Analyzing', 'Understanding your request...');

    try {
      const result = await this.processRequest(project.id, message, chatId);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await this.logger.error('workflow', `Request failed: ${err}`, { userId, projectId: project.id });
      return `⚠️ Error processing request: ${err}\n\nPlease try again or contact support.`;
    }
  }

  // ============================================================
  // CORE PROCESSING LOOP
  // ============================================================

  private async processRequest(
    projectId: string,
    userRequest: string,
    chatId: number
  ): Promise<string> {
    const project = await this.d1.getProject(projectId);
    if (!project) throw new Error('Project not found');

    const taskService = new TaskService(this.env, projectId);
    const memory = new HadesMemoryManager(this.env, project);

    // Read project memory
    const hadesMemory = await memory.readMemory();
    const context = hadesMemory?.context ?? {
      recentTasks: [],
      recentDecisions: [],
      activeFiles: [],
      workingNotes: '',
    };

    // Step 1: Plan — Break down request into tasks
    await this.telegram.reportProgress(chatId, 'Planning', 'Breaking down your request...');

    const managerConfig = this.registry.getConfig('manager');
    const planResponse = await this.planTasks(managerConfig, userRequest, context);

    // Parse plan to create tasks
    const tasksToCreate = this.parseTaskPlan(planResponse);

    if (tasksToCreate.length === 0) {
      return `🧠 I understood your request but couldn't break it into actionable tasks.\n\nCould you provide more details?`;
    }

    // Create tasks
    const createdTasks: Task[] = [];
    for (const taskInput of tasksToCreate) {
      const task = await taskService.createTask(taskInput);
      createdTasks.push(task);
    }

    await this.telegram.sendTaskBreakdown(chatId, createdTasks.map(t => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
    })));

    // Execute first task (MVP: one task at a time)
    const firstTask = createdTasks[0];
    await this.executeTask(project, firstTask, chatId);

    return `✅ Task execution initiated!\n\nTask: ${firstTask.title}\nID: ${firstTask.id}\n\nI'll update you as progress continues.`;
  }

  // ============================================================
  // TASK PLANNING
  // ============================================================

  private async planTasks(
    config: AgentConfig,
    userRequest: string,
    context: { recentTasks: string[]; recentDecisions: string[]; activeFiles: string[]; workingNotes: string }
  ): Promise<string> {
    const systemPrompt = this.prompts.getSystemPrompt('manager');
    const userPrompt = this.prompts.buildManagerPlanningPrompt(userRequest, JSON.stringify(context));

    const response = await this.llm.call(config, systemPrompt, userPrompt);
    return response.content;
  }

  private parseTaskPlan(planText: string): TaskInput[] {
    const tasks: TaskInput[] = [];

    // Simple parsing: look for numbered tasks with required fields
    const taskBlocks = planText.split(/\n(?=\d+\.\s*Task:|\nTask\s*\d+:|\n-\s*Task:)/i);

    for (const block of taskBlocks) {
      const titleMatch = block.match(/(?:Task\s*\d*[:\s]*)?(.+?)(?:\n|$)/i);
      const descMatch = block.match(/Description[:\s]*(.+?)(?:\n|$)/is);
      const filesMatch = block.match(/Files[:\s]*(.+?)(?:\n|$)/is);
      const priorityMatch = block.match(/Priority[:\s]*(critical|high|medium|low)/i);

      if (titleMatch) {
        tasks.push({
          taskId: crypto.randomUUID(),
          description: descMatch?.[1]?.trim() ?? titleMatch[1].trim(),
          context: block,
          requiredFiles: filesMatch
            ? filesMatch[1].split(/[,\n]/).map(f => f.trim()).filter(Boolean)
            : [],
          constraints: ['Follow existing architecture', 'Respect file locks'],
          expectedOutput: `Implementation of: ${titleMatch[1].trim()}`,
          priority: (priorityMatch?.[1]?.toLowerCase() as TaskInput['priority']) ?? 'medium',
          dependencies: [],
        });
      }
    }

    // If no structured tasks found, create a single task
    if (tasks.length === 0 && planText.trim()) {
      tasks.push({
        taskId: crypto.randomUUID(),
        description: planText.trim(),
        context: planText,
        requiredFiles: [],
        constraints: ['Follow existing architecture'],
        expectedOutput: 'Implementation as described',
        priority: 'medium',
        dependencies: [],
      });
    }

    return tasks;
  }

  // ============================================================
  // TASK EXECUTION
  // ============================================================

  private async executeTask(project: { id: string; repoOwner: string; repoName: string; defaultBranch: string }, task: Task, chatId: number): Promise<void> {
    const taskService = new TaskService(this.env, project.id);
    const github = new GitHubService(this.env, project);
    const memory = new HadesMemoryManager(this.env, project);

    // Transition to BUILDING
    await taskService.transitionState(task.id, 'BUILDING', 'Starting build phase');
    await this.telegram.reportProgress(chatId, 'Building', `Task: ${task.title}`);

    try {
      // Run Builder
      const builderConfig = this.registry.getConfig('builder');
      const builder = new BuilderAgent(this.env, builderConfig, project.id);

      const context = await this.buildBuilderContext(project, task);
      const builderOutput = await builder.execute(task, context);

      // Transition to REVIEWING
      await taskService.transitionState(task.id, 'REVIEWING', 'Build complete, starting review');
      await this.telegram.reportProgress(chatId, 'Reviewing', 'Validating changes...');

      // Run Reviewer
      const reviewerConfig = this.registry.getConfig('reviewer');
      const reviewer = new ReviewerAgent(this.env, reviewerConfig, project.id);

      const architecture = await this.getArchitectureContext(project);
      const reviewResult = await reviewer.review(task, builderOutput, architecture);

      if (reviewResult.status === 'FAIL') {
        // Check retry
        const canRetry = await taskService.canRetry(task.id);
        if (canRetry) {
          await taskService.incrementRetry(task.id);
          await taskService.transitionState(task.id, 'BUILDING', `Review failed, retrying (${task.retryCount + 1}/${task.maxRetries})`);
          await this.telegram.reportProgress(chatId, 'Building', `Review failed. Retrying... Issues: ${reviewResult.issues.length}`);
          await this.telegram.sendMessage(chatId, `❌ Review found issues:\n${reviewResult.issues.map(i => `- ${i.severity}: ${i.message}`).join('\n')}`);
          return;
        } else {
          await taskService.transitionState(task.id, 'FAILED', 'Max retries exceeded');
          await this.telegram.sendMessage(chatId, `❌ Task failed after ${task.maxRetries} retries.\n\n${reviewResult.summary}`);
          return;
        }
      }

      // Review passed — create PR
      await taskService.transitionState(task.id, 'PR_CREATED', 'Review passed, creating PR');
      await this.telegram.reportProgress(chatId, 'Creating PR', 'Preparing pull request...');

      // Create branch
      const branchName = `feature/${task.id.slice(0, 8)}-${slugify(task.title)}`;
      await github.createBranch(branchName);

      // Apply patch
      await github.applyPatch(branchName, builderOutput.patchDiff, task.id);

      // Create PR
      const pr = await github.createPullRequest(
        `TASK-${task.id.slice(0, 8)}: ${task.title}`,
        branchName,
        project.defaultBranch,
        `## Task\n${task.description}\n\n## Changes\n${builderOutput.explanation}\n\n---\n*Automated by Hades Army*`
      );

      // Transition to WAITING_APPROVAL
      await taskService.transitionState(task.id, 'WAITING_APPROVAL', 'PR created, waiting for user approval');

      // Store approval request
      await this.d1.createApproval({
        taskId: task.id,
        prNumber: pr.number,
        status: 'PENDING',
        requestedAt: new Date().toISOString(),
      });

      // Update memory
      const hadesMemory = await memory.readMemory();
      if (hadesMemory) {
        hadesMemory.tasks.push({
          taskId: task.id,
          title: task.title,
          state: 'WAITING_APPROVAL',
          createdAt: task.createdAt,
        });
        hadesMemory.projectState.activeTaskId = task.id;
        hadesMemory.projectState.lastUpdated = new Date().toISOString();
        await memory.writeMemory({
          projectState: hadesMemory.projectState,
          tasks: hadesMemory.tasks,
        });
      }

      // Send approval request
      await this.telegram.sendApprovalRequest(chatId, pr.htmlUrl, task.id);

      await this.logger.info('workflow', `Task ${task.id} completed build cycle, PR #${pr.number} created`);

    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await taskService.transitionState(task.id, 'FAILED', `Execution error: ${err}`);
      await this.telegram.sendMessage(chatId, `❌ Task execution failed:\n${err}`);
      await this.logger.error('workflow', `Task ${task.id} failed: ${err}`);
    }
  }

  // ============================================================
  // APPROVAL HANDLING
  // ============================================================

  async handleApproval(
    userId: number,
    chatId: number,
    taskId: string,
    decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED',
    comment?: string
  ): Promise<string> {
    const task = await this.d1.getTask(taskId);
    if (!task) return `⚠️ Task not found: ${taskId}`;

    const project = await this.d1.getProject(task.projectId);
    if (!project) return `⚠️ Project not found`;

    const github = new GitHubService(this.env, project);
    const taskService = new TaskService(this.env, project.id);
    const memory = new HadesMemoryManager(this.env, project);

    // Update approval record
    await this.d1.updateApprovalStatus(taskId, decision, userId, comment);

    if (decision === 'APPROVED') {
      // Get PR number
      const approval = await this.d1.db.prepare(
        `SELECT pr_number FROM approvals WHERE task_id = ? AND status = 'APPROVED' ORDER BY responded_at DESC LIMIT 1`
      ).bind(taskId).first<{ pr_number: number }>();

      if (!approval) return `⚠️ No PR found for this task.`;

      // Merge PR
      await this.telegram.reportProgress(chatId, 'Merging', 'Merging approved changes...');
      await github.mergePullRequest(approval.pr_number, `[${taskId}] Approved and merged by user`);

      // Update task state
      await taskService.transitionState(taskId, 'MERGED', 'User approved, PR merged');
      await taskService.transitionState(taskId, 'COMPLETED', 'Task completed successfully');

      // Update memory
      const hadesMemory = await memory.readMemory();
      if (hadesMemory) {
        const taskMem = hadesMemory.tasks.find(t => t.taskId === taskId);
        if (taskMem) {
          taskMem.state = 'COMPLETED';
          taskMem.completedAt = new Date().toISOString();
        }
        hadesMemory.projectState.activeTaskId = null;
        await memory.writeMemory({
          projectState: hadesMemory.projectState,
          tasks: hadesMemory.tasks,
        });
      }

      return `✅ Task completed!\n\nChanges have been merged into ${project.defaultBranch}.`;

    } else if (decision === 'REJECTED') {
      await taskService.transitionState(taskId, 'CANCELLED', 'User rejected the changes');
      return `❌ Changes rejected. The task has been cancelled.`;

    } else {
      await taskService.transitionState(taskId, 'BUILDING', 'User requested changes');
      return `📝 Changes requested. The task will be rebuilt with your feedback.\n\nFeedback: ${comment ?? 'None provided'}`;
    }
  }

  // ============================================================
  // PROJECT MANAGEMENT
  // ============================================================

  async createProject(
    userId: number,
    name: string,
    repoUrl: string,
    githubToken: string
  ): Promise<string> {
    // Parse repo URL
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\.git)?/);
    if (!match) throw new Error('Invalid GitHub repository URL');

    const [, owner, repoName] = match;
    const cleanRepoName = repoName.replace(/\.git$/, '');

    // Encrypt token
    const encryptedToken = await encrypt(githubToken, this.env.ENCRYPTION_KEY);

    // Get or create user
    let user = await this.d1.getUserByTelegramId(userId);
    if (!user) {
      const userIdStr = await this.d1.createUser(userId);
      user = { id: userIdStr };
    }

    // Create project
    const projectId = await this.d1.createProject({
      userId: user.id,
      name,
      repoUrl,
      repoName: cleanRepoName,
      repoOwner: owner,
      defaultBranch: 'main',
      status: 'onboarding',
      githubTokenEncrypted: encryptedToken,
    });

    // Set as active
    await this.kv.setUserActiveProject(userId, projectId);

    // Initialize .hades directory
    const project = await this.d1.getProject(projectId);
    if (project) {
      const memory = new HadesMemoryManager(this.env, project);
      await memory.initializeHadesDirectory();
    }

    await this.d1.updateProjectStatus(projectId, 'active');

    await this.logger.info('project', `Created project ${projectId}`, { name, repo: repoUrl });

    return projectId;
  }

  async getUserProjects(userId: number): Promise<Array<{ id: string; name: string; status: string; repoUrl: string }>> {
    const user = await this.d1.getUserByTelegramId(userId);
    if (!user) return [];

    const projects = await this.d1.getProjectsByUser(user.id);
    return projects.map(p => ({
      id: p.id,
      name: p.name,
      status: p.status,
      repoUrl: p.repoUrl,
    }));
  }

  async setActiveProject(userId: number, projectId: string): Promise<boolean> {
    const project = await this.d1.getProject(projectId);
    if (!project) return false;

    await this.kv.setUserActiveProject(userId, projectId);
    return true;
  }

  // ============================================================
  // STATUS & REPORTING
  // ============================================================

  async getStatus(projectId: string): Promise<string> {
    const project = await this.d1.getProject(projectId);
    if (!project) return 'Project not found';

    const tasks = await this.d1.getTasksByProject(projectId);
    const active = tasks.filter(t => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(t.state));
    const completed = tasks.filter(t => t.state === 'COMPLETED');

    return `📊 *Project: ${project.name}*\n\n` +
      `Status: ${project.status}\n` +
      `Repository: ${project.repoUrl}\n\n` +
      `📋 Tasks: ${tasks.length} total\n` +
      `🔥 Active: ${active.length}\n` +
      `✅ Completed: ${completed.length}\n\n` +
      `${active.length > 0 ? `Current task: ${active[0].title} (${active[0].state})` : 'No active tasks'}`;
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private async buildBuilderContext(project: { id: string; repoOwner: string; repoName: string }, task: Task): Promise<string> {
    const github = new GitHubService(this.env, project);
    const memory = new HadesMemoryManager(this.env, project);

    // Get required files content
    const fileContents: string[] = [];
    for (const file of task.requiredFiles) {
      const content = await github.getFileContent(file);
      if (content) {
        fileContents.push(`--- ${file} ---\n${content}`);
      }
    }

    // Get architecture
    const arch = await memory.readMemory();
    const architecture = arch?.context?.workingNotes ?? 'No architecture context available';

    return `ARCHITECTURE:\n${architecture}\n\nRELEVANT FILES:\n${fileContents.join('\n\n')}`;
  }

  private async getArchitectureContext(project: { id: string }): Promise<string> {
    const memory = new HadesMemoryManager(this.env, project);
    const hadesMemory = await memory.readMemory();
    return hadesMemory?.context?.workingNotes ?? 'No architecture context';
  }
}
