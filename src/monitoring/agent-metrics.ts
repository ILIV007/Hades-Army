/**
 * Agent Metrics - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Additional improvement: Agent Metrics Dashboard
 *
 * Tracks per-agent performance counters:
 *   Builder:
 *     - patchesGenerated
 *     - patchesSuccessful
 *     - avgConfidence
 *   Reviewer:
 *     - reviewsCompleted
 *     - approved / rejected
 *     - avgScore
 *   Manager:
 *     - workflowsStarted / completed / aborted
 *     - approvalRate
 *     - rollbacks
 *
 * Storage: KV. Mirror to D1 in production (see agent_metrics table).
 */

import { logger } from "../utils/logger";
import type { HadesBindings } from "../types";
import type { WorkflowStage } from "../orchestration/workflow";

// ============================================
// Types
// ============================================

export interface AgentMetricsSummary {
  builder: {
    patchesGenerated: number;
    patchesSuccessful: number;
    patchesFailed: number;
    avgConfidence: number;
  };
  reviewer: {
    reviewsCompleted: number;
    approved: number;
    rejected: number;
    changesRequested: number;
    avgScore: number;
  };
  manager: {
    workflowsStarted: number;
    workflowsCompleted: number;
    workflowsAborted: number;
    approvalRate: number;
    rollbacks: number;
    avgWorkflowDurationMs: number;
  };
}

export interface StageTiming {
  stage: WorkflowStage;
  elapsedMs: number;
  success: boolean;
}

// ============================================
// Agent Metrics
// ============================================

const KV_KEY_METRICS = "agent-metrics:summary";
const KV_KEY_STAGE_TIMINGS = "agent-metrics:stage-timings";

export class AgentMetrics {
  private env: HadesBindings;
  private summary: AgentMetricsSummary | null = null;

  constructor(env: HadesBindings) {
    this.env = env;
  }

  // ============================================
  // Record builders
  // ============================================

  recordPatch(workflowId: string, confidence: number): void {
    const s = this.loadSync();
    s.builder.patchesGenerated += 1;
    s.builder.avgConfidence = this.recomputeAvg(s.builder.avgConfidence, s.builder.patchesGenerated, confidence);
    void this.persist(s);
    logger.debug(`AgentMetrics: patch recorded for ${workflowId} (confidence=${confidence})`);
  }

  recordPatchOutcome(workflowId: string, success: boolean): void {
    const s = this.loadSync();
    if (success) s.builder.patchesSuccessful += 1;
    else s.builder.patchesFailed += 1;
    void this.persist(s);
  }

  recordReview(workflowId: string, score: number): void {
    const s = this.loadSync();
    s.reviewer.reviewsCompleted += 1;
    s.reviewer.avgScore = this.recomputeAvg(s.reviewer.avgScore, s.reviewer.reviewsCompleted, score);
    void this.persist(s);
    logger.debug(`AgentMetrics: review recorded for ${workflowId} (score=${score})`);
  }

  recordReviewOutcome(workflowId: string, outcome: "approved" | "rejected" | "changes_requested"): void {
    const s = this.loadSync();
    if (outcome === "approved") s.reviewer.approved += 1;
    else if (outcome === "rejected") s.reviewer.rejected += 1;
    else s.reviewer.changesRequested += 1;
    void this.persist(s);
  }

  recordWorkflowStarted(): void {
    const s = this.loadSync();
    s.manager.workflowsStarted += 1;
    void this.persist(s);
  }

  recordWorkflowCompleted(): void {
    const s = this.loadSync();
    s.manager.workflowsCompleted += 1;
    s.manager.approvalRate = s.manager.workflowsStarted > 0
      ? (s.manager.workflowsCompleted / s.manager.workflowsStarted) * 100
      : 0;
    void this.persist(s);
  }

  recordWorkflowAborted(): void {
    const s = this.loadSync();
    s.manager.workflowsAborted += 1;
    s.manager.approvalRate = s.manager.workflowsStarted > 0
      ? (s.manager.workflowsCompleted / s.manager.workflowsStarted) * 100
      : 0;
    void this.persist(s);
  }

  recordRollback(): void {
    const s = this.loadSync();
    s.manager.rollbacks += 1;
    void this.persist(s);
  }

  // ============================================
  // Stage timing
  // ============================================

  recordStage(workflowId: string, stage: WorkflowStage, elapsedMs: number, success: boolean): void {
    const s = this.loadSync();
    // Approximate average workflow duration = total stage timings / workflowsCompleted
    if (stage === "COMPLETED" && success) {
      s.manager.avgWorkflowDurationMs = this.recomputeAvg(s.manager.avgWorkflowDurationMs, s.manager.workflowsCompleted, elapsedMs);
    }
    void this.persist(s);
    void this.appendStageTiming({ stage, elapsedMs, success });
  }

  // ============================================
  // Snapshot
  // ============================================

  getSummary(): AgentMetricsSummary {
    return this.loadSync();
  }

  // ============================================
  // Private
  // ============================================

  private recomputeAvg(currentAvg: number, newCount: number, newValue: number): number {
    if (newCount <= 1) return newValue;
    return ((currentAvg * (newCount - 1)) + newValue) / newCount;
  }

  private loadSync(): AgentMetricsSummary {
    if (this.summary) return this.summary;
    // Default empty summary
    this.summary = {
      builder: { patchesGenerated: 0, patchesSuccessful: 0, patchesFailed: 0, avgConfidence: 0 },
      reviewer: { reviewsCompleted: 0, approved: 0, rejected: 0, changesRequested: 0, avgScore: 0 },
      manager: { workflowsStarted: 0, workflowsCompleted: 0, workflowsAborted: 0, approvalRate: 0, rollbacks: 0, avgWorkflowDurationMs: 0 },
    };
    return this.summary;
  }

  private async persist(summary: AgentMetricsSummary): Promise<void> {
    if (!this.env.HADES_KV) return;
    await this.env.HADES_KV.put(KV_KEY_METRICS, JSON.stringify(summary));
  }

  private async appendStageTiming(timing: StageTiming): Promise<void> {
    if (!this.env.HADES_KV) return;
    const raw = await this.env.HADES_KV.get(KV_KEY_STAGE_TIMINGS);
    const list: StageTiming[] = raw ? JSON.parse(raw) : [];
    list.push(timing);
    await this.env.HADES_KV.put(KV_KEY_STAGE_TIMINGS, JSON.stringify(list.slice(-1000)));
  }
}
