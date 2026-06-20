/**
 * Hades Army v0.6 - Database Layer
 * D1 Database operations with caching and hierarchy enforcement
 */

import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import type {
  Project, Task, Review, Interview, ADR, KnowledgeNode, KnowledgeEdge,
  Failure, RepositoryFile, Symbol, DependencyEdge, Snapshot, ProviderHealth,
  SecretScanResult, ProjectHealth, PaginatedResponse
} from '../core/types';
import { CONFIG } from '../core/config';
import { NotFoundError, ValidationError } from '../core/errors';

export interface DBContext {
  db: D1Database;
  kvCache: KVNamespace;
  kvProjects: KVNamespace;
}

// ============================================================================
// CACHE HELPERS
// ============================================================================

const CACHE_TTL = 300; // 5 minutes

async function getCache<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const cached = await kv.get(key);
  if (cached) {
    try {
      return JSON.parse(cached) as T;
    } catch {
      return null;
    }
  }
  return null;
}

async function setCache(kv: KVNamespace, key: string, value: unknown, ttl: number = CACHE_TTL): Promise<void> {
  await kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
}

async function invalidateCache(kv: KVNamespace, pattern: string): Promise<void> {
  // List and delete matching keys
  const list = await kv.list({ prefix: pattern });
  for (const key of list.keys) {
    await kv.delete(key.name);
  }
}

// ============================================================================
// PROJECT OPERATIONS
// ============================================================================

