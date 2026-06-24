/**
 * Repository Memory - .hades/ - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Priority 3: Repository Memory System
 *
 * Repository Memory is the HIGHEST AUTHORITY in the memory hierarchy:
 *
 *   Repository Memory (.hades/)   ← source of truth
 *        ↓
 *   D1 (project database)
 *        ↓
 *   KV (ephemeral cache)
 *
 * Every connected repository MUST contain a `.hades/` directory with
 * the following structure:
 *
 *   .hades/
 *     project.json          — canonical project metadata
 *     architecture.md       — system architecture, modules, deps
 *     roadmap.md            — milestones, tasks, status
 *     decisions.md          — Architecture Decision Records (ADRs)
 *     tasks/                — one file per task (open + closed)
 *     reviews/              — one file per review verdict
 *     failures/             — failed attempts (Manager learns from these)
 *     knowledge/            — free-form notes the Manager has accumulated
 *     metrics/              — cost / patch / review metrics
 *
 * This module provides read/write helpers for all of the above. The
 * Manager is the SOLE writer — Builder and Reviewer consume context
 * via the Agent Communication Protocol, never by reading .hades/ directly.
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export interface ProjectMeta {
  projectId: string;
  repositoryFullName: string;
  displayName: string;
  description: string;
  defaultBranch: string;
  languages: string[];
  frameworks: string[];
  architectureStyle: string;
  createdAt: string;
  updatedAt: string;
  version: string;
  status: "onboarding" | "active" | "paused" | "archived";
}

export interface ArchitectureDoc {
  summary: string;
  modules: Array<{ name: string; responsibility: string; dependsOn: string[] }>;
  dependencyGraph: string;
  codingConventions: string[];
  designDecisions: Array<{ id: string; title: string; rationale: string }>;
  updatedAt: string;
}

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  status: "planned" | "in_progress" | "completed" | "abandoned";
  priority: "low" | "normal" | "high" | "critical";
  estimatedEffort?: string;
  dependsOn?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DecisionRecord {
  id: string;
  title: string;
  status: "proposed" | "accepted" | "rejected" | "deprecated";
  context: string;
  decision: string;
  consequences: string;
  decidedAt: string;
  decidedBy: string;
}

export interface TaskRecord {
  id: string;
  workflowId: string;
  objective: string;
  status: "planned" | "in_progress" | "in_review" | "merged" | "aborted";
  branch?: string;
  prUrl?: string;
  mergedSha?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ReviewRecord {
  id: string;
  taskId: string;
  score: number;
  status: "approved" | "rejected" | "changes_requested";
  findings: Array<{ severity: string; category: string; message: string }>;
  summary: string;
  createdAt: string;
}

export interface FailureRecord {
  id: string;
  taskId: string;
  stage: string;
  summary: string;
  rootCause: string;
  lesson: string;
  preventionRule: string;
  createdAt: string;
}

export interface KnowledgeNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RepoMemoryMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalReviews: number;
  averageReviewScore: number;
  totalCostUsd: number;
  totalFailures: number;
  lastUpdated: string;
}

export interface RepositoryScanResult {
  repositoryFullName: string;
  defaultBranch: string;
  languages: string[];
  frameworks: string[];
  architectureStyle: string;
  conventions: string[];
  relevantFiles: Array<{ path: string; content: string; reason: string }>;
  dependencyGraph?: string;
}

export interface MemoryContext {
  projectMemory: {
    architecture: unknown;
    roadmap: unknown;
    conventions: string[];
  };
  relevantDecisions: Array<{ id: string; title: string; rationale: string }>;
  pastFailures: Array<{ id: string; summary: string; lesson: string }>;
  knowledgeNotes: string[];
}

// ============================================
// Path constants inside the repo
// ============================================

export const HADES_DIR = ".hades";
export const HADES_PATHS = {
  projectJson: `${HADES_DIR}/project.json`,
  architecture: `${HADES_DIR}/architecture.md`,
  roadmap: `${HADES_DIR}/roadmap.md`,
  decisions: `${HADES_DIR}/decisions.md`,
  tasksDir: `${HADES_DIR}/tasks`,
  reviewsDir: `${HADES_DIR}/reviews`,
  failuresDir: `${HADES_DIR}/failures`,
  knowledgeDir: `${HADES_DIR}/knowledge`,
  metricsDir: `${HADES_DIR}/metrics`,
  metricsJson: `${HADES_DIR}/metrics/metrics.json`,
} as const;

// ============================================
// Repository Memory class
// ============================================

export class RepositoryMemory {
  private env: HadesBindings;

  // In-memory cache of loaded memory per project (KV-backed on workers)
  private cache: Map<string, { project: ProjectMeta; loadedAt: string }> = new Map();

  constructor(env: HadesBindings) {
    this.env = env;
  }

  // ============================================
  // Initialization (called once per repo on onboarding)
  // ============================================

  async initializeRepository(
    projectId: string,
    scan: RepositoryScanResult,
  ): Promise<ProjectMeta> {
    const now = new Date().toISOString();
    const project: ProjectMeta = {
      projectId,
      repositoryFullName: scan.repositoryFullName,
      displayName: scan.repositoryFullName.split("/").pop() || scan.repositoryFullName,
      description: "",
      defaultBranch: scan.defaultBranch,
      languages: scan.languages,
      frameworks: scan.frameworks,
      architectureStyle: scan.architectureStyle,
      createdAt: now,
      updatedAt: now,
      version: "0.8.5",
      status: "active",
    };

    // Write to KV (in production, these would also be committed to the repo
    // via ManagerGitHubOperations.createPullRequest or direct commit to a
    // `hades/memory` branch)
    await this.writeJson(HADES_PATHS.projectJson, project);

    const architecture: ArchitectureDoc = {
      summary: `Architecture auto-detected for ${scan.repositoryFullName}.`,
      modules: [],
      dependencyGraph: scan.dependencyGraph || "",
      codingConventions: scan.conventions,
      designDecisions: [],
      updatedAt: now,
    };
    await this.writeJson(`${HADES_DIR}/architecture.json`, architecture);

    await this.writeJson(`${HADES_DIR}/roadmap.json`, { items: [] as RoadmapItem[], updatedAt: now });
    await this.writeJson(`${HADES_DIR}/decisions.json`, { items: [] as DecisionRecord[], updatedAt: now });
    await this.writeJson(HADES_PATHS.metricsJson, {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalReviews: 0,
      averageReviewScore: 0,
      totalCostUsd: 0,
      totalFailures: 0,
      lastUpdated: now,
    } satisfies RepoMemoryMetrics);

    this.cache.set(projectId, { project, loadedAt: now });
    logger.info(`RepositoryMemory initialized for ${project.repositoryFullName}`, { projectId });
    return project;
  }

  // ============================================
  // Read: project meta
  // ============================================

  async getProject(projectId: string): Promise<ProjectMeta | undefined> {
    const cached = this.cache.get(projectId);
    if (cached && Date.now() - new Date(cached.loadedAt).getTime() < 60_000) {
      return cached.project;
    }
    const project = await this.readJson<ProjectMeta>(HADES_PATHS.projectJson);
    if (project) {
      this.cache.set(projectId, { project, loadedAt: new Date().toISOString() });
    }
    return project;
  }

  // ============================================
  // Read: build full memory context for an agent
  // ============================================

  async buildMemoryContext(
    projectId: string,
    _scan: RepositoryScanResult,
  ): Promise<MemoryContext> {
    const [architecture, roadmap, decisions, failures, knowledge] = await Promise.all([
      this.readJson<ArchitectureDoc>(`${HADES_DIR}/architecture.json`),
      this.readJson<{ items: RoadmapItem[] }>(`${HADES_DIR}/roadmap.json`),
      this.readJson<{ items: DecisionRecord[] }>(`${HADES_DIR}/decisions.json`),
      this.readJson<{ items: FailureRecord[] }>(`${HADES_DIR}/failures.json`),
      this.readJson<{ items: KnowledgeNote[] }>(`${HADES_DIR}/knowledge.json`),
    ]);

    return {
      projectMemory: {
        architecture: architecture ?? null,
        roadmap: roadmap?.items ?? [],
        conventions: architecture?.codingConventions ?? [],
      },
      relevantDecisions: (decisions?.items ?? []).slice(-10).map((d) => ({
        id: d.id,
        title: d.title,
        rationale: d.decision,
      })),
      pastFailures: (failures?.items ?? []).slice(-5).map((f) => ({
        id: f.id,
        summary: f.summary,
        lesson: f.lesson,
      })),
      knowledgeNotes: (knowledge?.items ?? []).slice(-5).map((k) => `# ${k.title}\n${k.content}`),
    };
  }

  // ============================================
  // Write: task lifecycle
  // ============================================

  async recordTaskStart(projectId: string, task: Omit<TaskRecord, "id" | "createdAt" | "updatedAt" | "status"> & { status?: TaskRecord["status"] }): Promise<TaskRecord> {
    const now = new Date().toISOString();
    const record: TaskRecord = {
      id: generateId("task"),
      workflowId: task.workflowId,
      objective: task.objective,
      status: task.status ?? "planned",
      branch: task.branch,
      prUrl: task.prUrl,
      mergedSha: task.mergedSha,
      createdAt: now,
      updatedAt: now,
    };
    await this.appendToJsonArray(`${HADES_DIR}/tasks/open.json`, record);
    await this.bumpMetric("totalTasks");
    logger.info(`RepositoryMemory: task started ${record.id}`, { projectId });
    return record;
  }

  async recordTaskCompletion(projectId: string, completion: { workflowId: string; mergedSha: string; completedAt: string }): Promise<void> {
    // Move task from open.json to closed.json with merged status
    const open = await this.readJson<{ items: TaskRecord[] }>(`${HADES_DIR}/tasks/open.json`);
    const task = (open?.items ?? []).find((t) => t.workflowId === completion.workflowId);
    if (task) {
      task.status = "merged";
      task.mergedSha = completion.mergedSha;
      task.completedAt = completion.completedAt;
      task.updatedAt = completion.completedAt;
      await this.writeJson(`${HADES_DIR}/tasks/open.json`, {
        items: (open?.items ?? []).filter((t) => t.workflowId !== completion.workflowId),
      });
      await this.appendToJsonArray(`${HADES_DIR}/tasks/closed.json`, task);
      await this.bumpMetric("completedTasks");
      logger.info(`RepositoryMemory: task completed ${task.id}`, { projectId, mergedSha: completion.mergedSha });
    }
  }

  async recordTaskFailure(projectId: string, failure: Omit<FailureRecord, "id" | "createdAt">): Promise<FailureRecord> {
    const record: FailureRecord = {
      id: generateId("fail"),
      ...failure,
      createdAt: new Date().toISOString(),
    };
    await this.appendToJsonArray(`${HADES_DIR}/failures.json`, record);
    await this.bumpMetric("totalFailures");
    logger.warn(`RepositoryMemory: failure recorded ${record.id}`, { projectId, stage: failure.stage });
    return record;
  }

  // ============================================
  // Write: review verdict
  // ============================================

  async recordReview(projectId: string, review: Omit<ReviewRecord, "id" | "createdAt">): Promise<ReviewRecord> {
    const record: ReviewRecord = {
      id: generateId("rev"),
      ...review,
      createdAt: new Date().toISOString(),
    };
    await this.appendToJsonArray(`${HADES_DIR}/reviews.json`, record);
    await this.bumpMetric("totalReviews");
    logger.info(`RepositoryMemory: review recorded ${record.id}`, { projectId, score: review.score });
    return record;
  }

  // ============================================
  // Write: architecture decision record (ADR)
  // ============================================

  async recordDecision(projectId: string, decision: Omit<DecisionRecord, "id" | "decidedAt">): Promise<DecisionRecord> {
    const record: DecisionRecord = {
      id: generateId("adr"),
      ...decision,
      decidedAt: new Date().toISOString(),
    };
    await this.appendToJsonArray(`${HADES_DIR}/decisions.json`, record);
    logger.info(`RepositoryMemory: ADR recorded ${record.id}`, { projectId, title: record.title });
    return record;
  }

  // ============================================
  // Write: knowledge note
  // ============================================

  async addKnowledgeNote(projectId: string, note: Omit<KnowledgeNote, "id" | "createdAt" | "updatedAt">): Promise<KnowledgeNote> {
    const now = new Date().toISOString();
    const record: KnowledgeNote = {
      id: generateId("kn"),
      ...note,
      createdAt: now,
      updatedAt: now,
    };
    await this.appendToJsonArray(`${HADES_DIR}/knowledge.json`, record);
    logger.info(`RepositoryMemory: knowledge note added ${record.id}`, { projectId, title: record.title });
    return record;
  }

  // ============================================
  // Read: metrics
  // ============================================

  async getMetrics(projectId: string): Promise<RepoMemoryMetrics | undefined> {
    return this.readJson<RepoMemoryMetrics>(HADES_PATHS.metricsJson);
  }

  // ============================================
  // Memory hierarchy: fall back to D1 / KV if .hades/ missing
  // ============================================

  /**
   * Returns true if .hades/project.json exists for the given project.
   * If not, callers should either:
   *   (a) trigger onboarding via RepositoryScanner + initializeRepository, OR
   *   (b) fall back to D1 (legacy memory) — the lower authority.
   */
  async isInitialized(projectId: string): Promise<boolean> {
    const project = await this.getProject(projectId);
    return !!project;
  }

  // ============================================
  // Private: KV-backed storage helpers
  // ============================================

  private kvKey(projectId: string, repoPath: string): string {
    return `repo-memory:${projectId}:${repoPath}`;
  }

  private async readJson<T>(repoPath: string): Promise<T | undefined> {
    // KV is the access layer for .hades/ files in v0.8.5.
    // In a full impl, this would also sync with the actual git repo via
    // ManagerGitHubOperations.readFile() / writeFile().
    if (!this.env.HADES_KV) return undefined;
    const raw = await this.env.HADES_KV.get(this.kvKey(this.currentProjectId, repoPath));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  private currentProjectId = "default";

  /** Set the active project for subsequent reads/writes (called by ManagerController). */
  setProjectContext(projectId: string): void {
    this.currentProjectId = projectId;
  }

  private async writeJson(repoPath: string, data: unknown): Promise<void> {
    if (!this.env.HADES_KV) return;
    await this.env.HADES_KV.put(this.kvKey(this.currentProjectId, repoPath), JSON.stringify(data));
  }

  private async appendToJsonArray<T>(repoPath: string, item: T): Promise<void> {
    const existing = await this.readJson<{ items: T[] }>(repoPath);
    const items = existing?.items ?? [];
    items.push(item);
    await this.writeJson(repoPath, { items });
  }

  private async bumpMetric(field: keyof RepoMemoryMetrics): Promise<void> {
    const metrics = (await this.getMetrics(this.currentProjectId)) ?? {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalReviews: 0,
      averageReviewScore: 0,
      totalCostUsd: 0,
      totalFailures: 0,
      lastUpdated: new Date().toISOString(),
    };
    (metrics[field] as number) = ((metrics[field] as number) ?? 0) + 1;
    metrics.lastUpdated = new Date().toISOString();
    await this.writeJson(HADES_PATHS.metricsJson, metrics);
  }
}
