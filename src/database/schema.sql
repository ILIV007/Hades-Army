-- Hades Army — D1 Database Schema
-- Run: wrangler d1 execute hades-db --file=./src/database/schema.sql

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  telegram_id INTEGER NOT NULL UNIQUE,
  settings_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);

-- ============================================================
-- PROJECTS
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  repo_owner TEXT NOT NULL,
  default_branch TEXT DEFAULT 'main',
  status TEXT DEFAULT 'onboarding' CHECK (status IN ('onboarding', 'active', 'paused', 'archived')),
  github_token_encrypted TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- ============================================================
-- TASKS
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  state TEXT DEFAULT 'CREATED' CHECK (state IN (
    'CREATED', 'PLANNING', 'READY', 'BUILDING', 'REVIEWING',
    'PR_CREATED', 'WAITING_APPROVAL', 'MERGED', 'COMPLETED',
    'FAILED', 'BLOCKED', 'CANCELLED'
  )),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  assigned_agent TEXT CHECK (assigned_agent IN ('manager', 'builder', 'reviewer')),
  parent_task_id TEXT,
  dependencies TEXT DEFAULT '[]',
  required_files TEXT DEFAULT '[]',
  constraints TEXT DEFAULT '[]',
  expected_output TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_tasks_project_state ON tasks(project_id, state);

-- ============================================================
-- TASK STATE HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS task_states (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  previous_state TEXT NOT NULL,
  new_state TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  reason TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_task_states_task ON task_states(task_id);
CREATE INDEX IF NOT EXISTS idx_task_states_timestamp ON task_states(timestamp);

-- ============================================================
-- REVIEWS
-- ============================================================
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  reviewer_agent TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL')),
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_task ON reviews(task_id);

-- ============================================================
-- AGENT RUNS
-- ============================================================
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_role TEXT NOT NULL CHECK (agent_role IN ('manager', 'builder', 'reviewer')),
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost_estimate REAL DEFAULT 0,
  start_time TEXT NOT NULL,
  end_time TEXT,
  duration_ms INTEGER,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'timeout')),
  output TEXT,
  error TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

-- ============================================================
-- SECRETS
-- ============================================================
CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_secrets_project ON secrets(project_id);

-- ============================================================
-- APPROVALS
-- ============================================================
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED')),
  requested_at TEXT NOT NULL,
  responded_at TEXT,
  responder_telegram_id INTEGER,
  comment TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_approvals_task ON approvals(task_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

-- ============================================================
-- FILE LOCKS
-- ============================================================
CREATE TABLE IF NOT EXISTS file_locks (
  file_path TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  locked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_file_locks_task ON file_locks(task_id);
CREATE INDEX IF NOT EXISTS idx_file_locks_expires ON file_locks(expires_at);

-- ============================================================
-- MODEL USAGE
-- ============================================================
CREATE TABLE IF NOT EXISTS model_usage (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  success INTEGER DEFAULT 1,
  duration_ms INTEGER DEFAULT 0,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_usage_provider ON model_usage(provider);
CREATE INDEX IF NOT EXISTS idx_model_usage_model ON model_usage(model);
CREATE INDEX IF NOT EXISTS idx_model_usage_timestamp ON model_usage(timestamp);

-- ============================================================
-- LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  task_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('task', 'agent', 'github', 'memory', 'error', 'security', 'workflow')),
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  message TEXT NOT NULL,
  metadata TEXT,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_project ON logs(project_id);
CREATE INDEX IF NOT EXISTS idx_logs_task ON logs(task_id);
CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(type);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
