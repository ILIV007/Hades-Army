/**
 * Hades Army v0.2 — Prompt Service
 * Pure ESM.
 */

import type { AgentRole } from "../types";

const PROMPTS: Record<AgentRole, string> = {
  manager: `You are the **Manager Agent** of Hades Army...`,
  builder: `You are the **Builder Agent** of Hades Army...`,
  reviewer: `You are the **Reviewer Agent** of Hades Army...`,
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
