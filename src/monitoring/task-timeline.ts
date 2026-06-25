/**
 * Task Timeline & Agent Logs - Cloudflare Workers Edition
 * Hades Army v0.9.2 — Observability
 *
 * Priority 8: Task Timeline + Agent Logs
 *
 * Task Timeline shows the progress of a workflow:
 *   Task Created → Planning → Build → Review → PR Created → Completed
 *
 * Agent Logs show per-agent call details:
 *   - Prompt size (chars + tokens)
 *   - Response time (ms)
 *   - Token usage (input + output)
 *   - Cost (USD)
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";
import type { WorkflowStage } from "../orchestration/workflow";

// ============================================
// Types
// ============================================

export type TimelineEventType =
  | "task_created"
  | "planning_started"
  | "planning_completed"
  | "build_started"
  | "build_completed"
  | "review_started"
  | "review_completed"
  | "pr_created"
  | "approval_requested"
  | "approval_granted"
  | "approval_rejected"
  | "merge_started"
  | "merge_completed"
  | "aborted"
  | "rollback";

export interface TimelineEvent {
  id: string;
  workflowId: string;
  type: TimelineEventType;
  stage?: WorkflowStage;
  timestamp: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskTimeline {
  workflowId: string;
  events: TimelineEvent[];
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  currentStage?: WorkflowStage;
}

export type AgentRole = "manager" | "builder" | "reviewer";

export interface AgentLogEntry {
  id: string;
  workflowId: string;
  taskId?: string;
  agentRole: AgentRole;
  provider: string;
  model: string;
  promptSizeChars: number;
  promptTokensIn: number;
  responseTokensOut: number;
  responseTimeMs: number;
  costUsd: number;
  success: boolean;
  error?: string;
  timestamp: string;
}

export interface AgentLogSummary {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  avgResponseMs: number;
  byAgent: Array<{
    role: AgentRole;
    calls: number;
    successRate: number;
    totalCostUsd: number;
    avgResponseMs: number;
  }>;
}

// ============================================
// Task Timeline Tracker
// ============================================

const KV_KEY_TIMELINES = "task-timelines"; // Map of workflowId → TaskTimeline
const KV_KEY_AGENT_LOGS = "agent-logs";    // Array of recent AgentLogEntry

export class TaskTimelineTracker {
  private env: HadesBindings;
  /** In-memory cache (per-isolate). Mirrored to KV. */
  private timelines: Map<string, TaskTimeline> = new Map();

  constructor(env: HadesBindings) {
    this.env = env;
  }

  /**
   * Record a timeline event.
   */
  async recordEvent(
    workflowId: string,
    type: TimelineEventType,
    detail?: string,
    metadata?: Record<string, unknown>,
    stage?: WorkflowStage,
  ): Promise<TimelineEvent> {
    const event: TimelineEvent = {
      id: generateId("evt"),
      workflowId,
      type,
      stage,
      timestamp: new Date().toISOString(),
      detail,
      metadata,
    };

    let timeline = this.timelines.get(workflowId);
    if (!timeline) {
      timeline = {
        workflowId,
        events: [],
        startedAt: event.timestamp,
      };
      this.timelines.set(workflowId, timeline);
    }

    timeline.events.push(event);

    // Update current stage
    if (stage) timeline.currentStage = stage;

    // Mark completed/aborted
    if (type === "merge_completed") {
      timeline.completedAt = event.timestamp;
      timeline.durationMs = new Date(timeline.completedAt).getTime() - new Date(timeline.startedAt).getTime();
    }
    if (type === "aborted" || type === "rollback") {
      timeline.completedAt = event.timestamp;
      timeline.durationMs = new Date(timeline.completedAt).getTime() - new Date(timeline.startedAt).getTime();
    }

    // Persist to KV
    await this.persist();

    logger.info(`TaskTimeline: ${type} for workflow ${workflowId}`, {
      eventId: event.id,
      totalEvents: timeline.events.length,
    });

    return event;
  }

  /**
   * Get the timeline for a workflow.
   */
  async getTimeline(workflowId: string): Promise<TaskTimeline | undefined> {
    // Try in-memory first
    const cached = this.timelines.get(workflowId);
    if (cached) return cached;
    // Try KV
    await this.load();
    return this.timelines.get(workflowId);
  }

  /**
   * Render the timeline as a Telegram-friendly string.
   */
  render(timeline: TaskTimeline): string {
    const lines: string[] = [
      `📋 *Task Timeline* — \`${timeline.workflowId}\``,
      ``,
    ];

    const iconFor: Record<TimelineEventType, string> = {
      task_created: "📨",
      planning_started: "🧠",
      planning_completed: "✅",
      build_started: "⚔️",
      build_completed: "✅",
      review_started: "🛡️",
      review_completed: "✅",
      pr_created: "📦",
      approval_requested: "⏳",
      approval_granted: "✅",
      approval_rejected: "❌",
      merge_started: "🔀",
      merge_completed: "🎉",
      aborted: "❌",
      rollback: "⏮️",
    };

    for (const event of timeline.events) {
      const icon = iconFor[event.type] ?? "•";
      const time = new Date(event.timestamp).toLocaleTimeString("en-US", { hour12: false });
      lines.push(`${icon} \`${time}\` ${event.type.replace(/_/g, " ")}`);
      if (event.detail) lines.push(`   _${event.detail}_`);
    }

    if (timeline.completedAt) {
      lines.push(``);
      lines.push(`*Duration:* ${timeline.durationMs ? Math.round(timeline.durationMs / 1000) : "?"}s`);
    }

    return lines.join("\n");
  }

  // ============================================
  // Private: KV persistence
  // ============================================

  private async persist(): Promise<void> {
    if (!this.env.HADES_KV) return;
    const serialized = Array.from(this.timelines.entries());
    // Keep only last 50 workflows
    const trimmed = serialized.slice(-50);
    await this.env.HADES_KV.put(KV_KEY_TIMELINES, JSON.stringify(trimmed));
  }

  private async load(): Promise<void> {
    if (!this.env.HADES_KV) return;
    const raw = await this.env.HADES_KV.get(KV_KEY_TIMELINES);
    if (!raw) return;
    try {
      const entries = JSON.parse(raw) as Array<[string, TaskTimeline]>;
      for (const [id, tl] of entries) {
        if (!this.timelines.has(id)) {
          this.timelines.set(id, tl);
        }
      }
    } catch {
      // ignore
    }
  }
}

