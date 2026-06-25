-- ============================================================
-- Hades Army v0.9.2 — Stability & UX Upgrade Migrations
-- ============================================================
-- Additive migrations on top of v0.9.1.
-- These tables support the new v0.9.2 features:
--   - draft_prs              (Priority 6: Draft Pull Requests)
--   - safe_mode_states       (Priority 6: Safe Mode per repository)
--   - timeline_events        (Priority 8: Task Timeline)
--   - agent_logs             (Priority 8: Agent call logs)
--   - memory_inspections     (Priority 2: Memory Inspector history)
--   - security_audits        (Priority 9: Security audit history)
--   - pre_build_analyses_v2  (Priority 3: Risk Analyzer results)
--
-- Run with: wrangler d1 execute hades-db --file=./sql/v0.9.2-additions.sql
-- ============================================================

-- ------------------------------------------------------------
-- Priority 6: Draft Pull Requests
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS draft_prs (
  id TEXT PRIMARY KEY,
  repository_full_name TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  files_json TEXT NOT NULL,         -- JSON array of file summaries
  total_additions INTEGER NOT NULL,
  total_deletions INTEGER NOT NULL,
  risk_level TEXT NOT NULL,
  ready_to_create INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  converted_to_pr_url TEXT,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_draft_prs_repo ON draft_prs(repository_full_name);
CREATE INDEX IF NOT EXISTS idx_draft_prs_ready ON draft_prs(ready_to_create);

-- ------------------------------------------------------------
-- Priority 6: Safe Mode state per repository
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS safe_mode_states (
  repository_full_name TEXT PRIMARY KEY,
  status TEXT NOT NULL,             -- active | lifted | never_enabled
  enabled_at TEXT,
  lifted_at TEXT
);

-- ------------------------------------------------------------
-- Priority 8: Task Timeline events
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  event_type TEXT NOT NULL,         -- task_created | planning_started | ...
  stage TEXT,                       -- WorkflowStage
  timestamp TEXT NOT NULL,
  detail TEXT,
  metadata TEXT                     -- JSON
);
CREATE INDEX IF NOT EXISTS idx_timeline_workflow ON timeline_events(workflow_id);
CREATE INDEX IF NOT EXISTS idx_timeline_type ON timeline_events(event_type);
CREATE INDEX IF NOT EXISTS idx_timeline_timestamp ON timeline_events(timestamp);

-- ------------------------------------------------------------
-- Priority 8: Agent call logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_logs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  task_id TEXT,
  agent_role TEXT NOT NULL,         -- manager | builder | reviewer
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_size_chars INTEGER NOT NULL,
  prompt_tokens_in INTEGER NOT NULL,
  response_tokens_out INTEGER NOT NULL,
  response_time_ms INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  success INTEGER NOT NULL,
  error TEXT,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_logs_workflow ON agent_logs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_role ON agent_logs(agent_role);
CREATE INDEX IF NOT EXISTS idx_agent_logs_timestamp ON agent_logs(timestamp);

-- ------------------------------------------------------------
-- Priority 2: Memory Inspector history
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_inspections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  inspection_json TEXT NOT NULL,    -- full MemoryInspection
  total_bytes INTEGER NOT NULL,
  total_items INTEGER NOT NULL,
  missing_paths_count INTEGER NOT NULL,
  checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inspections_project ON memory_inspections(project_id);
CREATE INDEX IF NOT EXISTS idx_inspections_at ON memory_inspections(checked_at);

-- ------------------------------------------------------------
-- Priority 9: Security audit history
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_audits (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL,
  critical_count INTEGER NOT NULL,
  high_count INTEGER NOT NULL,
  medium_count INTEGER NOT NULL,
  low_count INTEGER NOT NULL,
  info_count INTEGER NOT NULL,
  findings_json TEXT NOT NULL,      -- JSON array
  checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_audits_ok ON security_audits(ok);
CREATE INDEX IF NOT EXISTS idx_security_audits_at ON security_audits(checked_at);

-- ------------------------------------------------------------
-- Priority 3: Pre-Build Risk Analysis (v0.9.2 version)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pre_build_analyses_v2 (
  id TEXT PRIMARY KEY,
  workflow_id TEXT,
  user_id TEXT,
  project_id TEXT,
  sensitive_files_json TEXT NOT NULL,
  complexity TEXT NOT NULL,         -- low | medium | high | critical
  complexity_score INTEGER NOT NULL,
  impact_areas TEXT NOT NULL,       -- comma-separated
  impact_primary TEXT NOT NULL,
  impact_cross_cutting INTEGER NOT NULL,
  requires_explicit_approval INTEGER NOT NULL,
  requires_additional_secret_scan INTEGER NOT NULL,
  risk_level TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  reason TEXT NOT NULL,
  analyzed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pre_build_v2_workflow ON pre_build_analyses_v2(workflow_id);
CREATE INDEX IF NOT EXISTS idx_pre_build_v2_risk ON pre_build_analyses_v2(risk_level);

-- ============================================================
-- End of v0.9.2 migrations
-- ============================================================
