/**
 * Hades Army — Builder Agent
 * Implements code changes. Generates patches only.
 */

import type { HadesEnv } from '../config/env';
import type { AgentConfig, BuilderOutput, Task } from '../types';
import { LLMService } from '../services/llm.service';
import { PromptService } from '../services/prompt.service';
import { Logger } from '../utils/logger';
import { isValidPatch, extractAffectedFiles } from '../utils/helpers';

export class BuilderAgent {
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
   * Execute a build task.
   */
  async execute(task: Task, context: string): Promise<BuilderOutput> {
    const startTime = Date.now();
    await this.logger.info('agent', `Builder starting task ${task.id}`, { model: this.config.model });

    try {
      const systemPrompt = this.prompts.getSystemPrompt('builder');
      const userPrompt = this.prompts.buildBuilderPrompt(
        task.description,
        context,
        task.requiredFiles
      );

      const response = await this.llm.call(this.config, systemPrompt, userPrompt);

      // Extract diff from response
      const patchDiff = this.extractDiff(response.content);

      if (!isValidPatch(patchDiff)) {
        throw new Error('Builder produced invalid patch format');
      }

      const affectedFiles = extractAffectedFiles(patchDiff);

      const duration = Date.now() - startTime;
      await this.logger.info('agent', `Builder completed task ${task.id}`, {
        durationMs: duration,
        files: affectedFiles.length,
        tokens: response.totalTokens,
      });

      return {
        patchDiff,
        explanation: this.extractExplanation(response.content),
        affectedFiles,
        taskId: task.id,
      };
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      await this.logger.error('agent', `Builder failed task ${task.id}: ${err}`);
      throw error;
    }
  }

  /**
   * Extract diff block from LLM response.
   */
  private extractDiff(content: string): string {
    const diffMatch = content.match(/```diff([\s\S]*?)```/);
    if (diffMatch) {
      return diffMatch[1].trim();
    }
    // Try without language specifier
    const genericMatch = content.match(/```([\s\S]*?)```/);
    if (genericMatch) {
      return genericMatch[1].trim();
    }
    // Return raw if no code blocks found (may be raw diff)
    return content.trim();
  }

  /**
   * Extract explanation text from response.
   */
  private extractExplanation(content: string): string {
    const explanationMatch = content.match(/EXPLANATION:\s*(.+?)(?:\n|$)/i);
    return explanationMatch?.[1]?.trim() ?? 'No explanation provided';
  }
}