export async function createProject(ctx: DBContext, project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
  const result = await ctx.db.prepare(`
    INSERT INTO projects (name, description, repo_url, repo_owner, repo_name, github_token, status, settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    project.name,
    project.description || null,
    project.repoUrl,
    project.repoOwner,
    project.repoName,
    project.githubToken || null,
    project.status,
    JSON.stringify(project.settings || CONFIG.DEFAULT_PROJECT_SETTINGS)
  ).first();

  if (!result) {
    throw new ValidationError('Failed to create project');
  }

  const created = mapProject(result);
  await setCache(ctx.kvProjects, `project:${created.id}`, created);
  return created;
}

export async function getProject(ctx: DBContext, id: number): Promise<Project> {
  // Check KV first (Memory Hierarchy: KV > D1)
  const cached = await getCache<Project>(ctx.kvProjects, `project:${id}`);
  if (cached) return cached;

  const result = await ctx.db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
  if (!result) {
    throw new NotFoundError('Project', id);
  }

  const project = mapProject(result);
  await setCache(ctx.kvProjects, `project:${id}`, project);
  return project;
}

export async function updateProject(ctx: DBContext, id: number, updates: Partial<Project>): Promise<Project> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.complexityScore !== undefined) { fields.push('complexity_score = ?'); values.push(updates.complexityScore); }
  if (updates.architectureScore !== undefined) { fields.push('architecture_score = ?'); values.push(updates.architectureScore); }
  if (updates.healthScore !== undefined) { fields.push('health_score = ?'); values.push(updates.healthScore); }
  if (updates.memoryScore !== undefined) { fields.push('memory_score = ?'); values.push(updates.memoryScore); }
  if (updates.settings !== undefined) { fields.push('settings = ?'); values.push(JSON.stringify(updates.settings)); }
  if (updates.lastSyncAt !== undefined) { fields.push('last_sync_at = ?'); values.push(updates.lastSyncAt); }

  if (fields.length === 0) {
    return getProject(ctx, id);
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  const result = await ctx.db.prepare(`
    UPDATE projects SET ${fields.join(', ')} WHERE id = ? RETURNING *
  `).bind(...values).first();

  if (!result) {
    throw new NotFoundError('Project', id);
  }

  const project = mapProject(result);
  await setCache(ctx.kvProjects, `project:${id}`, project);
  return project;
}

export async function listProjects(ctx: DBContext, page: number = 1, limit: number = 20): Promise<PaginatedResponse<Project>> {
  const offset = (page - 1) * limit;

  const { results } = await ctx.db.prepare(`
    SELECT * FROM projects ORDER BY updated_at DESC LIMIT ? OFFSET ?
  `).bind(limit, offset).all();

  const countResult = await ctx.db.prepare('SELECT COUNT(*) as total FROM projects').first();
  const total = (countResult?.total as number) || 0;

  return {
    items: results.map(mapProject),
    total,
    page,
    limit,
    hasMore: offset + results.length < total,
  };
}

export async function deleteProject(ctx: DBContext, id: number): Promise<void> {
  await ctx.db.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
  await ctx.kvProjects.delete(`project:${id}`);
  await invalidateCache(ctx.kvCache, `project:${id}:*`);
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as number,
    name: row.name as string,
    description: row.description as string | undefined,
    repoUrl: row.repo_url as string,
    repoOwner: row.repo_owner as string,
    repoName: row.repo_name as string,
    githubToken: row.github_token as string | undefined,
    status: row.status as Project['status'],
    complexityScore: (row.complexity_score as number) || 0,
    architectureScore: (row.architecture_score as number) || 0,
    healthScore: (row.health_score as number) || 0,
    memoryScore: (row.memory_score as number) || 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    lastSyncAt: row.last_sync_at as string | undefined,
    settings: row.settings ? JSON.parse(row.settings as string) : undefined,
  };
}

// ============================================================================
// TASK OPERATIONS
// ============================================================================

export async function createTask(ctx: DBContext, task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
  const result = await ctx.db.prepare(`
    INSERT INTO tasks (project_id, title, description, status, priority, risk_level, assigned_agent, files, branch_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    task.projectId,
    task.title,
    task.description || null,
    task.status,
    task.priority,
    task.riskLevel,
    task.assignedAgent || null,
    task.files ? JSON.stringify(task.files) : null,
    task.branchName || null
  ).first();

  if (!result) throw new ValidationError('Failed to create task');
  return mapTask(result);
}

export async function getTask(ctx: DBContext, id: number): Promise<Task> {
  const result = await ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (!result) throw new NotFoundError('Task', id);
  return mapTask(result);
}

export async function updateTask(ctx: DBContext, id: number, updates: Partial<Task>): Promise<Task> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
  if (updates.riskLevel !== undefined) { fields.push('risk_level = ?'); values.push(updates.riskLevel); }
  if (updates.assignedAgent !== undefined) { fields.push('assigned_agent = ?'); values.push(updates.assignedAgent); }
  if (updates.files !== undefined) { fields.push('files = ?'); values.push(JSON.stringify(updates.files)); }
  if (updates.diff !== undefined) { fields.push('diff = ?'); values.push(updates.diff); }
  if (updates.reviewComments !== undefined) { fields.push('review_comments = ?'); values.push(updates.reviewComments); }
  if (updates.prUrl !== undefined) { fields.push('pr_url = ?'); values.push(updates.prUrl); }
  if (updates.prNumber !== undefined) { fields.push('pr_number = ?'); values.push(updates.prNumber); }
  if (updates.branchName !== undefined) { fields.push('branch_name = ?'); values.push(updates.branchName); }
  if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt); }

  if (fields.length === 0) return getTask(ctx, id);

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  const result = await ctx.db.prepare(`
    UPDATE tasks SET ${fields.join(', ')} WHERE id = ? RETURNING *
  `).bind(...values).first();

  if (!result) throw new NotFoundError('Task', id);
  return mapTask(result);
}

export async function listTasks(ctx: DBContext, projectId?: number, status?: string, page: number = 1, limit: number = 20): Promise<PaginatedResponse<Task>> {
  let query = 'SELECT * FROM tasks';
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (projectId !== undefined) { conditions.push('project_id = ?'); values.push(projectId); }
  if (status !== undefined) { conditions.push('status = ?'); values.push(status); }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
  values.push(limit, (page - 1) * limit);

  const { results } = await ctx.db.prepare(query).bind(...values).all();

  let countQuery = 'SELECT COUNT(*) as total FROM tasks';
  if (conditions.length > 0) {
    countQuery += ' WHERE ' + conditions.join(' AND ');
  }
  const countResult = await ctx.db.prepare(countQuery).bind(...values.slice(0, -2)).first();
  const total = (countResult?.total as number) || 0;

  return {
    items: results.map(mapTask),
    total,
    page,
    limit,
    hasMore: (page - 1) * limit + results.length < total,
  };
}

function mapTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as number,
    projectId: row.project_id as number,
    title: row.title as string,
    description: row.description as string | undefined,
    status: row.status as Task['status'],
    priority: row.priority as Task['priority'],
    riskLevel: row.risk_level as Task['riskLevel'],
    assignedAgent: row.assigned_agent as Task['assignedAgent'],
    files: row.files ? JSON.parse(row.files as string) : undefined,
    diff: row.diff as string | undefined,
    reviewComments: row.review_comments as string | undefined,
    prUrl: row.pr_url as string | undefined,
    prNumber: row.pr_number as number | undefined,
    branchName: row.branch_name as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: row.completed_at as string | undefined,
  };
}

// ============================================================================
// REVIEW OPERATIONS
// ============================================================================

export async function createReview(ctx: DBContext, review: Omit<Review, 'id' | 'createdAt'>): Promise<Review> {
  const result = await ctx.db.prepare(`
    INSERT INTO reviews (task_id, reviewer_agent, status, feedback, issues, score)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    review.taskId,
    review.reviewerAgent,
    review.status,
    review.feedback || null,
    review.issues ? JSON.stringify(review.issues) : null,
    review.score || null
  ).first();

  if (!result) throw new ValidationError('Failed to create review');
  return mapReview(result);
}

export async function getReviewsForTask(ctx: DBContext, taskId: number): Promise<Review[]> {
  const { results } = await ctx.db.prepare(`
    SELECT * FROM reviews WHERE task_id = ? ORDER BY created_at DESC
  `).bind(taskId).all();
  return results.map(mapReview);
}

function mapReview(row: Record<string, unknown>): Review {
  return {
    id: row.id as number,
    taskId: row.task_id as number,
    reviewerAgent: row.reviewer_agent as string,
    status: row.status as Review['status'],
    feedback: row.feedback as string | undefined,
    issues: row.issues ? JSON.parse(row.issues as string) : undefined,
    score: row.score as number | undefined,
    createdAt: row.created_at as string,
  };
}

// ============================================================================
// INTERVIEW OPERATIONS (Persistent)
// ============================================================================

export async function createInterview(ctx: DBContext, interview: Omit<Interview, 'id' | 'createdAt' | 'updatedAt'>): Promise<Interview> {
  const result = await ctx.db.prepare(`
    INSERT INTO interviews (project_id, status, current_step, total_steps, answers, architecture_proposal, approved)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    interview.projectId,
    interview.status,
    interview.currentStep,
    interview.totalSteps,
    interview.answers ? JSON.stringify(interview.answers) : null,
    interview.architectureProposal || null,
    interview.approved ? 1 : 0
  ).first();

  if (!result) throw new ValidationError('Failed to create interview');
  return mapInterview(result);
}

export async function getInterview(ctx: DBContext, id: number): Promise<Interview> {
  const result = await ctx.db.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first();
  if (!result) throw new NotFoundError('Interview', id);
  return mapInterview(result);
}

export async function getInterviewByProject(ctx: DBContext, projectId: number): Promise<Interview | null> {
  const result = await ctx.db.prepare('SELECT * FROM interviews WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').bind(projectId).first();
  if (!result) return null;
  return mapInterview(result);
}

export async function updateInterview(ctx: DBContext, id: number, updates: Partial<Interview>): Promise<Interview> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.currentStep !== undefined) { fields.push('current_step = ?'); values.push(updates.currentStep); }
  if (updates.answers !== undefined) { fields.push('answers = ?'); values.push(JSON.stringify(updates.answers)); }
  if (updates.architectureProposal !== undefined) { fields.push('architecture_proposal = ?'); values.push(updates.architectureProposal); }
  if (updates.approved !== undefined) { fields.push('approved = ?'); values.push(updates.approved ? 1 : 0); }

  if (fields.length === 0) return getInterview(ctx, id);

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  const result = await ctx.db.prepare(`
    UPDATE interviews SET ${fields.join(', ')} WHERE id = ? RETURNING *
  `).bind(...values).first();

  if (!result) throw new NotFoundError('Interview', id);
  return mapInterview(result);
}

