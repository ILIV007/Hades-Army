/**
 * Hades Army v0.6 - Builder Agent
 * Code generation and modification with architecture awareness
 */

import type { Task, Project, RepositoryFile } from '../core/types';
import type { DBContext } from '../db';
import { getTask, updateTask } from '../db';
import { callLLM, buildBuilderSystemPrompt } from '../llm';
import { getFileContent } from '../github';
import { CONFIG } from '../core/config';

export interface BuildResult {
  success: boolean;
  files: Array<{
    path: string;
    content: string;
    action: 'create' | 'modify' | 'delete';
  }>;
  diff: string;
  summary: string;
  estimatedLinesChanged: number;
}

export async function buildTask(
  ctx: DBContext,
  taskId: number,
  env: Record<string, string>
): Promise<BuildResult> {
  const task = await getTask(ctx, taskId);

  await updateTask(ctx, taskId, {
    status: 'building',
    assignedAgent: 'builder',
  });

  try {
    // Gather file contents
    const fileContents: Array<{ path: string; content: string }> = [];
    if (task.files) {
      for (const filePath of task.files) {
        try {
          const project = await ctx.db.prepare('SELECT * FROM projects WHERE id = ?').bind(task.projectId).first();
          if (project) {
            const content = await getFileContent(
              {
                token: env.GITHUB_TOKEN || '',
                owner: project.repo_owner as string,
                repo: project.repo_name as string,
              },
              filePath
            );
            fileContents.push({ path: filePath, content });
          }
        } catch {
          // File might be new
        }
      }
    }

    // Get architecture context
    const repoFiles = await ctx.db.prepare('SELECT * FROM repo_files WHERE project_id = ?').bind(task.projectId).all();
    const files = repoFiles.results as RepositoryFile[];
    const dependencies = files
      .filter(f => task.files?.some(tf => f.path === tf))
      .map(f => f.dependencies?.join(', ') || '')
      .join('; ');

    const prompt = buildBuilderSystemPrompt({
      task: task.description || task.title,
      files: task.files || [],
      dependencies: dependencies || undefined,
    });

    const response = await callLLM({
      model: CONFIG.LLM_PROVIDERS.openrouter.defaultModel,
      messages: [
        { role: 'system', content: prompt, timestamp: new Date().toISOString() },
        { role: 'user', content: `Current files:\n${fileContents.map(f => `--- ${f.path} ---\n${f.content}`).join('\n\n')}`, timestamp: new Date().toISOString() },
      ],
    }, env as any);

    const result = parseBuildResult(response.content, task.files || []);

    await updateTask(ctx, taskId, {
      status: 'reviewing',
      diff: result.diff,
    });

    return result;
  } catch (error) {
    await updateTask(ctx, taskId, {
      status: 'failed',
    });
    throw error;
  }
}

function parseBuildResult(content: string, originalFiles: string[]): BuildResult {
  const files: BuildResult['files'] = [];

  // Parse file blocks from LLM response
  const fileRegex = /```(?:\w+)?\n?(?:\/\/ )?([\w\/\.\-]+)\n([\s\S]*?)```/g;
  let match;

  while ((match = fileRegex.exec(content)) !== null) {
    const path = match[1].trim();
    const fileContent = match[2].trim();

    const action = originalFiles.includes(path) ? 'modify' : 'create';
    files.push({ path, content: fileContent, action });
  }

  // Extract diff summary
  const diffMatch = content.match(/(?:##?\s*)?Diff[\s\S]*?(?=##?\s|$)/i);
  const diff = diffMatch ? diffMatch[0] : 'Changes applied';

  // Calculate lines changed
  const estimatedLinesChanged = files.reduce((sum, f) => {
    return sum + f.content.split('\n').length;
  }, 0);

  return {
    success: files.length > 0,
    files,
    diff,
    summary: `Modified ${files.filter(f => f.action === 'modify').length} files, created ${files.filter(f => f.action === 'create').length} files`,
    estimatedLinesChanged,
  };
}

export async function generateTests(
  ctx: DBContext,
  taskId: number,
  env: Record<string, string>
): Promise<string> {
  const task = await getTask(ctx, taskId);

  const response = await callLLM({
    model: CONFIG.LLM_PROVIDERS.openrouter.defaultModel,
    messages: [
      { role: 'system', content: 'Generate comprehensive unit tests for the following changes.', timestamp: new Date().toISOString() },
      { role: 'user', content: `Task: ${task.title}\nFiles: ${task.files?.join(', ') || 'N/A'}`, timestamp: new Date().toISOString() },
    ],
  }, env as any);

  return response.content;
}
