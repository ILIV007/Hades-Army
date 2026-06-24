-- ============================================================
-- Hades Army v0.8.5 — Architecture Realignment Migrations
-- ============================================================
-- Additive migrations on top of the v0.8.0 schema (src/database/schema.ts).
-- These tables support the new v0.8.5 features:
--   - agent_messages         (Priority 1: Agent Communication Protocol)
--   - workflows              (Priority 1: Workflow instances)
--   - github_audit_log       (Priority 1+4: Manager GitHub operations audit)
--   - model_registry_overrides (Priority 2: Runtime model overrides)
--   - repository_memory_snapshots (Priority 3: .hades/ snapshot mirroring)
--   - cost_records           (Additional: Cost tracking)
--   - agent_metrics_daily    (Additional: Agent metrics rollup)
--   - onboarding_sessions    (Priority 4: Wizard session persistence)
--
-- Run with: wrangler d1 execute hades-db --file=./sql/v0.8.5-additions.sql
-- ============================================================

-- ------------------------------------------------------------
-- Priority 1: Agent Communication Protocol
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                -- MANAGER_TO_BUILDER | BUILDER_TO_REVIEWER | ...
  from_role TEXT NOT NULL,           -- manager | builder | reviewer | system
  to_role TEXT NOT NULL,             -- manager | builder | reviewer | system
  task_id TEXT NOT NULL,
  project_id TEXT,
  payload TEXT NOT NULL,             -- JSON
  status TEXT NOT NULL DEFAULT 'sent', -- sent | delivered | acknowledged | failed
  sent_at TEXT NOT NULL,
  delivered_at TEXT,
  acknowledged_at TEXT,
  parent_message_id TEXT,
  metadata TEXT                       -- JSON
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_task ON agent_messages(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_kind ON agent_messages(kind);
CREATE INDEX IF NOT EXISTS idx_agent_messages_sent ON agent_messages(sent_at);

-- ------------------------------------------------------------
-- Priority 1: Workflow instances
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  current_stage TEXT NOT NULL,       -- WorkflowStage enum
  history TEXT NOT NULL,             -- JSON array
  started_at TEXT NOT NULL,
  completed_at TEXT,
  aborted_at TEXT,
  abort_reason TEXT,
  pr_url TEXT,
  merge_sha TEXT,
  cost_estimate_usd REAL
);
CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);
CREATE INDEX IF NOT EXISTS idx_workflows_user ON workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(current_stage);

-- ------------------------------------------------------------
-- Priority 1+4: GitHub audit log (Manager-only writes)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS github_audit_log (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,           -- create_branch | commit | create_pr | merge_pr | rollback | delete_branch
  repository_full_name TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'manager',
  params TEXT NOT NULL,              -- JSON
  result TEXT NOT NULL,              -- success | failure
  error TEXT,
  sha TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_github_audit_repo ON github_audit_log(repository_full_name);
CREATE INDEX IF NOT EXISTS idx_github_audit_op ON github_audit_log(operation);
CREATE INDEX IF NOT EXISTS idx_github_audit_started ON github_audit_log(started_at);

-- ------------------------------------------------------------
-- Priority 2: Model Registry runtime overrides
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_registry_overrides (
  role TEXT PRIMARY KEY,             -- manager | builder | reviewer
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  cost_per_1m_input_tokens REAL,
  cost_per_1m_output_tokens REAL,
  context_window INTEGER,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  reason TEXT
);

-- ------------------------------------------------------------
-- Priority 3: Repository Memory snapshots (mirror of .hades/)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repository_memory_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  repo_path TEXT NOT NULL,           -- e.g. ".hades/architecture.md"
  content TEXT NOT NULL,
  sha TEXT,
  captured_at TEXT NOT NULL,
  captured_by TEXT NOT NULL DEFAULT 'manager'
);
CREATE INDEX IF NOT EXISTS idx_repo_memory_project ON repository_memory_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_repo_memory_path ON repository_memory_snapshots(repo_path);

-- ------------------------------------------------------------
-- Additional: Cost records (mirror of KV)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_records (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,          -- manager | builder | reviewer
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_records_workflow ON cost_records(workflow_id);
CREATE INDEX IF NOT EXISTS idx_cost_records_role ON cost_records(agent_role);
CREATE INDEX IF NOT EXISTS idx_cost_records_provider ON cost_records(provider);
CREATE INDEX IF NOT EXISTS idx_cost_records_recorded ON cost_records(recorded_at);

-- ------------------------------------------------------------
-- Additional: Agent metrics daily rollup
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_metrics_daily (
  day TEXT NOT NULL,                 -- YYYY-MM-DD
  agent_role TEXT NOT NULL,          -- manager | builder | reviewer
  counter_name TEXT NOT NULL,        -- patches_generated | reviews_completed | ...
  counter_value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, agent_role, counter_name)
);

-- ------------------------------------------------------------
-- Priority 4: Onboarding sessions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  repository_full_name TEXT,
  stage TEXT NOT NULL,               -- CONNECT | PERMISSION_VALIDATION | ...
  state_json TEXT NOT NULL,          -- full OnboardingState
  started_at TEXT NOT NULL,
  completed_at TEXT,
  abort_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_onboarding_user ON onboarding_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_status ON onboarding_sessions(stage);

-- ============================================================
-- End of v0.8.5 migrations
-- ============================================================