// ============================================
// Agent Logger
// ============================================

export class AgentLogger {
  private env: HadesBindings;
  private logs: AgentLogEntry[] = [];

  constructor(env: HadesBindings) {
    this.env = env;
  }

  /**
   * Record an agent LLM call.
   */
  async record(entry: Omit<AgentLogEntry, "id" | "timestamp">): Promise<AgentLogEntry> {
    const full: AgentLogEntry = {
      ...entry,
      id: generateId("alog"),
      timestamp: new Date().toISOString(),
    };

    this.logs.push(full);
    // Keep last 200 in memory
    if (this.logs.length > 200) this.logs = this.logs.slice(-200);

    // Persist to KV
    if (this.env.HADES_KV) {
      try {
        const existing = await this.env.HADES_KV.get(KV_KEY_AGENT_LOGS);
        const list: AgentLogEntry[] = existing ? JSON.parse(existing) : [];
        list.push(full);
        // Keep last 500 in KV
        await this.env.HADES_KV.put(KV_KEY_AGENT_LOGS, JSON.stringify(list.slice(-500)));
      } catch (err) {
        logger.warn("AgentLogger: KV persist failed", { err });
      }
    }

    return full;
  }

  /**
   * Get all logs (in-memory + KV-loaded).
   */
  async getLogs(limit = 50): Promise<AgentLogEntry[]> {
    let all = this.logs;
    if (this.env.HADES_KV) {
      try {
        const raw = await this.env.HADES_KV.get(KV_KEY_AGENT_LOGS);
        if (raw) {
          const list = JSON.parse(raw) as AgentLogEntry[];
          // Merge and deduplicate
          const seen = new Set(all.map((l) => l.id));
          for (const l of list) {
            if (!seen.has(l.id)) all.push(l);
          }
        }
      } catch {
        // ignore
      }
    }
    return all.slice(-limit).reverse();
  }

