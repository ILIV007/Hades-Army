/**
 * TypeScript Types - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import type { Context } from "hono";

// ============================================
// Core Types
// ============================================

export type AgentType = "builder" | "reviewer" | "analyzer" | "tester" | "deployer" | "custom";
export type AgentStatus = "active" | "paused" | "pending" | "error";

export type ReviewType = "code" | "architecture" | "security" | "performance" | "documentation";
export type ReviewStatus = "pending" | "in_progress" | "completed" | "approved" | "rejected";

export type ApprovalType = "deployment" | "code_change" | "config_change" | "pr_review" | "agent_action" | "rollback" | "custom";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export type RollbackType = "code" | "config" | "database" | "deployment" | "agent_state";
export type RollbackStatus = "in_progress" | "completed" | "failed";

export type PromptCategory = "system" | "agent" | "review" | "build" | "analysis" | "custom";
export type PromptStatus = "draft" | "active" | "deprecated" | "archived";

export type JobPriority = "low" | "normal" | "high" | "critical";
export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "retrying";

export type JobFrequency = "once" | "minute" | "hourly" | "daily" | "weekly" | "monthly" | "custom";
export type ScheduledJobStatus = "pending" | "running" | "completed" | "failed" | "paused";

export type AlertSeverity = "info" | "warning" | "critical" | "emergency";
export type AlertStatus = "active" | "acknowledged" | "resolved" | "muted";

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

// ============================================
// Entity Types
// ============================================

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  priority: number;
  capabilities: string[];
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTask {
  id: string;
  agentId: string;
  type: string;
  status: JobStatus;
  context: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Review {
  id: string;
  target: string;
  type: ReviewType;
  status: ReviewStatus;
  overallScore?: number;
  findings: Array<{
    category: string;
    severity: string;
    message: string;
    line?: number;
    suggestion?: string;
  }>;
  summary?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ApprovalRequest {
  id: string;
  type: ApprovalType;
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  requestedBy: string;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

export interface MemoryEntry {
  id: string;
  key: string;
  value: unknown;
  category: string;
  tags: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  accessCount: number;
}

export interface MemoryVersion {
  id: string;
  entryId: string;
  version: number;
  value: unknown;
  createdAt: string;
  createdBy: string;
  changeDescription?: string;
}

export interface RollbackSnapshot {
  id: string;
  type: RollbackType;
  name: string;
  description: string;
  createdAt: string;
  createdBy: string;
  data: Record<string, unknown>;
  checksum: string;
  tags: string[];
}

export interface PromptTemplate {
  id: string;
  name: string;
  category: PromptCategory;
  version: number;
  content: string;
  variables: string[];
  status: PromptStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  priority: JobPriority;
  status: JobStatus;
  createdAt: string;
  scheduledAt: string;
  startedAt?: string;
  completedAt?: string;
  retryCount: number;
  maxRetries: number;
  error?: string;
  result?: unknown;
}

export interface ScheduledJob {
  id: string;
  name: string;
  description: string;
  frequency: JobFrequency;
  cronExpression?: string;
  nextRunAt: string;
  lastRunAt?: string;
  status: ScheduledJobStatus;
  handler: string;
  payload: Record<string, unknown>;
  runCount: number;
  failureCount: number;
  maxFailures: number;
  enabled: boolean;
}

export interface Alert {
  id: string;
  name: string;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  source: string;
  metric: string;
  threshold: number;
  currentValue: number;
  createdAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolution?: string;
}

// ============================================
// Health Types
// ============================================

export interface HealthCheckResult {
  status: HealthStatus;
  message?: string;
  latency?: number;
  critical?: boolean;
}

export interface HealthReport {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  version: string;
  checks: Record<string, HealthCheckResult>;
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
  };
}

// ============================================
// Context Types
// ============================================

export interface HadesBindings {
  HADES_DB: D1Database;
  HADES_KV: KVNamespace;
  HADES_R2: R2Bucket;
  AI: Ai;
  TELEGRAM_BOT_TOKEN?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GITHUB_TOKEN?: string;
  ADMIN_API_TOKEN?: string;
  API_KEYS?: string;
  NODE_ENV?: string;
  LOG_LEVEL?: string;
}

export interface HadesContext extends Context {
  env: HadesBindings;
  var: {
    requestId?: string;
    startTime?: number;
    user?: { id: string; role: string; permissions: string[] };
    validatedBody?: unknown;
    validatedQuery?: unknown;
    validatedParams?: unknown;
  };
}
