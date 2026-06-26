/**
 * Project Brain - Cloudflare Workers Edition
 * Hades Army v0.10 — Project Brain
 *
 * Each repository has its OWN Project Brain — a structured knowledge
 * base stored in KV (keyed by repository ID). In production, this
 * would be mirrored to the actual .hades/ directory in the repo
 * via git commits.
 *
 * Structure:
 *   brain:<repoId>/
 *     architecture.json
 *     knowledge.json
 *     tasks.json
 *     timeline.json
 *     decisions.json
 *     tech-debt.json
 *     contracts.json
 *     impact-map.json
 *     dependency-graph.json
 *     current-context.json
 *     review-history.json
 *     agent-memory.json
 *     state.json
 *     metrics.json
 */

import { logger } from "../utils/logger";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export interface ProjectBrain {
  repositoryId: string;
  repositoryFullName: string;
  architecture: ArchitectureBrain;
  knowledge: KnowledgeBrain;
  tasks: TaskBrain;
  timeline: TimelineBrain;
  decisions: DecisionBrain;
  techDebt: TechDebtBrain;
  currentContext: CurrentContext;
  reviewHistory: ReviewHistoryBrain;
  agentMemory: AgentMemoryBrain;
  state: BrainState;
  metrics: BrainMetrics;
  createdAt: string;
  updatedAt: string;
}

export interface ArchitectureBrain {
  pattern: string;
  languages: string[];
  frameworks: string[];
  modules: Array<{ name: string; responsibility: string; dependsOn: string[] }>;
  conventions: string[];
}

export interface KnowledgeBrain {
  notes: Array<{ id: string; title: string; content: string; tags: string[]; createdAt: string }>;
  lessonsLearned: Array<{ id: string; summary: string; lesson: string; createdAt: string }>;
}

export interface TaskBrain {
  open: Array<{ id: string; objective: string; status: string; createdAt: string }>;
  completed: Array<{ id: string; objective: string; completedAt: string }>;
  failed: Array<{ id: string; objective: string; reason: string; failedAt: string }>;
}

export interface TimelineBrain {
  events: Array<{ id: string; timestamp: string; type: string; detail: string }>;
}

export interface DecisionBrain {
  adrs: Array<{ id: string; title: string; context: string; decision: string; status: string; decidedAt: string }>;
}

export interface TechDebtBrain {
  items: Array<{ id: string; type: string; file: string; line: number; severity: string; snippet: string }>;
  score: number;
}

export interface CurrentContext {
  activeBranch: string;
  lastCommit: string | null;
  lastReview: string | null;
  lastTask: string | null;
  currentMode: string;
}

export interface ReviewHistoryBrain {
  reviews: Array<{ id: string; taskId: string; score: number; status: string; createdAt: string }>;
}

export interface AgentMemoryBrain {
  managerDecisions: Array<{ id: string; timestamp: string; decision: string; reason: string }>;
  builderPatches: Array<{ id: string; timestamp: string; files: string[]; confidence: number }>;
  reviewerVerdicts: Array<{ id: string; timestamp: string; status: string; issues: number }>;
}

export interface BrainState {
  scanComplete: boolean;
  architectureDetected: boolean;
  memoryInitialized: boolean;
  readyForWork: boolean;
}

export interface BrainMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalReviews: number;
  averageReviewScore: number;
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  lastUpdated: string;
}

// ============================================
// Project Brain Manager
// ============================================

const BRAIN_KV_PREFIX = "brain:";

export class ProjectBrainManager {
  private env: HadesBindings;

  constructor(env: HadesBindings) {
    this.env = env;
  }

  /**
   * Initialize a new Project Brain for a repository.
   */
  async initialize(repositoryId: string, repositoryFullName: string): Promise<ProjectBrain> {
    const now = new Date().toISOString();
    const brain: ProjectBrain = {
      repositoryId,
      repositoryFullName,
      architecture: {
        pattern: "unknown",
        languages: [],
        frameworks: [],
        modules: [],
        conventions: [],
      },
      knowledge: { notes: [], lessonsLearned: [] },
      tasks: { open: [], completed: [], failed: [] },
      timeline: { events: [] },
      decisions: { adrs: [] },
      techDebt: { items: [], score: 0 },
      currentContext: {
        activeBranch: "main",
        lastCommit: null,
        lastReview: null,
        lastTask: null,
        currentMode: "plan",
      },
      reviewHistory: { reviews: [] },
      agentMemory: {
        managerDecisions: [],
        builderPatches: [],
        reviewerVerdicts: [],
      },
      state: {
        scanComplete: false,
        architectureDetected: false,
        memoryInitialized: true,
        readyForWork: false,
      },
      metrics: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        totalReviews: 0,
        averageReviewScore: 0,
        totalCostUsd: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        lastUpdated: now,
      },
      createdAt: now,
      updatedAt: now,
    };