  /**
   * Compute summary statistics.
   */
  async getSummary(): Promise<AgentLogSummary> {
    const logs = await this.getLogs(500);
    const totalCalls = logs.length;
    const successful = logs.filter((l) => l.success);
    const failed = logs.filter((l) => !l.success);

    const totalTokensIn = logs.reduce((s, l) => s + l.promptTokensIn, 0);
    const totalTokensOut = logs.reduce((s, l) => s + l.responseTokensOut, 0);
    const totalCostUsd = logs.reduce((s, l) => s + l.costUsd, 0);
    const avgResponseMs = totalCalls > 0
      ? Math.round(logs.reduce((s, l) => s + l.responseTimeMs, 0) / totalCalls)
      : 0;

    const byRole: Record<AgentRole, AgentLogEntry[]> = {
      manager: [],
      builder: [],
      reviewer: [],
    };
    for (const l of logs) {
      byRole[l.agentRole].push(l);
    }

    const byAgent = (Object.entries(byRole) as Array<[AgentRole, AgentLogEntry[]]>).map(([role, entries]) => {
      const calls = entries.length;
      const successCount = entries.filter((e) => e.success).length;
      return {
        role,
        calls,
        successRate: calls > 0 ? Math.round((successCount / calls) * 100) : 0,
        totalCostUsd: entries.reduce((s, e) => s + e.costUsd, 0),
        avgResponseMs: calls > 0 ? Math.round(entries.reduce((s, e) => s + e.responseTimeMs, 0) / calls) : 0,
      };
    });

    return {
      totalCalls,
      successfulCalls: successful.length,
      failedCalls: failed.length,
      totalTokensIn,
      totalTokensOut,
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      avgResponseMs,
      byAgent,
    };
  }

  /**
   * Render agent logs as a Telegram-friendly string.
   */
  renderSummary(summary: AgentLogSummary): string {
    const lines: string[] = [
      `📊 *Agent Logs*`,
      ``,
      `*Total calls:* ${summary.totalCalls}`,
      `*Successful:* ${summary.successfulCalls} ✅`,
      `*Failed:* ${summary.failedCalls} ❌`,
      `*Tokens:* ${summary.totalTokensIn.toLocaleString()} in · ${summary.totalTokensOut.toLocaleString()} out`,
      `*Total cost:* $${summary.totalCostUsd.toFixed(4)}`,
      `*Avg response:* ${summary.avgResponseMs}ms`,
      ``,
      `*By agent:*`,
    ];

    for (const a of summary.byAgent) {
      const icon = a.role === "manager" ? "🧠" : a.role === "builder" ? "⚔️" : "🛡️";
      lines.push(`${icon} *${a.role}* — ${a.calls} calls · ${a.successRate}% ok · $${a.totalCostUsd.toFixed(4)} · ${a.avgResponseMs}ms avg`);
    }

    return lines.join("\n");
  }

  /**
   * Render recent log entries.
   */
  renderRecent(logs: AgentLogEntry[], limit = 10): string {
    const lines: string[] = [
      `📋 *Recent Agent Calls* (last ${Math.min(limit, logs.length)})`,
      ``,
    ];

    for (const l of logs.slice(0, limit)) {
      const icon = l.success ? "✅" : "❌";
      const role = l.agentRole.padEnd(8);
      const tokens = `${l.promptTokensIn}+${l.responseTokensOut}`;
      lines.push(`${icon} \`${role}\` ${l.provider}/${l.model}`);
      lines.push(`   ${l.responseTimeMs}ms · ${tokens} tokens · $${l.costUsd.toFixed(6)}`);
    }

    return lines.join("\n");
  }
}

// ============================================
// Factory
// ============================================

let _timeline: TaskTimelineTracker | null = null;
let _agentLogger: AgentLogger | null = null;

export function getTaskTimelineTracker(env: HadesBindings): TaskTimelineTracker {
  if (!_timeline) _timeline = new TaskTimelineTracker(env);
  return _timeline;
}

export function getAgentLogger(env: HadesBindings): AgentLogger {
  if (!_agentLogger) _agentLogger = new AgentLogger(env);
  return _agentLogger;
}
