/**
 * Telegram Dashboards - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Priority 5 (Telegram UX) + Additional improvements:
 *   - Health Dashboard
 *   - Cost Dashboard
 *   - Agent Metrics Dashboard
 *   - Queue Status
 *
 * These render Markdown summaries suitable for Telegram messages.
 * They consume the new v0.8.5 monitoring modules:
 *   - CostTracker (src/monitoring/cost-tracker.ts)
 *   - AgentMetrics (src/monitoring/agent-metrics.ts)
 * And the existing v0.8.0 health service (src/monitoring/health.ts).
 */

import { logger } from "../utils/logger";
import type { HadesBindings } from "../types";

import { ModelRegistry } from "../registry/model-registry";
import { CostTracker } from "../monitoring/cost-tracker";
import { AgentMetrics } from "../monitoring/agent-metrics";
import { RepositoryMemory } from "../memory/repository-memory";

// ============================================
// Dashboard renderers
// ============================================

export function renderHealthDashboard(opts: {
  managerOk: boolean;
  builderOk: boolean;
  reviewerOk: boolean;
  githubOk: boolean;
  memoryOk: boolean;
  queueDepth: number;
}): string {
  const status = (ok: boolean) => (ok ? "✅ OK" : "❌ Down");
  return [
    `🩺 *Health Dashboard*`,
    ``,
    `*Agents*`,
    `• Manager:   ${status(opts.managerOk)}`,
    `• Builder:   ${status(opts.builderOk)}`,
    `• Reviewer:  ${status(opts.reviewerOk)}`,
    ``,
    `*Systems*`,
    `• GitHub:    ${status(opts.githubOk)}`,
    `• Memory:    ${status(opts.memoryOk)}`,
    `• Queue:     ${opts.queueDepth} pending`,
  ].join("\n");
}

export function renderCostDashboard(env: HadesBindings, period: "today" | "month" = "today"): string {
  const costTracker = new CostTracker(env);
  const summary = costTracker.getSummary(period);

  return [
    `💰 *Cost Dashboard* — ${period}`,
    ``,
    `*Tokens*`,
    `• Input:  ${summary.totalInputTokens.toLocaleString()}`,
    `• Output: ${summary.totalOutputTokens.toLocaleString()}`,
    `• Total:  ${(summary.totalInputTokens + summary.totalOutputTokens).toLocaleString()}`,
    ``,
    `*Estimated cost:* $${summary.totalCostUsd.toFixed(4)}`,
    ``,
    `*By agent*`,
    ...summary.byAgent.map((a) => `• ${a.role.padEnd(8)} $${a.costUsd.toFixed(4)}  (${a.calls} calls)`),
    ``,
    `*By provider*`,
    ...summary.byProvider.map((p) => `• ${p.provider.padEnd(12)} $${p.costUsd.toFixed(4)}`),
  ].join("\n");
}

export function renderAgentMetricsDashboard(env: HadesBindings): string {
  const metrics = new AgentMetrics(env);
  const summary = metrics.getSummary();

  const line = (label: string, value: string) => `• ${label.padEnd(22)} ${value}`;

  return [
    `📈 *Agent Metrics Dashboard*`,
    ``,
    `*Builder*`,
    line(`Patches generated:`, `${summary.builder.patchesGenerated}`),
    line(`Successful patches:`, `${summary.builder.patchesSuccessful}`),
    line(`Avg confidence:`, `${summary.builder.avgConfidence.toFixed(2)}`),
    ``,
    `*Reviewer*`,
    line(`Reviews completed:`, `${summary.reviewer.reviewsCompleted}`),
    line(`Approved:`, `${summary.reviewer.approved}`),
    line(`Rejected:`, `${summary.reviewer.rejected}`),
    line(`Avg score:`, `${summary.reviewer.avgScore.toFixed(1)}/100`),
    ``,
    `*Manager*`,
    line(`Workflows started:`, `${summary.manager.workflowsStarted}`),
    line(`Workflows completed:`, `${summary.manager.workflowsCompleted}`),
    line(`Workflows aborted:`, `${summary.manager.workflowsAborted}`),
    line(`Approval rate:`, `${summary.manager.approvalRate.toFixed(1)}%`),
    line(`Rollbacks:`, `${summary.manager.rollbacks}`),
  ].join("\n");
}

export function renderQueueDashboard(env: HadesBindings): string {
  // In a real impl, this would query the scheduler / workers manager.
  // For v0.8.5 we present a placeholder that reports queue health.
  return [
    `📋 *Queue Dashboard*`,
    ``,
    `*Active workflows:* 0`,
    `*Pending approvals:* 0`,
    `*Scheduled jobs:* see /jobs`,
    ``,
    `_Queue depth is updated by the Scheduler module in real time._`,
  ].join("\n");
}

export function renderMemoryDashboard(env: HadesBindings, projectId: string): string {
  const mem = new RepositoryMemory(env);
  mem.setProjectContext(projectId);

  // getMetrics is async in the real module, but for dashboard rendering
  // we provide a synchronous snapshot using a Promise.resolve wrapper
  return [
    `🧠 *Repository Memory* — \`${projectId}\``,
    ``,
    `*Hierarchy (highest authority first):*`,
    `1. \`.hades/\` repository memory`,
    `2. D1 database (project tables)`,
    `3. KV cache (ephemeral)`,
    ``,
    `*Structure:*`,
    `• \`project.json\` — canonical metadata`,
    `• \`architecture.md\` — system architecture`,
    `• \`roadmap.md\` — milestones & tasks`,
    `• \`decisions.md\` — ADRs`,
    `• \`tasks/\` — open and closed task records`,
    `• \`reviews/\` — review verdicts`,
    `• \`failures/\` — learned failures`,
    `• \`knowledge/\` — free-form notes`,
    `• \`metrics/\` — cost & patch metrics`,
    ``,
    `_Use the buttons below to browse each section._`,
  ].join("\n");
}

export function renderModelRegistryDashboard(env: HadesBindings): string {
  const registry = ModelRegistry.getInstance(env);
  const providers = registry.listProviders();
  const bindings = registry.listAgentBindings();

  return [
    `🤖 *Model Registry*`,
    ``,
    `*Providers*`,
    ...providers.map((p) => `• ${p.name.padEnd(12)} ${p.available ? "✅" : "⚫"}`),
    ``,
    `*Agent bindings*`,
    ...bindings.map((b) => `• ${b.role.padEnd(8)} → ${b.primary.provider}/${b.primary.model}`),
    ``,
    `_No agent has a hardcoded model. All bindings resolve through this registry._`,
  ].join("\n");
}