    await this.save(brain);
    logger.info("ProjectBrain: initialized", { repositoryId, repositoryFullName });
    return brain;
  }

  /**
   * Load the Project Brain for a repository.
   */
  async load(repositoryId: string): Promise<ProjectBrain | undefined> {
    if (!this.env.HADES_KV) return undefined;
    const raw = await this.env.HADES_KV.get(`${BRAIN_KV_PREFIX}${repositoryId}`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as ProjectBrain;
    } catch {
      return undefined;
    }
  }

  /**
   * Save the Project Brain.
   */
  async save(brain: ProjectBrain): Promise<void> {
    if (!this.env.HADES_KV) return;
    brain.updatedAt = new Date().toISOString();
    brain.metrics.lastUpdated = brain.updatedAt;
    await this.env.HADES_KV.put(`${BRAIN_KV_PREFIX}${brain.repositoryId}`, JSON.stringify(brain));
  }

  /**
   * Update architecture in the brain.
   */
  async updateArchitecture(
    repositoryId: string,
    architecture: Partial<ArchitectureBrain>,
  ): Promise<void> {
    const brain = await this.load(repositoryId);
    if (!brain) return;
    brain.architecture = { ...brain.architecture, ...architecture };
    brain.state.architectureDetected = true;
    await this.save(brain);
  }

  /**
   * Add a timeline event.
   */
  async addTimelineEvent(
    repositoryId: string,
    type: string,
    detail: string,
  ): Promise<void> {
    const brain = await this.load(repositoryId);
    if (!brain) return;
    brain.timeline.events.push({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      type,
      detail,
    });
    // Keep last 200 events
    if (brain.timeline.events.length > 200) {
      brain.timeline.events = brain.timeline.events.slice(-200);
    }
    await this.save(brain);
  }

  /**
   * Add a knowledge note.
   */
  async addKnowledgeNote(
    repositoryId: string,
    title: string,
    content: string,
    tags: string[] = [],
  ): Promise<void> {
    const brain = await this.load(repositoryId);
    if (!brain) return;
    brain.knowledge.notes.push({
      id: `kn_${Date.now()}`,
      title,
      content,
      tags,
      createdAt: new Date().toISOString(),
    });
    await this.save(brain);
  }

  /**
   * Add a lesson learned.
   */
  async addLessonLearned(
    repositoryId: string,
    summary: string,
    lesson: string,
  ): Promise<void> {
    const brain = await this.load(repositoryId);
    if (!brain) return;
    brain.knowledge.lessonsLearned.push({
      id: `ll_${Date.now()}`,
      summary,
      lesson,
      createdAt: new Date().toISOString(),
    });
    await this.save(brain);
  }

  /**
   * Update current context.
   */
  async updateContext(
    repositoryId: string,
    context: Partial<CurrentContext>,
  ): Promise<void> {
    const brain = await this.load(repositoryId);
    if (!brain) return;
    brain.currentContext = { ...brain.currentContext, ...context };
    await this.save(brain);
  }

  /**
   * Mark scan as complete.
   */
  async markScanComplete(repositoryId: string): Promise<void> {
    const brain = await this.load(repositoryId);
    if (!brain) return;
    brain.state.scanComplete = true;
    brain.state.readyForWork = true;
    await this.save(brain);
  }

  /**
   * Get a summary of the brain for display.
   */
  async getSummary(repositoryId: string): Promise<string> {
    const brain = await this.load(repositoryId);
    if (!brain) return "No Project Brain found.";

    return [
      `🧠 *Project Brain* — \`${brain.repositoryFullName}\``,
      ``,
      `*Architecture:*`,
      `• Pattern: ${brain.architecture.pattern}`,
      `• Languages: ${brain.architecture.languages.join(", ") || "none"}`,
      `• Frameworks: ${brain.architecture.frameworks.join(", ") || "none"}`,
      ``,
      `*State:*`,
      `• Scan complete: ${brain.state.scanComplete ? "✅" : "❌"}`,
      `• Architecture detected: ${brain.state.architectureDetected ? "✅" : "❌"}`,
      `• Ready for work: ${brain.state.readyForWork ? "✅" : "❌"}`,
      ``,
      `*Current Context:*`,
      `• Branch: \`${brain.currentContext.activeBranch}\``,
      `• Mode: ${brain.currentContext.currentMode}`,
      `• Last commit: ${brain.currentContext.lastCommit ?? "none"}`,
      ``,
      `*Knowledge:*`,
      `• Notes: ${brain.knowledge.notes.length}`,
      `• Lessons: ${brain.knowledge.lessonsLearned.length}`,
      ``,
      `*Tasks:*`,
      `• Open: ${brain.tasks.open.length}`,
      `• Completed: ${brain.tasks.completed.length}`,
      `• Failed: ${brain.tasks.failed.length}`,
      ``,
      `*Metrics:*`,
      `• Total cost: $${brain.metrics.totalCostUsd.toFixed(4)}`,
      `• Tokens: ${brain.metrics.totalTokensIn.toLocaleString()} in / ${brain.metrics.totalTokensOut.toLocaleString()} out`,
      `• Avg review score: ${brain.metrics.averageReviewScore.toFixed(1)}`,
    ].join("\n");
  }
}

// ============================================
// Factory
// ============================================

let _instance: ProjectBrainManager | null = null;

export function getProjectBrainManager(env: HadesBindings): ProjectBrainManager {
  if (!_instance) _instance = new ProjectBrainManager(env);
  return _instance;
}
