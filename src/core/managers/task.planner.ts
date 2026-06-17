/**
 * Hades Army v0.2 — Task Planner
 * Breaks down user requests into atomic tasks using LLM.
 * Pure ESM.
 */

import type { HadesEnv } from "../../config/env";
import type { TaskInput, TaskPriority } from "../../types";
import { LLMService } from "../../services/llm.service";
import { PromptService } from "../../services/prompt.service";
import { Logger } from "../../utils/logger";

export class TaskPlanner {
  private llm: LLMService;
  private prompts: PromptService;
  private logger: Logger;

  constructor(env: HadesEnv) {
    this.llm = new LLMService(env);
    this.prompts = new PromptService();
    this.logger = new Logger(env);
  }

  async plan(userRequest: string, projectContext: string): Promise<TaskInput[]> {
    await this.logger.info("workflow", "Planning tasks", { request: userRequest.slice(0, 100) });

    const systemPrompt = this.prompts.getSystemPrompt("manager");
    const userPrompt = this.prompts.buildManagerPlanningPrompt(userRequest, projectContext);

    const response = await this.llm.call(
      { role: "manager", model: "google/gemini-3-flash", provider: "openrouter", temperature: 0.3, maxTokens: 8192, capabilities: [], restrictions: [] },
      systemPrompt,
      userPrompt
    );

    return this.parsePlan(response.content);
  }

  private parsePlan(planText: string): TaskInput[] {
    const tasks: TaskInput[] = [];
    const blocks = planText.split(/\n(?=\d+\.\s*Task:|\nTask\s*\d+:|\n-\s*Task:)/i);

    for (const block of blocks) {
      const titleMatch = block.match(/(?:Task\s*\d*[:\s]*)?(.+?)(?:\n|$)/i);
      const descMatch = block.match(/Description[:\s]*(.+?)(?:\n|$)/is);
      const filesMatch = block.match(/Files[:\s]*(.+?)(?:\n|$)/is);
      const priorityMatch = block.match(/Priority[:\s]*(critical|high|medium|low)/i);

      if (titleMatch) {
        tasks.push({
          taskId: crypto.randomUUID(),
          description: descMatch?.[1]?.trim() ?? titleMatch[1].trim(),
          context: block,
          requiredFiles: filesMatch ? filesMatch[1].split(/[,\n]/).map(f => f.trim()).filter(Boolean) : [],
          constraints: ["Follow existing architecture", "Respect file locks"],
          expectedOutput: `Implementation: ${titleMatch[1].trim()}`,
          priority: (priorityMatch?.[1]?.toLowerCase() as TaskPriority) ?? "medium",
          dependencies: [],
        });
      }
    }

    if (tasks.length === 0 && planText.trim()) {
      tasks.push({
        taskId: crypto.randomUUID(),
        description: planText.trim(),
        context: planText,
        requiredFiles: [],
        constraints: ["Follow existing architecture"],
        expectedOutput: "Implementation as described",
        priority: "medium",
        dependencies: [],
      });
    }

    return tasks;
  }
}
