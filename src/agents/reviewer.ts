/**
 * Hades Army v0.2 — Reviewer Agent
 * Validates Builder output. PASS or FAIL. Pure ESM.
 */

import type { HadesEnv } from "../config/env";
import type { AgentConfig, ReviewerOutput, Task, BuilderOutput } from "../types";
import { LLMService } from "../services/llm.service";
import { PromptService } from "../services/prompt.service";
import { Logger } from "../utils/logger";

export class ReviewerAgent {
  private llm: LLMService;
  private prompts: PromptService;
  private logger: Logger;

  constructor(env: HadesEnv, config: AgentConfig, projectId: string) {
    this.llm = new LLMService(env, projectId);
    this.prompts = new PromptService();
    this.logger = new Logger(env, projectId);
  }

  async review(task: Task, builderOutput: BuilderOutput, architecture: string): Promise<ReviewerOutput> {
    const startTime = Date.now();
    const runId = crypto.randomUUID();

    await this.logger.info("agent", `Reviewer starting ${task.id}`);

    const systemPrompt = this.prompts.getSystemPrompt("reviewer");
    const userPrompt = this.prompts.buildReviewerPrompt(builderOutput.patchDiff, task.description, architecture);

    const response = await this.llm.call({ role: "reviewer", model: "deepseek/deepseek-v3.1", provider: "openrouter", temperature: 0.1, maxTokens: 8192, capabilities: [], restrictions: [] }, systemPrompt, userPrompt);

    const status = this.parseStatus(response.content);
    const issues = this.parseIssues(response.content);
    const summary = this.parseSummary(response.content);

    const duration = Date.now() - startTime;
    await this.logger.info("agent", `Reviewer completed: ${status}`, { taskId: task.id, durationMs: duration, issues: issues.length });

    return { status, issues, summary, taskId: task.id, runId };
  }

  private parseStatus(content: string): "PASS" | "FAIL" {
    const match = content.match(/STATUS:\s*(PASS|FAIL)/i);
    return match?.[1]?.toUpperCase() === "PASS" ? "PASS" : "FAIL";
  }

  private parseIssues(content: string): Array<{ file: string; line?: number; severity: "critical" | "high" | "medium" | "low" | "info"; message: string; suggestion?: string }> {
    const issues: Array<{ file: string; line?: number; severity: "critical" | "high" | "medium" | "low" | "info"; message: string; suggestion?: string }> = [];
    const regex = /\d+\.\s*\[SEVERITY:\s*(critical|high|medium|low|info)\]\s*(.+?)(?:Suggestion:\s*(.+?))?(?=\d+\.\s*\[|$)/gis;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const severity = match[1].toLowerCase() as "critical" | "high" | "medium" | "low" | "info";
      const detail = match[2].trim();
      const suggestion = match[3]?.trim();
      const fileMatch = detail.match(/^(.+?)(?::(\d+))?\s*—\s*(.+)$/);
      if (fileMatch) {
        issues.push({ file: fileMatch[1].trim(), line: fileMatch[2] ? parseInt(fileMatch[2]) : undefined, severity, message: fileMatch[3].trim(), suggestion });
      } else {
        issues.push({ file: "unknown", severity, message: detail, suggestion });
      }
    }
    return issues;
  }

  private parseSummary(content: string): string {
    const match = content.match(/SUMMARY:\s*(.+?)(?=\n|$)/is);
    return match?.[1]?.trim() ?? "No summary provided";
  }
}
