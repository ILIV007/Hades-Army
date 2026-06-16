/**
 * Hades Army — Reviewer Agent
 * Validates Builder output. PASS or FAIL.
 */

import type { HadesEnv } from '../config/env';
import type { AgentConfig, ReviewerOutput, Task, BuilderOutput } from '../types';
import { LLMService } from '../services/llm.service';
import { PromptService } from '../services/prompt.service';
import { Logger } from '../utils/logger';

export class ReviewerAgent {
  private llm: LLMService;
  private prompts: PromptService;
  private logger: Logger;

  constructor(
    private env: HadesEnv,
    private config: AgentConfig,
    private projectId: string
  ) {
    this.llm = new LLMService(env, projectId);
    this.prompts = new PromptService();
    this.logger = new Logger(env, projectId);
  }

  /**
   * Review a Builder output.
   */
  async review(task: Task, builderOutput: BuilderOutput, architecture: string): Promise<ReviewerOutput> {
    const startTime = Date.now();
    const runId = crypto.randomUUID();

    await this.logger.info('agent', `Reviewer starting review for task ${task.id}`, { model: this.config.model });

    try {
      const systemPrompt = this.prompts.getSystemPrompt('reviewer');
      const userPrompt = this.prompts.buildReviewerPrompt(
        builderOutput.patchDiff,
        task.description,
        architecture
      );

      const response = await this.llm.call(this.config, systemPrompt, userPrompt);

      const status = this.parseStatus(response.content);
      const issues = this.parseIssues(response.content);
      const summary = this.parseSummary(response.content);

      const duration = Date.now() - startTime;
      await this.logger.info('agent', `Reviewer completed: ${status}`, {
        taskId: task.id,
        durationMs: duration,
        issues: issues.length,
        tokens: response.totalTokens,
      });

      return {
        status,
        issues,
        summary,
        taskId: task.id,
        runId,
      };
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await this.logger.error('agent', `Reviewer failed for task ${task.id}: ${err}`);
      throw error;
    }
  }

  private parseStatus(content: string): 'PASS' | 'FAIL' {
    const match = content.match(/STATUS:\s*(PASS|FAIL)/i);
    return match?.[1]?.toUpperCase() === 'PASS' ? 'PASS' : 'FAIL';
  }

  private parseIssues(content: string): Array<{ file: string; line?: number; severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; message: string; suggestion?: string }> {
    const issues: Array<{ file: string; line?: number; severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; message: string; suggestion?: string }> = [];
    const issueRegex = /\d+\.\s*\[SEVERITY:\s*(critical|high|medium|low|info)\]\s*(.+?)(?:Suggestion:\s*(.+?))?(?=\d+\.\s*\[|$)/gis;

    let match;
    while ((match = issueRegex.exec(content)) !== null) {
      const severity = match[1].toLowerCase() as 'critical' | 'high' | 'medium' | 'low' | 'info';
      const detail = match[2].trim();
      const suggestion = match[3]?.trim();

      // Parse file:line from detail
      const fileMatch = detail.match(/^(.+?)(?::(\d+))?\s*—\s*(.+)$/);
      if (fileMatch) {
        issues.push({
          file: fileMatch[1].trim(),
          line: fileMatch[2] ? parseInt(fileMatch[2], 10) : undefined,
          severity,
          message: fileMatch[3].trim(),
          suggestion,
        });
      } else {
        issues.push({
          file: 'unknown',
          severity,
          message: detail,
          suggestion,
        });
      }
    }

    return issues;
  }

  private parseSummary(content: string): string {
    const match = content.match(/SUMMARY:\s*(.+?)(?=\n|$)/is);
    return match?.[1]?.trim() ?? 'No summary provided';
  }
}
