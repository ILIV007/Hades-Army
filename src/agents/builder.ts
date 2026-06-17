/**
 * Hades Army v0.2.1 — Builder Agent
 * ⚔️ NO HARDCODED MODELS — reads from Registry ⚔️
 */

import type { HadesEnv } from "../config/env";
import type { AgentConfig, BuilderOutput, Task } from "../types";
import { LLMService } from "../services/llm.service";
import { PromptService } from "../services/prompt.service";
import { Logger } from "../utils/logger";
import { isValidPatch, extractAffectedFiles, containsDangerousFiles } from "../utils/helpers";

export class BuilderAgent {
  private config: AgentConfig;
  private llm: LLMService;
  private prompts: PromptService;
  private logger: Logger;

  constructor(env: HadesEnv, config: AgentConfig, projectId: string) {
    this.config = config;
    this.llm = new LLMService(env, projectId);
    this.prompts = new PromptService();
    this.logger = new Logger(env, projectId);
  }

  async execute(task: Task, context: string): Promise<BuilderOutput> {
    const startTime = Date.now();
    await this.logger.info("agent", `Builder starting ${task.id}`, { model: task.assignedAgent });

    const systemPrompt = this.prompts.getSystemPrompt("builder");
    const userPrompt = this.prompts.buildBuilderPrompt(task.description, context, task.requiredFiles);

    const response = await this.llm.call(
      this.config,
      systemPrompt,
      userPrompt
    );

    const patchDiff = this.extractDiff(response.content);

    // Validate patch format
    if (!isValidPatch(patchDiff)) {
      throw new Error("Builder produced invalid patch format");
    }

    // FIX MEDIUM #2: Check for dangerous files
    const dangerCheck = containsDangerousFiles(patchDiff);
    if (!dangerCheck.safe) {
      await this.logger.error("security", `Dangerous files detected in patch`, {
        files: dangerCheck.dangerousFiles,
        taskId: task.id,
      });
      throw new Error(
        `Patch contains dangerous files: ${dangerCheck.dangerousFiles.join(", ")}. ` +
        `These files are protected and cannot be modified by Builder.`
      );
    }

    const affectedFiles = extractAffectedFiles(patchDiff);
    const duration = Date.now() - startTime;

    await this.logger.info("agent", `Builder completed ${task.id}`, {
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
  }

  private extractDiff(content: string): string {
    const match = content.match(/```diff([\s\S]*?)```/);
    return match ? match[1].trim() : content.trim();
  }

  private extractExplanation(content: string): string {
    const match = content.match(/EXPLANATION:\s*(.+?)(?:\n|$)/i);
    return match?.[1]?.trim() ?? "No explanation provided";
  }
}
