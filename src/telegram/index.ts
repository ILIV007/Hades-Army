/**
 * Hades Army v0.6 - Telegram Interface
 * Bot integration for project management
 */

import type { Project, Task } from '../core/types';
import type { DBContext } from '../db';
import { listProjects, getProject, listTasks, getTask } from '../db';

const TELEGRAM_API = 'https://api.telegram.org/bot';

interface TelegramContext {
  token: string;
  db: DBContext;
}

export async function handleTelegramUpdate(
  update: Record<string, unknown>,
  env: Record<string, string>
): Promise<void> {
  const message = update.message as Record<string, unknown> | undefined;
  if (!message || !message.text) return;

  const chatId = (message.chat as Record<string, unknown>).id as number;
  const text = message.text as string;
  const from = message.from as Record<string, unknown>;

  const ctx: TelegramContext = {
    token: env.TELEGRAM_BOT_TOKEN || '',
    db: { db: null as any, kvCache: null as any, kvProjects: null as any },
  };

  // Simple command router
  if (text.startsWith('/start')) {
    await sendMessage(ctx, chatId, `
🏛️ *Hades Army v0.6*

Your AI Software Engineering Team is ready.

*Commands:*
/projects - List all projects
/status - System health status
/new - Start new project
/help - Show all commands
    `);
  } else if (text.startsWith('/projects')) {
    await handleProjectsCommand(ctx, chatId);
  } else if (text.startsWith('/status')) {
    await handleStatusCommand(ctx, chatId, env);
  } else if (text.startsWith('/new')) {
    await sendMessage(ctx, chatId, 'To create a new project, visit the dashboard or use the web interface.');
  } else if (text.startsWith('/help')) {
    await sendMessage(ctx, chatId, `
*Hades Army Commands:*

/start - Welcome message
/projects - List projects
/status - System health
/new - New project (web)
/task <id> - View task details
/approve <id> - Approve task
/reject <id> - Reject task
    `);
  } else if (text.startsWith('/task ')) {
    const taskId = parseInt(text.split(' ')[1]);
    await handleTaskCommand(ctx, chatId, taskId);
  } else {
    await sendMessage(ctx, chatId, 'I did not understand that command. Use /help for available commands.');
  }
}

async function handleProjectsCommand(ctx: TelegramContext, chatId: number): Promise<void> {
  try {
    const projects = await listProjects(ctx.db, 1, 10);

    if (projects.items.length === 0) {
      await sendMessage(ctx, chatId, '📂 No projects found. Use /new to create one.');
      return;
    }

    let message = '📂 *Projects:*\n\n';
    for (const project of projects.items) {
      const statusEmoji = getStatusEmoji(project.status);
      message += `${statusEmoji} *${project.name}*\n`;
      message += `   Status: ${project.status}\n`;
      message += `   Health: ${project.healthScore}%\n\n`;
    }

    await sendMessage(ctx, chatId, message);
  } catch (error) {
    await sendMessage(ctx, chatId, '❌ Error fetching projects.');
  }
}

async function handleStatusCommand(ctx: TelegramContext, chatId: number, env: Record<string, string>): Promise<void> {
  const status = `
🏛️ *Hades Army System Status*

*Providers:*
${env.GITHUB_TOKEN ? '✅' : '❌'} GitHub
${env.OPENROUTER_API_KEY ? '✅' : '❌'} OpenRouter
${env.GOOGLE_AI_API_KEY ? '✅' : '❌'} Google AI
${env.TELEGRAM_BOT_TOKEN ? '✅' : '❌'} Telegram

*Version:* v0.6.0 Ultimate
*Status:* Operational
  `;
  await sendMessage(ctx, chatId, status);
}

async function handleTaskCommand(ctx: TelegramContext, chatId: number, taskId: number): Promise<void> {
  try {
    const task = await getTask(ctx.db, taskId);
    const statusEmoji = getTaskStatusEmoji(task.status);

    const message = `
${statusEmoji} *Task #${task.id}: ${task.title}*

*Status:* ${task.status}
*Priority:* ${task.priority}
*Risk:* ${task.riskLevel}
*Agent:* ${task.assignedAgent || 'Unassigned'}

${task.description || 'No description'}
    `;

    await sendMessage(ctx, chatId, message);
  } catch {
    await sendMessage(ctx, chatId, '❌ Task not found.');
  }
}

async function sendMessage(ctx: TelegramContext, chatId: number, text: string): Promise<void> {
  await fetch(`${TELEGRAM_API}${ctx.token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  });
}

function getStatusEmoji(status: string): string {
  const map: Record<string, string> = {
    active: '🟢',
    pending: '🟡',
    interviewing: '🔵',
    analyzing: '🟣',
    paused: '⏸️',
    archived: '⚪',
  };
  return map[status] || '⚪';
}

function getTaskStatusEmoji(status: string): string {
  const map: Record<string, string> = {
    pending: '⏳',
    planning: '📋',
    building: '🔨',
    reviewing: '👀',
    approved: '✅',
    merged: '🎉',
    failed: '❌',
    rolled_back: '↩️',
  };
  return map[status] || '❓';
}

export async function sendNotification(
  ctx: TelegramContext,
  chatId: number,
  type: 'task_complete' | 'review_needed' | 'failure' | 'approval_needed',
  data: Record<string, unknown>
): Promise<void> {
  let message = '';

  switch (type) {
    case 'task_complete':
      message = `✅ *Task Complete*\n\nTask "${data.title}" has been completed.\nView: /task ${data.taskId}`;
      break;
    case 'review_needed':
      message = `👀 *Review Required*\n\nTask "${data.title}" needs review.\nView: /task ${data.taskId}`;
      break;
    case 'failure':
      message = `❌ *Task Failed*\n\nTask "${data.title}" failed.\nReason: ${data.reason}\nView: /task ${data.taskId}`;
      break;
    case 'approval_needed':
      message = `📝 *Approval Required*\n\nTask "${data.title}" is ready for approval.\nApprove: /approve ${data.taskId}\nReject: /reject ${data.taskId}`;
      break;
  }

  await sendMessage(ctx, chatId, message);
}