function mapInterview(row: Record<string, unknown>): Interview {
  return {
    id: row.id as number,
    projectId: row.project_id as number,
    status: row.status as Interview['status'],
    currentStep: row.current_step as number,
    totalSteps: row.total_steps as number,
    answers: row.answers ? JSON.parse(row.answers as string) : undefined,
    architectureProposal: row.architecture_proposal as string | undefined,
    approved: Boolean(row.approved),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ============================================================================
// ADR OPERATIONS (Architecture Decision Records)
// ============================================================================

export async function createADR(ctx: DBContext, adr: Omit<ADR, 'id' | 'createdAt'>): Promise<ADR> {
  const result = await ctx.db.prepare(`
    INSERT INTO adrs (project_id, adr_number, title, decision, reason, alternatives, consequences, status, author, date, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    adr.projectId,
    adr.adrNumber,
    adr.title,
    adr.decision,
    adr.reason,
    adr.alternatives || null,
    adr.consequences || null,
    adr.status,
    adr.author || null,
    adr.date,
    adr.tags ? JSON.stringify(adr.tags) : null
  ).first();

  if (!result) throw new ValidationError('Failed to create ADR');
  return mapADR(result);
}

export async function getADRs(ctx: DBContext, projectId: number): Promise<ADR[]> {
  const { results } = await ctx.db.prepare(`
    SELECT * FROM adrs WHERE project_id = ? ORDER BY adr_number ASC
  `).bind(projectId).all();
  return results.map(mapADR);
}

export async function getADR(ctx: DBContext, id: number): Promise<ADR> {
  const result = await ctx.db.prepare('SELECT * FROM adrs WHERE id = ?').bind(id).first();
  if (!result) throw new NotFoundError('ADR', id);
  return mapADR(result);
}

function mapADR(row: Record<string, unknown>): ADR {
  return {
    id: row.id as number,
    projectId: row.project_id as number,
    adrNumber: row.adr_number as string,
    title: row.title as string,
    decision: row.decision as string,
    reason: row.reason as string,
    alternatives: row.alternatives as string | undefined,
    consequences: row.consequences as string | undefined,
    status: row.status as ADR['status'],
    author: row.author as string | undefined,
    date: row.date as string,
    tags: row.tags ? JSON.parse(row.tags as string) : undefined,
    createdAt: row.created_at as string,
  };
}

// ============================================================================
// KNOWLEDGE GRAPH OPERATIONS
// ============================================================================

export async function createKnowledgeNode(ctx: DBContext, node: Omit<KnowledgeNode, 'id' | 'createdAt'>): Promise<KnowledgeNode> {
  const result = await ctx.db.prepare(`
    INSERT INTO knowledge_nodes (project_id, node_type, name, description, metadata, importance_score)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    node.projectId,
    node.nodeType,
    node.name,
    node.description || null,
    node.metadata ? JSON.stringify(node.metadata) : null,
    node.importanceScore || 0
  ).first();

  if (!result) throw new ValidationError('Failed to create knowledge node');
  return mapKnowledgeNode(result);
}

export async function createKnowledgeEdge(ctx: DBContext, edge: Omit<KnowledgeEdge, 'id' | 'createdAt'>): Promise<KnowledgeEdge> {
  const result = await ctx.db.prepare(`
    INSERT INTO knowledge_edges (project_id, source_id, target_id, relation_type, weight, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    edge.projectId,
    edge.sourceId,
    edge.targetId,
    edge.relationType,
    edge.weight || 1.0,
    edge.metadata ? JSON.stringify(edge.metadata) : null
  ).first();

  if (!result) throw new ValidationError('Failed to create knowledge edge');
  return mapKnowledgeEdge(result);
}

export async function getKnowledgeGraph(ctx: DBContext, projectId: number): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
  const { results: nodeResults } = await ctx.db.prepare(`
    SELECT * FROM knowledge_nodes WHERE project_id = ?
  `).bind(projectId).all();

  const { results: edgeResults } = await ctx.db.prepare(`
    SELECT * FROM knowledge_edges WHERE project_id = ?
  `).bind(projectId).all();

  return {
    nodes: nodeResults.map(mapKnowledgeNode),
    edges: edgeResults.map(mapKnowledgeEdge),
  };
}

function mapKnowledgeNode(row: Record<string, unknown>): KnowledgeNode {
  return {
    id: row.id as number,
    projectId: row.project_id as number,
    nodeType: row.node_type as KnowledgeNode['nodeType'],
    name: row.name as string,
    description: row.description as string | undefined,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    importanceScore: (row.importance_score as number) || 0,
  };
}

function mapKnowledgeEdge(row: Record<string, unknown>): KnowledgeEdge {
  return {
    id: row.id as number,
    projectId: row.project_id as number,
    sourceId: row.source_id as number,
    targetId: row.target_id as number,
    relationType: row.relation_type as KnowledgeEdge['relationType'],
    weight: (row.weight as number) || 1.0,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
  };
}

// ============================================================================
// FAILURE LEARNING OPERATIONS
// ============================================================================

export async function recordFailure(ctx: DBContext, failure: Omit<Failure, 'id' | 'createdAt'>): Promise<Failure> {
  const result = await ctx.db.prepare(`
    INSERT INTO failures (project_id, task_id, failure_type, description, root_cause, solution, prevention, files_affected, severity, resolved)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    failure.projectId,
    failure.taskId || null,
    failure.failureType,
    failure.description,
    failure.rootCause || null,
    failure.solution || null,
    failure.prevention || null,
    failure.filesAffected ? JSON.stringify(failure.filesAffected) : null,
    failure.severity,
    failure.resolved ? 1 : 0
  ).first();

  if (!result) throw new ValidationError('Failed to record failure');
  return mapFailure(result);
}

export async function getFailures(ctx: DBContext, projectId: number, resolved?: boolean): Promise<Failure[]> {
  let query = 'SELECT * FROM failures WHERE project_id = ?';
  const values: unknown[] = [projectId];

  if (resolved !== undefined) {
    query += ' AND resolved = ?';
    values.push(resolved ? 1 : 0);
  }

  query += ' ORDER BY created_at DESC';

  const { results } = await ctx.db.prepare(query).bind(...values).all();
  return results.map(mapFailure);
}

export async function resolveFailure(ctx: DBContext, id: number, solution: string, prevention?: string): Promise<Failure> {
  const result = await ctx.db.prepare(`
    UPDATE failures SET resolved = 1, solution = ?, prevention = ? WHERE id = ? RETURNING *
  `).bind(solution, prevention || null, id).first();

  if (!result) throw new NotFoundError('Failure', id);
  return mapFailure(result);
}

function mapFailure(row: Record<string, unknown>): Failure {
  return {
    id: row.id as number,
    projectId: row.project_id as number,
    taskId: row.task_id as number | undefined,
    failureType: row.failure_type as Failure['failureType'],
    description: row.description as string,
    rootCause: row.root_cause as string | undefined,
    solution: row.solution as string | undefined,
    prevention: row.prevention as string | undefined,
    filesAffected: row.files_affected ? JSON.parse(row.files_affected as string) : undefined,
    severity: row.severity as Failure['severity'],
    resolved: Boolean(row.resolved),
    createdAt: row.created_at as string,
  };
}

// ============================================================================
// REPOSITORY INTELLIGENCE OPERATIONS
// ============================================================================

export async function createRepoFile(ctx: DBContext, file: Omit<RepositoryFile, 'id' | 'createdAt' | 'updatedAt'>): Promise<RepositoryFile> {
  const result = await ctx.db.prepare(`
    INSERT INTO repo_files (
      project_id, path, name, extension, language, size, lines, complexity, importance_score,
      last_modified, imports, exports, functions, classes, symbols, dependencies, dependents,
      is_hotspot, technical_debt_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    file.projectId, file.path, file.name, file.extension || null, file.language || null,
    file.size, file.lines, file.complexity, file.importanceScore,
    file.lastModified || null,
    file.imports ? JSON.stringify(file.imports) : null,
    file.exports ? JSON.stringify(file.exports) : null,
    file.functions ? JSON.stringify(file.functions) : null,
    file.classes ? JSON.stringify(file.classes) : null,
    file.symbols ? JSON.stringify(file.symbols) : null,
    file.dependencies ? JSON.stringify(file.dependencies) : null,
    file.dependents ? JSON.stringify(file.dependents) : null,
    file.isHotspot ? 1 : 0,
    file.technicalDebtScore || 0
  ).first();

  if (!result) throw new ValidationError('Failed to create repo file');
  return mapRepoFile(result);
}

export async function getRepoFiles(ctx: DBContext, projectId: number): Promise<RepositoryFile[]> {
  const { results } = await ctx.db.prepare(`
    SELECT * FROM repo_files WHERE project_id = ? ORDER BY path ASC
  `).bind(projectId).all();
  return results.map(mapRepoFile);
}

export async function getRepoFile(ctx: DBContext, id: number): Promise<RepositoryFile> {
  const result = await ctx.db.prepare('SELECT * FROM repo_files WHERE id = ?').bind(id).first();
  if (!result) throw new NotFoundError('RepositoryFile', id);
  return mapRepoFile(result);
}

export async function updateRepoFile(ctx: DBContext, id: number, updates: Partial<RepositoryFile>): Promise<RepositoryFile> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.complexity !== undefined) { fields.push('complexity = ?'); values.push(updates.complexity); }
  if (updates.importanceScore !== undefined) { fields.push('importance_score = ?'); values.push(updates.importanceScore); }
  if (updates.isHotspot !== undefined) { fields.push('is_hotspot = ?'); values.push(updates.isHotspot ? 1 : 0); }
  if (updates.technicalDebtScore !== undefined) { fields.push('technical_debt_score = ?'); values.push(updates.technicalDebtScore); }

  if (fields.length === 0) return getRepoFile(ctx, id);

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  const result = await ctx.db.prepare(`
    UPDATE repo_files SET ${fields.join(', ')} WHERE id = ? RETURNING *
  `).bind(...values).first();

  if (!result) throw new NotFoundError('RepositoryFile', id);
  return mapRepoFile(result);
}

function mapRepoFile(row: Record<string, unknown>): RepositoryFile {
  return {
    id: row.id as number,
    projectId: row.project_id as number,
    path: row.path as string,
    name: row.name as string,
    extension: row.extension as string | undefined,
    language: row.language as string | undefined,
    size: row.size as number,
    lines: row.lines as number,
    complexity: (row.complexity as number) || 0,
    importanceScore: (row.importance_score as number) || 0,
    lastModified: row.last_modified as string | undefined,
    imports: row.imports ? JSON.parse(row.imports as string) : undefined,
    exports: row.exports ? JSON.parse(row.exports as string) : undefined,
    functions: row.functions ? JSON.parse(row.functions as string) : undefined,
    classes: row.classes ? JSON.parse(row.classes as string) : undefined,
    symbols: row.symbols ? JSON.parse(row.symbols as string) : undefined,
    dependencies: row.dependencies ? JSON.parse(row.dependencies as string) : undefined,
    dependents: row.dependents ? JSON.parse(row.dependents as string) : undefined,
    isHotspot: Boolean(row.is_hotspot),
    technicalDebtScore: (row.technical_debt_score as number) || 0,
  };
}

// ============================================================================
// SNAPSHOT OPERATIONS (Recovery)
// ============================================================================

export async function createSnapshot(ctx: DBContext, snapshot: Omit<Snapshot, 'id' | 'createdAt'>): Promise<Snapshot> {
  const checksum = await generateChecksum(JSON.stringify(snapshot.data));

  const result = await ctx.db.prepare(`
    INSERT INTO snapshots (project_id, snapshot_type, data, checksum)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `).bind(
    snapshot.projectId,
    snapshot.snapshotType,
    JSON.stringify(snapshot.data),
    checksum
  ).first();

  if (!result) throw new ValidationError('Failed to create snapshot');
  return mapSnapshot(result);
}

export async function getLatestSnapshot(ctx: DBContext, projectId: number, type: Snapshot['snapshotType']): Promise<Snapshot | null> {
  const result = await ctx.db.prepare(`
    SELECT * FROM snapshots 
    WHERE project_id = ? AND snapshot_type = ? 
    ORDER BY created_at DESC LIMIT 1
  `).bind(projectId, type).first();

  if (!result) return null;
  return mapSnapshot(result);
}

export async function getSnapshots(ctx: DBContext, projectId: number, type?: Snapshot['snapshotType']): Promise<Snapshot[]> {
  let query = 'SELECT * FROM snapshots WHERE project_id = ?';
  const values: unknown[] = [projectId];

  if (type) {
    query += ' AND snapshot_type = ?';
    values.push(type);
  }

  query += ' ORDER BY created_at DESC';

  const { results } = await ctx.db.prepare(query).bind(...values).all();
  return results.map(mapSnapshot);
}

function mapSnapshot(row: Record<string, unknown>): Snapshot {
  return {
    id: row.id as number,
    projectId: row.project_id as number,
    snapshotType: row.snapshot_type as Snapshot['snapshotType'],
    data: JSON.parse(row.data as string),
    checksum: row.checksum as string,
    createdAt: row.created_at as string,
  };
}

async function generateChecksum(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// PROVIDER HEALTH OPERATIONS
// ============================================================================

export async function updateProviderHealth(ctx: DBContext, health: Omit<ProviderHealth, 'id'>): Promise<ProviderHealth> {
  const result = await ctx.db.prepare(`
    INSERT INTO provider_health (provider_name, status, latency_ms, error_rate, quota_remaining, quota_total, last_error, consecutive_failures)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_name) DO UPDATE SET
      status = excluded.status,
      latency_ms = excluded.latency_ms,
      error_rate = excluded.error_rate,
      quota_remaining = excluded.quota_remaining,
      quota_total = excluded.quota_total,
      last_check = CURRENT_TIMESTAMP,
      last_error = excluded.last_error,
      consecutive_failures = excluded.consecutive_failures
    RETURNING *
  `).bind(
    health.providerName,
    health.status,
    health.latencyMs || null,
    health.errorRate,
    health.quotaRemaining || null,
    health.quotaTotal || null,
    health.lastError || null,
    health.consecutiveFailures
  ).first();

  if (!result) throw new ValidationError('Failed to update provider health');
  return mapProviderHealth(result);
}

export async function getProviderHealth(ctx: DBContext, providerName?: string): Promise<ProviderHealth[]> {
  let query = 'SELECT * FROM provider_health';
  const values: unknown[] = [];

  if (providerName) {
    query += ' WHERE provider_name = ?';
    values.push(providerName);
  }

  query += ' ORDER BY last_check DESC';

  const { results } = await ctx.db.prepare(query).bind(...values).all();
  return results.map(mapProviderHealth);
}

function mapProviderHealth(row: Record<string, unknown>): ProviderHealth {
  return {
    id: row.id as number,
    providerName: row.provider_name as string,
    status: row.status as ProviderHealth['status'],
    latencyMs: row.latency_ms as number | undefined,
    errorRate: (row.error_rate as number) || 0,
    quotaRemaining: row.quota_remaining as number | undefined,
    quotaTotal: row.quota_total as number | undefined,
    lastCheck: row.last_check as string,
    lastError: row.last_error as string | undefined,
    consecutiveFailures: (row.consecutive_failures as number) || 0,
  };
}

// ============================================================================
// SECRET SCAN OPERATIONS
// ============================================================================

export async function recordSecretScan(ctx: DBContext, scan: Omit<SecretScanResult, 'id' | 'createdAt'>): Promise<SecretScanResult> {
  const result = await ctx.db.prepare(`
    INSERT INTO secret_scans (project_id, commit_sha, file_path, secret_type, line_number, severity, is_false_positive)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(
    scan.projectId,
    scan.commitSha || null,
    scan.filePath,
    scan.secretType,
    scan.lineNumber || null,
    scan.severity,
    scan.isFalsePositive ? 1 : 0
  ).first();

  if (!result) throw new ValidationError('Failed to record secret scan');
  return mapSecretScan(result);
}

export async function getSecretScans(ctx: DBContext, projectId: number): Promise<SecretScanResult[]> {
  const { results } = await ctx.db.prepare(`
    SELECT * FROM secret_scans WHERE project_id = ? AND is_false_positive = 0 ORDER BY created_at DESC
  `).bind(projectId).all();
  return results.map(mapSecretScan);
}

function mapSecretScan(row: Record<string, unknown>): SecretScanResult {
  return {
    id: row.id as number,
    projectId: row.project_id as number,
    commitSha: row.commit_sha as string | undefined,
    filePath: row.file_path as string,
    secretType: row.secret_type as SecretScanResult['secretType'],
    lineNumber: row.line_number as number | undefined,
    severity: row.severity as SecretScanResult['severity'],
    isFalsePositive: Boolean(row.is_false_positive),
    resolvedAt: row.resolved_at as string | undefined,
    createdAt: row.created_at as string,
  };
}

// ============================================================================
// HEALTH SCORE OPERATIONS
// ============================================================================

export async function saveProjectHealth(ctx: DBContext, health: ProjectHealth): Promise<void> {
  await ctx.db.prepare(`
    INSERT INTO metrics (metric_name, metric_value, metric_type, labels)
    VALUES (?, ?, 'gauge', ?)
  `).bind(
    `project_health_${health.projectId}`,
    health.overallScore,
    JSON.stringify({
      architectureScore: health.architectureScore,
      repositoryScore: health.repositoryScore,
      memoryScore: health.memoryScore,
      workflowStability: health.workflowStability,
      reviewSuccess: health.reviewSuccess,
      agentEfficiency: health.agentEfficiency,
    })
  ).run();
}

// ============================================================================
// MEMORY HIERARCHY ENFORCEMENT (Section 12)
// ============================================================================

export async function reconcileMemory(ctx: DBContext, projectId: number): Promise<{
  d1Count: number;
  kvCount: number;
  conflicts: number;
  resolved: number;
}> {
  // Get project from D1 (source of truth)
  const d1Project = await ctx.db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first();
  if (!d1Project) {
    throw new NotFoundError('Project', projectId);
  }

  // Get from KV
  const kvKey = `project:${projectId}`;
  const kvData = await ctx.kvProjects.get(kvKey);
  let kvProject: Project | null = null;
  if (kvData) {
    try {
      kvProject = JSON.parse(kvData) as Project;
    } catch {
      // Invalid KV data
    }
  }

  let conflicts = 0;
  let resolved = 0;

  // Reconcile: D1 is always source of truth
  if (kvProject) {
    const d1UpdatedAt = new Date(d1Project.updated_at as string).getTime();
    const kvUpdatedAt = new Date(kvProject.updatedAt).getTime();

    if (d1UpdatedAt > kvUpdatedAt) {
      conflicts++;
      // D1 is newer, update KV
      const project = mapProject(d1Project);
      await setCache(ctx.kvProjects, kvKey, project);
      resolved++;
    } else if (kvUpdatedAt > d1UpdatedAt) {
      conflicts++;
      // KV is newer (shouldn't happen, but recover)
      await ctx.db.prepare(`
        UPDATE projects SET updated_at = ? WHERE id = ?
      `).bind(new Date(kvUpdatedAt).toISOString(), projectId).run();
      resolved++;
    }
  } else {
    // KV missing, sync from D1
    const project = mapProject(d1Project);
    await setCache(ctx.kvProjects, kvKey, project);
  }

  return {
    d1Count: 1,
    kvCount: kvProject ? 1 : 0,
    conflicts,
    resolved,
  };
}

export async function recoverFromSnapshot(ctx: DBContext, projectId: number): Promise<{
  recovered: boolean;
  snapshotsRestored: number;
  details: string[];
}> {
  const details: string[] = [];
  let snapshotsRestored = 0;

  // Check for interview snapshot
  const interviewSnapshot = await getLatestSnapshot(ctx, projectId, 'interview');
  if (interviewSnapshot) {
    const data = interviewSnapshot.data as { interviewId?: number; status?: string };
    if (data.interviewId && data.status === 'in_progress') {
      await ctx.db.prepare(`
        UPDATE interviews SET status = 'in_progress' WHERE id = ?
      `).bind(data.interviewId).run();
      details.push(`Restored interview ${data.interviewId} to in_progress`);
      snapshotsRestored++;
    }
  }

  // Check for workflow snapshot
  const workflowSnapshot = await getLatestSnapshot(ctx, projectId, 'workflow');
  if (workflowSnapshot) {
    const data = workflowSnapshot.data as { tasks?: number[] };
    if (data.tasks) {
      for (const taskId of data.tasks) {
        await ctx.db.prepare(`
          UPDATE tasks SET status = 'pending' WHERE id = ? AND status = 'building'
        `).bind(taskId).run();
      }
      details.push(`Restored ${data.tasks.length} tasks from workflow snapshot`);
      snapshotsRestored++;
    }
  }

  return {
    recovered: snapshotsRestored > 0,
    snapshotsRestored,
    details,
  };
}
