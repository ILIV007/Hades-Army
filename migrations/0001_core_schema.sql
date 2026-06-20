-- Migration 001: Core Schema
-- Hades Army v0.6 Ultimate

-- Projects
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    repo_url TEXT NOT NULL,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    github_token TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'interviewing', 'analyzing', 'active', 'paused', 'archived')),
    complexity_score REAL DEFAULT 0,
    architecture_score REAL DEFAULT 0,
    health_score REAL DEFAULT 0,
    memory_score REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_sync_at DATETIME,
    settings TEXT -- JSON
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'planning', 'building', 'reviewing', 'approved', 'merged', 'failed', 'rolled_back')),
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    risk_level TEXT DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    assigned_agent TEXT,
    files TEXT, -- JSON array of affected files
    diff TEXT,
    review_comments TEXT,
    pr_url TEXT,
    pr_number INTEGER,
    branch_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Reviews
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    reviewer_agent TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'needs_changes')),
    feedback TEXT,
    issues TEXT, -- JSON
    score INTEGER CHECK (score >= 0 AND score <= 100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Interviews (Persistent)
CREATE TABLE IF NOT EXISTS interviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    current_step INTEGER DEFAULT 1,
    total_steps INTEGER DEFAULT 8,
    answers TEXT, -- JSON
    architecture_proposal TEXT,
    approved BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Architecture Decision Records (ADR)
CREATE TABLE IF NOT EXISTS adrs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    adr_number TEXT NOT NULL,
    title TEXT NOT NULL,
    decision TEXT NOT NULL,
    reason TEXT NOT NULL,
    alternatives TEXT,
    consequences TEXT,
    status TEXT DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'deprecated', 'superseded')),
    author TEXT,
    date TEXT,
    tags TEXT, -- JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Knowledge Graph Nodes
CREATE TABLE IF NOT EXISTS knowledge_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    node_type TEXT NOT NULL CHECK (node_type IN ('feature', 'module', 'service', 'file', 'task', 'dependency', 'api', 'database', 'config')),
    name TEXT NOT NULL,
    description TEXT,
    metadata TEXT, -- JSON
    importance_score REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Knowledge Graph Edges
CREATE TABLE IF NOT EXISTS knowledge_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    source_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    relation_type TEXT NOT NULL CHECK (relation_type IN ('depends_on', 'imports', 'calls', 'extends', 'implements', 'uses', 'contains', 'related_to', 'triggers')),
    weight REAL DEFAULT 1.0,
    metadata TEXT, -- JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES knowledge_nodes(id) ON DELETE CASCADE
);

-- Failure Learning
CREATE TABLE IF NOT EXISTS failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    task_id INTEGER,
    failure_type TEXT NOT NULL CHECK (failure_type IN ('review_rejected', 'build_failed', 'test_failed', 'merge_failed', 'architecture_mistake', 'security_issue', 'performance_issue')),
    description TEXT NOT NULL,
    root_cause TEXT,
    solution TEXT,
    prevention TEXT,
    files_affected TEXT, -- JSON
    severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    resolved BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

-- Repository Intelligence
CREATE TABLE IF NOT EXISTS repo_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    extension TEXT,
    language TEXT,
    size INTEGER,
    lines INTEGER,
    complexity REAL DEFAULT 0,
    importance_score REAL DEFAULT 0,
    last_modified TEXT,
    imports TEXT, -- JSON
    exports TEXT, -- JSON
    functions TEXT, -- JSON
    classes TEXT, -- JSON
    symbols TEXT, -- JSON
    dependencies TEXT, -- JSON
    dependents TEXT, -- JSON
    is_hotspot BOOLEAN DEFAULT FALSE,
    technical_debt_score REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Symbols Index
CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    symbol_type TEXT NOT NULL CHECK (symbol_type IN ('function', 'class', 'interface', 'type', 'variable', 'constant', 'enum', 'module')),
    line_start INTEGER,
    line_end INTEGER,
    signature TEXT,
    documentation TEXT,
    is_exported BOOLEAN DEFAULT FALSE,
    is_public BOOLEAN DEFAULT FALSE,
    dependencies TEXT, -- JSON
    dependents TEXT, -- JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES repo_files(id) ON DELETE CASCADE
);

-- Dependencies Graph
CREATE TABLE IF NOT EXISTS dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    source_file_id INTEGER NOT NULL,
    target_file_id INTEGER NOT NULL,
    dependency_type TEXT NOT NULL CHECK (dependency_type IN ('import', 'require', 'dynamic_import', 'type_reference', 'inheritance', 'composition')),
    is_circular BOOLEAN DEFAULT FALSE,
    is_external BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (source_file_id) REFERENCES repo_files(id) ON DELETE CASCADE,
    FOREIGN KEY (target_file_id) REFERENCES repo_files(id) ON DELETE CASCADE
);

-- Snapshots (Recovery)
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('interview', 'task', 'workflow', 'agent_context', 'approval')),
    data TEXT NOT NULL, -- JSON
    checksum TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Provider Health
CREATE TABLE IF NOT EXISTS provider_health (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_name TEXT NOT NULL,
    status TEXT DEFAULT 'unknown' CHECK (status IN ('healthy', 'degraded', 'down', 'unknown')),
    latency_ms INTEGER,
    error_rate REAL DEFAULT 0,
    quota_remaining INTEGER,
    quota_total INTEGER,
    last_check DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_error TEXT,
    consecutive_failures INTEGER DEFAULT 0
);

-- System Metrics
CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_name TEXT NOT NULL,
    metric_value REAL NOT NULL,
    metric_type TEXT CHECK (metric_type IN ('counter', 'gauge', 'histogram')),
    labels TEXT, -- JSON
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Secrets Scan Results
CREATE TABLE IF NOT EXISTS secret_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    commit_sha TEXT,
    file_path TEXT NOT NULL,
    secret_type TEXT NOT NULL,
    line_number INTEGER,
    severity TEXT DEFAULT 'high' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    is_false_positive BOOLEAN DEFAULT FALSE,
    resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_reviews_task ON reviews(task_id);
CREATE INDEX IF NOT EXISTS idx_repo_files_project ON repo_files(project_id);
CREATE INDEX IF NOT EXISTS idx_repo_files_path ON repo_files(path);
CREATE INDEX IF NOT EXISTS idx_symbols_project ON symbols(project_id);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_dependencies_source ON dependencies(source_file_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_target ON dependencies(target_file_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_project ON knowledge_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_project ON knowledge_edges(project_id);
CREATE INDEX IF NOT EXISTS idx_failures_project ON failures(project_id);
CREATE INDEX IF NOT EXISTS idx_adrs_project ON adrs(project_id);
CREATE INDEX IF NOT EXISTS idx_interviews_project ON interviews(project_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_project ON snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_provider_health_name ON provider_health(provider_name);
