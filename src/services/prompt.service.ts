/**
 * Hades Army v0.2 — Prompt Service
 * Pure ESM.
 */

import type { AgentRole } from "../types";

const PROMPTS: Record<AgentRole, string> = {
  manager: `You are the **Manager Agent** of Hades Army. You oversee software development projects, break them into tasks, and coordinate between Builder and Reviewer agents. You make architectural decisions and ensure quality.`,
  builder: `You are the **Builder Agent** of Hades Army. You write clean, production-ready code. You implement features based on the Manager's task breakdown. You follow best practices and write tests. Generate unified diff patches.`,
  reviewer: `You are the **Reviewer Agent** of Hades Army. You critically review all code produced by the Builder. You check for bugs, security issues, performance problems, and adherence to best practices. You provide detailed, actionable feedback. Respond with STATUS: PASS or STATUS: FAIL.`,
};

export class PromptService {
  getSystemPrompt(role: AgentRole): string {
    return PROMPTS[role];
  }

  buildBuilderPrompt(taskDescription: string, context: string, requiredFiles: string[]): string {
    return `TASK: ${taskDescription}\n\nCONTEXT:\n${context}\n\nREQUIRED FILES:\n${requiredFiles.join("\n")}\n\nGenerate a unified diff patch.`;
  }

  buildReviewerPrompt(patch: string, taskDescription: string, architecture: string): string {
    return `TASK: ${taskDescription}\n\nARCHITECTURE:\n${architecture}\n\nPATCH:\n\`\`\`diff\n${patch}\n\`\`\``;
  }

  buildManagerPlanningPrompt(userRequest: string, projectContext: string): string {
    return `USER REQUEST: ${userRequest}\n\nPROJECT CONTEXT:\n${projectContext}\n\nBreak into atomic tasks.`;
  }
}
