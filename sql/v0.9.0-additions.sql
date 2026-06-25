-- ============================================================
-- Hades Army v0.9.0 — Architecture Completion Migrations
-- ============================================================
-- Additive migrations on top of v0.8.5.
-- These tables support the new v0.9.0 features:
--   - audit_log              (Section 9: Audit Log — immutable event log)
--   - approved_plans         (Section 7: Plan/Build mode handoff)
--   - repository_analyses    (Section 5: Cached repository analyses)
--   - agent_decisions        (Section 2: Manager decisions audit)
--   - hotspots               (Section 5: Hotspot detection cache)
--   - technical_debt         (Section 5: Technical debt cache)
--   - mode_states            (Section 7: Per-user mode persistence)
--
-- Run with: wrangler d1 execute hades-db --file=./sql/v0.9.0-additions.sql
-- ============================================================

-- ------------------------------------------------------------
-- Section 9: Audit Log (immutable)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,           -- repository_connection | agent_decision | pr_action | ...
  severity TEXT NOT NULL,           -- info | warning | critical
  actor TEXT NOT NULL,              -- user_id | "manager" | "builder" | "reviewer" | "system"
  action TEXT NOT NULL,             -- specific action
  project_id TEXT,
  workflow_id TEXT,
  task_id TEXT,
  repository_full_name TEXT,
  details TEXT NOT NULL,            -- JSON
  timestamp TEXT NOT NULL,
  parent_id TEXT                    -- for chaining related entries
);
CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_log(category);
CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_log(severity);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_workflow ON audit_log(workflow_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);

-- ------------------------------------------------------------
-- Section 7: Approved plans (Plan → Build mode handoff)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approved_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  plan_json TEXT NOT NULL,          -- full PlanAnalysis
  approved_at TEXT NOT NULL,
  consumed_at TEXT,                 -- set when Build mode starts
  status TEXT NOT NULL DEFAULT 'pending'  -- pending | consumed | expired
);
CREATE INDEX IF NOT EXISTS idx_plans_user ON approved_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_status ON approved_plans(status);

-- ------------------------------------------------------------
-- Section 5: Cached repository analyses
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repository_analyses (
  id TEXT PRIMARY KEY,
  repository_full_name TEXT NOT NULL,
  analysis_json TEXT NOT NULL,      -- full RepositoryAnalysis
  health_score INTEGER NOT NULL,
  analyzed_at TEXT NOT NULL,
  UNIQUE(repository_full_name)
);
CREATE INDEX IF NOT EXISTS idx_analyses_repo ON repository_analyses(repository_full_name);
CREATE INDEX IF NOT EXISTS idx_analyses_health ON repository_analyses(health_score);

-- ------------------------------------------------------------
-- Section 5: Hotspots cache
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hotspots (
  id TEXT PRIMARY KEY,
  repository_full_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  attention_score INTEGER NOT NULL,
  reasons TEXT NOT NULL,            -- JSON array
  detected_at TEXT NOT NULL,
  UNIQUE(repository_full_name, file_path)
);
CREATE INDEX IF NOT EXISTS idx_hotspots_repo ON hotspots(repository_full_name);
CREATE INDEX IF NOT EXISTS idx_hotspots_score ON hotspots(attention_score DESC);

-- ------------------------------------------------------------
-- Section 5: Technical debt cache
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS technical_debt (
  id TEXT PRIMARY KEY,
  repository_full_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_number INTEGER,
  debt_type TEXT NOT NULL,          -- todo | fixme | hack | deprecated | ...
  severity TEXT NOT NULL,
  snippet TEXT,
  detected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debt_repo ON technical_debt(repository_full_name);
CREATE INDEX IF NOT EXISTS idx_debt_type ON technical_debt(debt_type);
CREATE INDEX IF NOT EXISTS idx_debt_severity ON technical_debt(severity);

-- ------------------------------------------------------------
-- Section 7: Per-user mode persistence
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mode_states (
  user_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,               -- plan | build | explore
  has_approved_plan INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- ------------------------------------------------------------
-- Section 2: Manager decisions audit
-- (separate from agent_messages — this captures the Manager's
--  high-level decisions, not the inter-agent messages)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manager_decisions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  project_id TEXT,
  decision_type TEXT NOT NULL,      -- proceed_to_pr | replan | abort | merge | rollback
  reason TEXT NOT NULL,
  context_json TEXT,                -- JSON: builder confidence, review score, etc.
  decided_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_workflow ON manager_decisions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_decisions_type ON manager_decisions(decision_type);

-- ============================================================
-- End of v0.9.0 migrations
-- ============================================================
