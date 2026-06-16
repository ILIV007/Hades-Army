/**
 * Hades Army — Orchestrator
 * High-level coordinator that wires all components together.
 */

import type { HadesEnv } from '../config/env';
import { ManagerAgent } from './manager';
import { WorkflowEngine } from './workflow';
import { TelegramService } from '../services/telegram.service';
import { Logger } from '../utils/logger';

export class Orchestrator {
  private manager: ManagerAgent;
  private telegram: TelegramService;
  private logger: Logger;

  constructor(private env: HadesEnv) {
    this.manager = new ManagerAgent(env);
    this.telegram = new TelegramService(env);
    this.logger = new Logger(env);
  }

  /**
   * Handle incoming Telegram message.
   */
  async handleTelegramMessage(userId: number, chatId: number, text: string): Promise<void> {
    await this.logger.info('orchestrator', `Message from ${userId}: ${text.slice(0, 100)}`);

    // Handle commands
    if (text.startsWith('/')) {
      await this.handleCommand(userId, chatId, text);
      return;
    }

    // Handle callback queries (inline buttons)
    if (text.startsWith('approve:') || text.startsWith('reject:') || text.startsWith('changes:')) {
      await this.handleCallback(userId, chatId, text);
      return;
    }

    // Handle natural language request
    const response = await this.manager.handleUserRequest(userId, chatId, text);
    await this.telegram.sendMessage(chatId, response);
  }

  /**
   * Handle bot commands.
   */
  private async handleCommand(userId: number, chatId: number, text: string): Promise<void> {
    const [command, ...args] = text.slice(1).split(' ');

    switch (command.toLowerCase()) {
      case 'newproject':
        await this.handleNewProject(userId, chatId, args);
        break;

      case 'projects':
        await this.handleListProjects(userId, chatId);
        break;

      case 'status':
        await this.handleStatus(userId, chatId);
        break;

      case 'tasks':
        await this.handleTasks(userId, chatId);
        break;

      case 'help':
        await this.handleHelp(chatId);
        break;

      case 'start':
        await this.handleStart(chatId);
        break;

      default:
        await this.telegram.sendMessage(chatId, `⚠️ Unknown command: /${command}\nUse /help for available commands.`);
    }
  }

  /**
   * Handle inline callback queries (approval buttons).
   */
  private async handleCallback(userId: number, chatId: number, data: string): Promise<void> {
    const [action, taskId] = data.split(':');

    if (!taskId) {
      await this.telegram.sendMessage(chatId, '⚠️ Invalid callback data');
      return;
    }

    let decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
    switch (action) {
      case 'approve':
        decision = 'APPROVED';
        break;
      case 'reject':
        decision = 'REJECTED';
        break;
      case 'changes':
        decision = 'CHANGES_REQUESTED';
        break;
      default:
        await this.telegram.sendMessage(chatId, '⚠️ Unknown action');
        return;
    }

    await this.telegram.sendTyping(chatId);
    const response = await this.manager.handleApproval(userId, chatId, taskId, decision);
    await this.telegram.sendMessage(chatId, response);
  }

  // ============================================================
  // COMMAND HANDLERS
  // ============================================================

  private async handleNewProject(userId: number, chatId: number, args: string[]): Promise<void> {
    // Expect: /newproject <name> <repo-url> <github-token>
    if (args.length < 3) {
      await this.telegram.sendMessage(chatId,
        `📋 *Create New Project*\n\n` +
        `Usage: /newproject <name> <repo-url> <github-token>\n\n` +
        `Example:\n` +
        `/newproject my-app https://github.com/user/repo ghp_xxxxxxxx`
      );
      return;
    }

    const [name, repoUrl, ...tokenParts] = args;
    const githubToken = tokenParts.join(' ');

    await this.telegram.sendTyping(chatId);
    await this.telegram.reportProgress(chatId, 'Analyzing', 'Setting up your project...');

    try {
      const projectId = await this.manager.createProject(userId, name, repoUrl, githubToken);
      await this.telegram.sendMessage(chatId,
        `✅ *Project Created!*\n\n` +
        `Name: ${name}\n` +
        `Repository: ${repoUrl}\n` +
        `Project ID: \`${projectId}\`\n\n` +
        `Your project is now active. Send me a task to get started!`,
        { parseMode: 'Markdown' }
      );
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await this.telegram.sendMessage(chatId, `❌ Failed to create project: ${err}`);
    }
  }

  private async handleListProjects(userId: number, chatId: number): Promise<void> {
    const projects = await this.manager.getUserProjects(userId);

    if (projects.length === 0) {
      await this.telegram.sendMessage(chatId, `📭 No projects found. Use /newproject to create one.`);
      return;
    }

    const lines = projects.map((p, i) =>
      `${i + 1}. *${p.name}*\n   Status: ${p.status}\n   ${p.repoUrl}`
    );

    await this.telegram.sendMessage(chatId, `📁 *Your Projects*\n\n${lines.join('\n\n')}`, {
      parseMode: 'Markdown',
    });
  }

  private async handleStatus(userId: number, chatId: number): Promise<void> {
    const activeProjectId = await new (await import('../memory/kv.client')).KVClient(this.env).getUserActiveProject(userId);

    if (!activeProjectId) {
      await this.telegram.sendMessage(chatId, `⚠️ No active project. Use /projects to select one.`);
      return;
    }

    const status = await this.manager.getStatus(activeProjectId);
    await this.telegram.sendMessage(chatId, status, { parseMode: 'Markdown' });
  }

  private async handleTasks(userId: number, chatId: number): Promise<void> {
    const { KVClient } = await import('../memory/kv.client');
    const activeProjectId = await new KVClient(this.env).getUserActiveProject(userId);

    if (!activeProjectId) {
      await this.telegram.sendMessage(chatId, `⚠️ No active project.`);
      return;
    }

    const { D1Client } = await import('../memory/d1.client');
    const d1 = new D1Client(this.env);
    const tasks = await d1.getTasksByProject(activeProjectId);

    if (tasks.length === 0) {
      await this.telegram.sendMessage(chatId, `📭 No tasks yet. Send a request to create one!`);
      return;
    }

    const lines = tasks.slice(0, 10).map((t, i) =>
      `${i + 1}. *${t.title}* — \`${t.state}\` (${t.priority})`
    );

    await this.telegram.sendMessage(chatId, `📋 *Tasks*\n\n${lines.join('\n')}`, {
      parseMode: 'Markdown',
    });
  }

  private async handleHelp(chatId: number): Promise<void> {
    await this.telegram.sendMessage(chatId,
      `⚔️ *Hades Army — Commands*\n\n` +
      `/start — Welcome message\n` +
      `/newproject <name> <repo> <token> — Create project\n` +
      `/projects — List your projects\n` +
      `/status — Active project status\n` +
      `/tasks — List active tasks\n` +
      `/help — Show this message\n\n` +
      `*Natural Language:*\n` +
      `Just type what you want to build!\n` +
      `Example: "Build a login page with JWT auth"`,
      { parseMode: 'Markdown' }
    );
  }

  private async handleStart(chatId: number): Promise<void> {
    await this.telegram.sendMessage(chatId,
      `⚔️ *Welcome to Hades Army* ⚔️\n\n` +
      `Your AI software development team.\n\n` +
      `I can:\n` +
      `• Analyze your repositories\n` +
      `• Plan and implement features\n` +
      `• Review code automatically\n` +
      `• Create Pull Requests\n\n` +
      `Get started with /newproject or type what you want to build!`,
      { parseMode: 'Markdown' }
    );
  }
}
