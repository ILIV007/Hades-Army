-- ============================================================
-- Hades Army v0.9.1 — Stabilization & Production Readiness Migrations
-- ============================================================
-- Additive migrations on top of v0.9.0.
-- These tables support the new v0.9.1 features:
--   - connected_repositories  (Priority 5: /repositories command)
--   - conversation_states     (Priority 2: Conversation memory persistence)
--   - patch_validations       (Priority 8: Patch validation audit)
--   - pre_build_analyses      (Priority 6: Manager hardening audit)
--   - memory_sync_log         (Priority 2: Memory sync engine)
--   - startup_validations     (Priority 13: Secret validation history)
--
-- Run with: wrangler d1 execute hades-db --file=./sql/v0.9.1-additions.sql
-- ============================================================

-- ------------------------------------------------------------
-- Priority 5: Connected repositories (per-user)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connected_repositories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  repository_full_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public',
  default_branch TEXT NOT NULL DEFAULT 'main',
  language TEXT NOT NULL DEFAULT 'Unknown',
  size_kb INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  last_sync_at TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  UNIQUE(user_id, repository_full_name)
);
CREATE INDEX IF NOT EXISTS idx_repos_user ON connected_repositories(user_id);
CREATE INDEX IF NOT EXISTS idx_repos_status ON connected_repositories(status);

-- ------------------------------------------------------------
-- Priority 2: Conversation state (per-user, durable)
--   KV is the primary store (with TTL); this table is a mirror
--   that the Memory Sync Engine keeps up to date for durability.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_states (
  user_id TEXT PRIMARY KEY,
  active_project_id TEXT,
  active_repository TEXT,
  active_workflow_id TEXT,
  active_mode TEXT NOT NULL DEFAULT 'plan',
  recent_approvals TEXT NOT NULL DEFAULT '[]',     -- JSON array
  clarifying_answers TEXT NOT NULL DEFAULT '{}',   -- JSON object
  last_interaction_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversation_mode ON conversation_states(active_mode);

-- ------------------------------------------------------------
-- Priority 8: Patch validation audit
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patch_validations (
  id TEXT PRIMARY KEY,
  workflow_id TEXT,
  task_id TEXT,
  ok INTEGER NOT NULL,           -- 0 or 1
  blocked INTEGER NOT NULL,      -- 0 or 1
  findings TEXT NOT NULL,        -- JSON array
  file_count INTEGER NOT NULL,
  total_additions INTEGER NOT NULL,
  total_deletions INTEGER NOT NULL,
  total_lines INTEGER NOT NULL,
  validated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_patch_val_workflow ON patch_validations(workflow_id);
CREATE INDEX IF NOT EXISTS idx_patch_val_blocked ON patch_validations(blocked);

-- ------------------------------------------------------------
-- Priority 6: Pre-build analysis audit
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pre_build_analyses (
  id TEXT PRIMARY KEY,
  workflow_id TEXT,
  user_id TEXT,
  project_id TEXT,
  safe INTEGER NOT NULL,
  reject INTEGER NOT NULL,
  risk_score INTEGER NOT NULL,
  complexity_score INTEGER NOT NULL,
  blast_radius INTEGER NOT NULL,
  architecture_impact TEXT NOT NULL,    -- JSON
  affected_files TEXT NOT NULL,         -- JSON array
  estimated_tokens_in INTEGER NOT NULL,
  estimated_tokens_out INTEGER NOT NULL,
  estimated_cost_usd REAL NOT NULL,
  estimated_time_min INTEGER NOT NULL,
  clarifying_questions TEXT NOT NULL,   -- JSON array
  recommendation TEXT NOT NULL,
  recommendation_reason TEXT NOT NULL,
  danger_flags TEXT NOT NULL,           -- JSON array
  analyzed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pre_build_workflow ON pre_build_analyses(workflow_id);
CREATE INDEX IF NOT EXISTS idx_pre_build_recommendation ON pre_build_analyses(recommendation);

-- ------------------------------------------------------------
-- Priority 2: Memory sync log
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_sync_log (
  id TEXT PRIMARY KEY,
  sync_id TEXT NOT NULL,
  direction TEXT NOT NULL,       -- kv_to_d1 | d1_to_repo | repo_to_d1
  project_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  processed INTEGER NOT NULL,
  conflicts TEXT NOT NULL,       -- JSON array
  errors TEXT NOT NULL,          -- JSON array
  ok INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_direction ON memory_sync_log(direction);
CREATE INDEX IF NOT EXISTS idx_sync_started ON memory_sync_log(started_at);

-- ------------------------------------------------------------
-- Priority 13: Startup validation history
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS startup_validations (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL,
  degraded INTEGER NOT NULL,
  checked_count INTEGER NOT NULL,
  missing TEXT NOT NULL,         -- JSON array of names
  warnings TEXT NOT NULL,        -- JSON array of names
  checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_startup_ok ON startup_validations(ok);
CREATE INDEX IF NOT EXISTS idx_startup_at ON startup_validations(checked_at);

-- ============================================================
-- End of v0.9.1 migrations
-- ============================================================
