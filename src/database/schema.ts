/**
 * Database Schema - Cloudflare Workers Edition
 * Hades Army v0.8.0
 * 15 tables for D1
 */

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("active"),
  priority: integer("priority").default(5),
  capabilities: text("capabilities").default("[]"),
  config: text("config").default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agentTasks = sqliteTable("agent_tasks", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  context: text("context").default("{}"),
  result: text("result"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
});

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  target: text("target").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  overallScore: integer("overall_score"),
  findings: text("findings").default("[]"),
  summary: text("summary"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
});

export const approvalRequests = sqliteTable("approval_requests", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  metadata: text("metadata").default("{}"),
  requestedBy: text("requested_by").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at"),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  rejectedBy: text("rejected_by"),
  rejectedAt: text("rejected_at"),
  rejectionReason: text("rejection_reason"),
  escalationLevel: integer("escalation_level").default(0),
});

export const memoryEntries = sqliteTable("memory_entries", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  category: text("category").default("general"),
  tags: text("tags").default("[]"),
  version: integer("version").default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  expiresAt: text("expires_at"),
  accessCount: integer("access_count").default(0),
});

export const memoryVersions = sqliteTable("memory_versions", {
  id: text("id").primaryKey(),
  entryId: text("entry_id").notNull(),
  version: integer("version").notNull(),
  value: text("value").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").default("system"),
  changeDescription: text("change_description"),
});

export const rollbackSnapshots = sqliteTable("rollback_snapshots", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").default("system"),
  data: text("data").notNull(),
  checksum: text("checksum").notNull(),
  tags: text("tags").default("[]"),
});

export const rollbackOperations = sqliteTable("rollback_operations", {
  id: text("id").primaryKey(),
  snapshotId: text("snapshot_id").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("in_progress"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  initiatedBy: text("initiated_by").notNull(),
  reason: text("reason").notNull(),
  result: text("result"),
});

export const promptTemplates = sqliteTable("prompt_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  version: integer("version").default(1),
  content: text("content").notNull(),
  variables: text("variables").default("[]"),
  status: text("status").default("draft"),
  createdBy: text("created_by").default("system"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  tags: text("tags").default("[]"),
  metadata: text("metadata").default("{}"),
});

export const scheduledJobs = sqliteTable("scheduled_jobs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  frequency: text("frequency").notNull(),
  cronExpression: text("cron_expression"),
  nextRunAt: text("next_run_at").notNull(),
  lastRunAt: text("last_run_at"),
  status: text("status").default("pending"),
  handler: text("handler").notNull(),
  payload: text("payload").default("{}"),
  runCount: integer("run_count").default(0),
  failureCount: integer("failure_count").default(0),
  maxFailures: integer("max_failures").default(3),
  enabled: integer("enabled").default(1),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  payload: text("payload").default("{}"),
  priority: text("priority").default("normal"),
  status: text("status").default("pending"),
  createdAt: text("created_at").notNull(),
  scheduledAt: text("scheduled_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  error: text("error"),
  result: text("result"),
});

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  severity: text("severity").notNull(),
  status: text("status").default("active"),
  message: text("message").notNull(),
  source: text("source").notNull(),
  metric: text("metric").notNull(),
  threshold: real("threshold").notNull(),
  currentValue: real("current_value").notNull(),
  createdAt: text("created_at").notNull(),
  acknowledgedAt: text("acknowledged_at"),
  acknowledgedBy: text("acknowledged_by"),
  resolvedAt: text("resolved_at"),
  resolvedBy: text("resolved_by"),
  resolution: text("resolution"),
});

export const metrics = sqliteTable("metrics", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  value: real("value").notNull(),
  labels: text("labels").default("{}"),
  timestamp: text("timestamp").notNull(),
});

export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
