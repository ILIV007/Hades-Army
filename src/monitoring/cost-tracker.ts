/**
 * Cost Tracker - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Additional improvement: Cost Dashboard
 *
 * Tracks token usage and estimated cost per:
 *   - workflow
 *   - agent (manager / builder / reviewer)
 *   - provider (google / openrouter / cloudflare / …)
 *
 * Storage: KV (ephemeral, rolling 30-day window). In production,
 * mirror to D1 (see sql/v0.8.5-additions.sql: cost_records table).
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";
import { ModelRegistry, type AgentRole, type ModelConfig } from "../registry/model-registry";

// ============================================
// Types
// ============================================

export interface CostRecord {
  id: string;
  workflowId: string;
  agentRole: AgentRole;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  recordedAt: string;
}

export interface CostSummary {
  period: "today" | "month";
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byAgent: Array<{ role: AgentRole; costUsd: number; calls: number; tokens: number }>;
  byProvider: Array<{ provider: string; costUsd: number; calls: number; tokens: number }>;
  byWorkflow: Array<{ workflowId: string; costUsd: number; calls: number }>;
}

// ============================================
// Cost Tracker
// ============================================

const KV_KEY_LOG = "cost-tracker:log";
const KV_KEY_INDEX_TODAY = "cost-tracker:index:today";
const KV_KEY_INDEX_MONTH = "cost-tracker:index:month";

export class CostTracker {
  private env: HadesBindings;
  private registry: ModelRegistry;
  private cache: CostRecord[] | null = null;

  constructor(env: HadesBindings) {
    this.env = env;
    this.registry = ModelRegistry.getInstance(env);
  }

  // ============================================
  // Record a usage event
  // ============================================

  async record(
    workflowId: string,
    agentRole: AgentRole,
    model: ModelConfig,
    inputTokens: number,
    outputTokens: number,
  ): Promise<CostRecord> {
    const costUsd =
      ((model.costPer1MInputTokens ?? 0) * inputTokens) / 1_000_000 +
      ((model.costPer1MOutputTokens ?? 0) * outputTokens) / 1_000_000;

    const record: CostRecord = {
      id: generateId("cost"),
      workflowId,
      agentRole,
      provider: model.provider,
      model: model.model,
      inputTokens,
      outputTokens,
      costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
      recordedAt: new Date().toISOString(),
    };

    await this.appendRecord(record);
    logger.debug(`CostTracker: +$${record.costUsd.toFixed(6)} (${agentRole}/${model.provider}/${model.model})`, {
      workflowId,
      tokens: `${inputTokens}+${outputTokens}`,
    });
    return record;
  }

  /**
   * Synchronous cost estimation (no token counts). Used by the Manager
   * controller to log estimated cost before the actual LLM call returns.
   */
  estimate(workflowId: string, agentRole: AgentRole, model: ModelConfig, estimatedLines: number): void {
    const estimatedInputTokens = Math.min(8000, Math.max(500, estimatedLines * 4));
    const estimatedOutputTokens = Math.min(4000, Math.max(200, estimatedLines * 2));
    const costUsd =
      ((model.costPer1MInputTokens ?? 0) * estimatedInputTokens) / 1_000_000 +
      ((model.costPer1MOutputTokens ?? 0) * estimatedOutputTokens) / 1_000_000;

    logger.info(`CostTracker estimate: $${costUsd.toFixed(6)} for ${agentRole} (${model.provider}/${model.model})`, {
      workflowId,
      estimatedInputTokens,
      estimatedOutputTokens,
    });
  }

  // ============================================
  // Summary
  // ============================================

  getSummary(period: "today" | "month" = "today"): CostSummary {
    const records = this.loadSync().filter((r) => this.inPeriod(r.recordedAt, period));

    const byAgentMap = new Map<AgentRole, { costUsd: number; calls: number; tokens: number }>();
    const byProviderMap = new Map<string, { costUsd: number; calls: number; tokens: number }>();
    const byWorkflowMap = new Map<string, { costUsd: number; calls: number }>();

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;

    for (const r of records) {
      totalInputTokens += r.inputTokens;
      totalOutputTokens += r.outputTokens;
      totalCostUsd += r.costUsd;

      const a = byAgentMap.get(r.agentRole) ?? { costUsd: 0, calls: 0, tokens: 0 };
      a.costUsd += r.costUsd;
      a.calls += 1;
      a.tokens += r.inputTokens + r.outputTokens;
      byAgentMap.set(r.agentRole, a);

      const p = byProviderMap.get(r.provider) ?? { costUsd: 0, calls: 0, tokens: 0 };
      p.costUsd += r.costUsd;
      p.calls += 1;
      p.tokens += r.inputTokens + r.outputTokens;
      byProviderMap.set(r.provider, p);

      const w = byWorkflowMap.get(r.workflowId) ?? { costUsd: 0, calls: 0 };
      w.costUsd += r.costUsd;
      w.calls += 1;
      byWorkflowMap.set(r.workflowId, w);
    }

    return {
      period,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      byAgent: Array.from(byAgentMap.entries()).map(([role, v]) => ({ role, ...v })),
      byProvider: Array.from(byProviderMap.entries()).map(([provider, v]) => ({ provider, ...v })),
      byWorkflow: Array.from(byWorkflowMap.entries()).map(([workflowId, v]) => ({ workflowId, ...v })),
    };
  }

  // ============================================
  // Monthly usage (convenience)
  // ============================================

  getMonthlyUsage(): { costUsd: number; totalCalls: number; tokens: number } {
    const summary = this.getSummary("month");
    return {
      costUsd: summary.totalCostUsd,
      totalCalls: summary.byWorkflow.reduce((acc, w) => acc + w.calls, 0),
      tokens: summary.totalInputTokens + summary.totalOutputTokens,
    };
  }

  // ============================================
  // Private: storage
  // ============================================

  private async appendRecord(record: CostRecord): Promise<void> {
    if (!this.env.HADES_KV) return;
    const records = (await this.load());
    records.push(record);
    // Trim to last 5000 records (rolling window)
    const trimmed = records.slice(-5000);
    await this.env.HADES_KV.put(KV_KEY_LOG, JSON.stringify(trimmed));
    this.cache = trimmed;
  }

  private async load(): Promise<CostRecord[]> {
    if (this.cache) return this.cache;
    if (!this.env.HADES_KV) return [];
    const raw = await this.env.HADES_KV.get(KV_KEY_LOG);
    if (!raw) {
      this.cache = [];
      return [];
    }
    try {
      this.cache = JSON.parse(raw) as CostRecord[];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  private loadSync(): CostRecord[] {
    return this.cache ?? [];
  }

  private inPeriod(timestamp: string, period: "today" | "month"): boolean {
    const ts = new Date(timestamp).getTime();
    const now = Date.now();
    if (period === "today") {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      return ts >= dayStart.getTime();
    }
    // month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return ts >= monthStart.getTime();
  }
}

// ============================================
// Factory (added in v9.2-fix — used by admin-api.ts)
// ============================================

let _costTrackerInstance: CostTracker | null = null;

export function getCostTracker(env: HadesBindings): CostTracker {
  if (!_costTrackerInstance) _costTrackerInstance = new CostTracker(env);
  return _costTrackerInstance;
}
