/**
 * Hades Army v0.4 — Context Budget Manager
 * Prevents token explosion. Manages context size for LLM calls.
 */

import type { AgentConfig } from "../types";

export interface BudgetAllocation {
  contextMax: number;
  historyMax: number;
  responseMax: number;
  totalMax: number;
}

export interface ContextBudget {
  allocated: number;
  used: number;
  remaining: number;
  files: Array<{ path: string; tokens: number }>;
  history: Array<{ summary: string; tokens: number }>;
}

export class BudgetManager {
  /**
   * Calculate budget allocation for an agent
   */
  static allocate(agentConfig: AgentConfig): BudgetAllocation {
    const totalMax = agentConfig.maxTokens;
    return {
      contextMax: Math.floor(totalMax * 0.6),  // 60% for file context
      historyMax: Math.floor(totalMax * 0.2),  // 20% for conversation history
      responseMax: Math.floor(totalMax * 0.2), // 20% for response
      totalMax,
    };
  }

  /**
   * Estimate tokens for text (rough approximation: 1 token ≈ 4 chars)
   */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Build context within budget
   */
  static buildContext(
    files: Array<{ path: string; content: string }>,
    history: Array<{ role: string; content: string }>,
    budget: BudgetAllocation
  ): { context: string; history: string; warnings: string[] } {
    const warnings: string[] = [];
    let contextTokens = 0;
    let historyTokens = 0;

    // Select files within budget
    const selectedFiles: Array<{ path: string; content: string }> = [];
    for (const file of files) {
      const fileTokens = this.estimateTokens(file.content);
      if (contextTokens + fileTokens > budget.contextMax) {
        warnings.push(`Skipped ${file.path} (would exceed context budget)`);
        continue;
      }
      selectedFiles.push(file);
      contextTokens += fileTokens;
    }

    // Build context string
    const context = selectedFiles
      .map(f => `--- ${f.path} ---\n${f.content}`)
      .join("\n\n");

    // Summarize history if too long
    let historyStr = "";
    for (const msg of history) {
      const msgTokens = this.estimateTokens(msg.content);
      if (historyTokens + msgTokens > budget.historyMax) {
        warnings.push("History truncated (would exceed budget)");
        break;
      }
      historyStr += `${msg.role}: ${msg.content}\n`;
      historyTokens += msgTokens;
    }

    return { context, history: historyStr, warnings };
  }

  /**
   * Summarize long content to fit budget
   */
  static summarize(content: string, maxTokens: number): string {
    const tokens = this.estimateTokens(content);
    if (tokens <= maxTokens) return content;

    // Simple truncation with summary marker
    const maxChars = maxTokens * 4;
    const truncated = content.slice(0, maxChars - 50);
    return truncated + `\n\n...[${tokens - maxTokens} tokens truncated]...`;
  }
}
