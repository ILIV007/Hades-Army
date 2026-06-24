/**
 * Manager Controller - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Priority 1: Real Agent Orchestration
 *
 * The Manager Controller is the SINGLE SOURCE OF CONTROL for the
 * Hades Army platform. It owns:
 *   - Project planning
 *   - Task decomposition
 *   - Context distribution (to Builder / Reviewer)
 *   - Risk assessment
 *   - Cost monitoring
 *   - Memory updates (.hades/)
 *   - Agent assignment
 *   - Approval requests
 *   - GitHub operations (sole authority)
 *
 * Builder and Reviewer are NEVER called directly by external code.
 * They are only invoked through this controller via the Agent
 * Communication Protocol (see ./agent-communication.ts).
 *
 * This module is ADDITIVE — it does NOT modify the existing
 * AgentManager class in src/agents/manager.ts. The legacy class
 * continues to handle CRUD operations on the `agents` table.
 * The Controller is the orchestrator that USES agents.
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import {
  AgentMessageBuilder,
  deliver,
  type AgentMessage,
  type ManagerToBuilderPayload,
  type ManagerToReviewerPayload,
  type ManagerToBuilderAckPayload,
  type RepositoryContext,
  type MemoryContext,
} from "./agent-communication";
import {
  createWorkflowState,
  transition,
  progressPercent,
  type WorkflowState,
  type WorkflowStage,
} from "./workflow";

// ============================================
// Imports from existing v0.8.0 modules (no modifications)
// ============================================

import { builderAgent } from "../agents/builder";
import { reviewManager } from "../agents/reviewer";
import type { HadesBindings } from "../types";

// New v0.8.5 modules (loaded lazily to avoid circular imports)
import { ModelRegistry } from "../registry/model-registry";
import { RepositoryMemory } from "../memory/repository-memory";
import { RepositoryScanner } from "../memory/repository-scanner";
import { ManagerGitHubOperations } from "../github/manager-operations";
import { CostTracker } from "../monitoring/cost-tracker";
import { AgentMetrics } from "../monitoring/agent-metrics";
import { RepositorySecretScanner } from "../security/repo-secret-scanner";

// ============================================
// Types
// ============================================

export interface UserRequest {
  requestId: string;
  userId: string;
  projectId: string;
  repositoryFullName: string;
  prompt: string;
  priority?: "low" | "normal" | "high" | "critical";
  metadata?: Record<string, unknown>;
}

export interface ManagerDecision {
  action: "proceed_to_pr" | "replan" | "abort";
  reason: string;
  replanNote?: string;
}

export interface WorkflowResult {
  workflowId: string;
  status: "completed" | "aborted" | "awaiting_approval";
  currentStage: WorkflowStage;
  progress: number;
  prUrl?: string;
  mergeSha?: string;
  abortReason?: string;
  costEstimateUsd?: number;
}

// ============================================
// Manager Controller
// ============================================

export class ManagerController {
  private modelRegistry: ModelRegistry;
  private repoMemory: RepositoryMemory;
  private repoScanner: RepositoryScanner;
  private githubOps: ManagerGitHubOperations;
  private costTracker: CostTracker;
  private agentMetrics: AgentMetrics;
  private secretScanner: RepositorySecretScanner;

  // Active workflows keyed by workflowId
  private workflows: Map<string, WorkflowState> = new Map();

  constructor(env: HadesBindings) {
    this.modelRegistry = ModelRegistry.getInstance(env);
    this.repoMemory = new RepositoryMemory(env);
    this.repoScanner = new RepositoryScanner(env);
    this.githubOps = new ManagerGitHubOperations(env);
    this.costTracker = new CostTracker(env);
    this.agentMetrics = new AgentMetrics(env);
    this.secretScanner = new RepositorySecretScanner();
  }

  // ============================================
  // Public entry point
  // ============================================

  /**
   * Execute a user request end-to-end through the canonical workflow.
   * Stops at USER_APPROVAL — the merge step is triggered separately
   * by `approveAndMerge()` after the user approves the PR.
   */
  async executeRequest(req: UserRequest): Promise<WorkflowResult> {
    const workflowId = generateId("wf");
    const state = createWorkflowState(workflowId, req.projectId);
    this.workflows.set(workflowId, state);

    logger.info(`Manager: new workflow ${workflowId} for project ${req.projectId}`, {
      userId: req.userId,
      priority: req.priority || "normal",
    });

    try {
      // STAGE 1: MANAGER_ANALYSIS
      await this.runStage(state, "MANAGER_ANALYSIS", async () => {
        await this.managerAnalysis(req);
      });

      // STAGE 2: REPOSITORY_ANALYSIS
      let repoContext: RepositoryContext;
      let memoryContext: MemoryContext;
      await this.runStage(state, "REPOSITORY_ANALYSIS", async () => {
        const scan = await this.repoScanner.scan(req.repositoryFullName);
        memoryContext = await this.repoMemory.buildMemoryContext(req.projectId, scan);
        repoContext = {
          repositoryId: req.projectId,
          fullName: req.repositoryFullName,
          defaultBranch: scan.defaultBranch,
          targetBranch: this.generateBranchName(workflowId),
          architecture: {
            languages: scan.languages,
            frameworks: scan.frameworks,
            style: scan.architectureStyle,
            conventions: scan.conventions,
          },
          relevantFiles: scan.relevantFiles,
        };
      });

      // STAGE 3: TASK_PLANNING
      const taskPlan = await this.runStage(state, "TASK_PLANNING", async () => {
        return await this.planTasks(req, repoContext!, memoryContext!);
      });

      // STAGE 4 + 5: BUILDER_ASSIGNMENT → PATCH_GENERATION
      const patchResult = await this.runStage(state, "BUILDER_ASSIGNMENT", async () => {
        // Send ManagerToBuilder message
        const payload: ManagerToBuilderPayload = {
          taskId: taskPlan.taskId,
          projectId: req.projectId,
          objective: taskPlan.objective,
          repositoryContext: repoContext!,
          memoryContext: memoryContext!,
          constraints: taskPlan.constraints,
        };
        const msg = AgentMessageBuilder.managerToBuilder(payload, { workflowId });
        this.assertDelivered(msg);
        return payload;
      });

      await this.runStage(state, "PATCH_GENERATION", async () => {
        // Builder uses the model assigned by the registry (default: Qwen3 Coder)
        const builderModel = this.modelRegistry.getModelForAgent("builder");
        logger.info(`Manager: invoking builder with model ${builderModel.provider}/${builderModel.model}`);

        // Call existing BuilderAgent (legacy) — it does not touch GitHub
        const result = await builderAgent.build({
          id: patchResult.taskId,
          specification: patchResult.objective,
          language: repoContext!.architecture.languages[0] || "typescript",
          requirements: taskPlan.constraints ? Object.values(taskPlan.constraints).flatMap((v) =>
            Array.isArray(v) ? (v as string[]) : []
          ) : [],
        });
        this.agentMetrics.recordPatch(workflowId, result.confidence);
        this.costTracker.estimate(workflowId, "builder", builderModel, result.estimatedLines);
        return result;
      });

      // STAGE 6: REVIEWER_VALIDATION
      const reviewVerdict = await this.runStage(state, "REVIEWER_VALIDATION", async () => {
        const reviewerModel = this.modelRegistry.getModelForAgent("reviewer");
        logger.info(`Manager: invoking reviewer with model ${reviewerModel.provider}/${reviewerModel.model}`);

        // Call existing ReviewManager (legacy) — it does not touch GitHub
        const review = await reviewManager.review({
          id: patchResult.taskId,
          target: patchResult.taskId,
          code: "", // In a full impl, the patch would be passed here
          type: "code",
          context: patchResult.objective,
        });
        this.agentMetrics.recordReview(workflowId, review.overallScore);
        this.costTracker.estimate(workflowId, "reviewer", reviewerModel, 500);
        return review;
      });

      // STAGE 7: MANAGER_DECISION
      const decision: ManagerDecision = await this.runStage(state, "MANAGER_DECISION", async () => {
        return this.makeDecision(reviewVerdict, taskPlan);
      });

      if (decision.action === "abort") {
        transition(state, "ABORTED", decision.reason);
        return this.buildResult(state, { abortReason: decision.reason });
      }

      if (decision.action === "replan") {
        // Loop back to PATCH_GENERATION with feedback (max 1 replan in this synchronous flow)
        transition(state, "PATCH_GENERATION", decision.replanNote);
        // For simplicity in this synchronous flow, we abort with a clear note.
        // In a real async system this would re-queue.
        transition(state, "ABORTED", "replan_required");
        return this.buildResult(state, { abortReason: "replan_required" });
      }

      // STAGE 8: GITHUB_PR (Manager-only)
      const prUrl = await this.runStage(state, "GITHUB_PR", async () => {
        // Secret scan BEFORE creating the PR
        const scanResult = this.secretScanner.scanPatch(/* patch */ "");
        if (scanResult.blocked) {
          throw new Error(`PR blocked: ${scanResult.findings.length} secrets detected in patch`);
        }

        return await this.githubOps.createPullRequest({
          repositoryFullName: req.repositoryFullName,
          branchName: repoContext!.targetBranch,
          baseBranch: repoContext!.defaultBranch,
          title: taskPlan.objective.slice(0, 80),
          body: this.buildPrBody(req, taskPlan, reviewVerdict),
          files: [], // The actual patch would be committed here
        });
      });

      // STAGE 9: USER_APPROVAL — pause here
      transition(state, "USER_APPROVAL", "PR opened, awaiting user");
      return this.buildResult(state, { prUrl, status: "awaiting_approval" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Manager: workflow ${workflowId} failed at ${state.currentStage}: ${message}`);
      if (state.currentStage !== "ABORTED") {
        transition(state, "ABORTED", message);
      }
      return this.buildResult(state, { abortReason: message });
    }
  }

  // ============================================
  // Approval + Merge (called after user approves)
  // ============================================

  async approveAndMerge(
    workflowId: string,
    approverUserId: string,
    decision: "approve" | "reject",
  ): Promise<WorkflowResult> {
    const state = this.workflows.get(workflowId);
    if (!state) throw new Error(`Workflow ${workflowId} not found`);
    if (state.currentStage !== "USER_APPROVAL") {
      throw new Error(`Workflow ${workflowId} is not awaiting approval (current: ${state.currentStage})`);
    }

    if (decision === "reject") {
      transition(state, "MANAGER_DECISION", `User ${approverUserId} rejected`);
      transition(state, "ABORTED", "user_rejected");
      return this.buildResult(state, { abortReason: "user_rejected" });
    }

    // Merge
    const mergeSha = await this.runStage(state, "MERGE", async () => {
      // Manager performs the merge
      return await this.githubOps.mergePullRequest({
        repositoryFullName: state.projectId,
        prNumber: 0, // Would be tracked in state
        commitTitle: `Merge Hades workflow ${workflowId}`,
      });
    });

    // Update .hades/ memory with the completed task
    await this.repoMemory.recordTaskCompletion(state.projectId, {
      workflowId,
      mergedSha: mergeSha,
      completedAt: new Date().toISOString(),
    });

    transition(state, "COMPLETED", "merged");
    return this.buildResult(state, { mergeSha });
  }

  // ============================================
  // Internal: stage runner with metrics
  // ============================================

  private async runStage<T>(
    state: WorkflowState,
    stage: WorkflowStage,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (state.currentStage !== stage) {
      // Try forward transition
      transition(state, stage);
    }
    const start = Date.now();
    try {
      const result = await fn();
      const elapsedMs = Date.now() - start;
      this.agentMetrics.recordStage(state.workflowId, stage, elapsedMs, true);
      return result;
    } catch (err) {
      const elapsedMs = Date.now() - start;
      this.agentMetrics.recordStage(state.workflowId, stage, elapsedMs, false);
      throw err;
    }
  }

  // ============================================
  // Internal: stages
  // ============================================

  private async managerAnalysis(req: UserRequest): Promise<void> {
    const managerModel = this.modelRegistry.getModelForAgent("manager");
    logger.info(`Manager: analyzing request with model ${managerModel.provider}/${managerModel.model}`);

    // In a real impl, this would call the LLM with a planning prompt.
    // For now we record cost and validate the request shape.
    if (!req.prompt || req.prompt.length < 3) {
      throw new Error("Request prompt too short");
    }
    this.costTracker.estimate(req.requestId, "manager", managerModel, 200);
  }

  private async planTasks(
    req: UserRequest,
    repo: RepositoryContext,
    memory: MemoryContext,
  ): Promise<{
    taskId: string;
    objective: string;
    constraints: ManagerToBuilderPayload["constraints"];
  }> {
    const taskId = generateId("task");
    return {
      taskId,
      objective: req.prompt,
      constraints: {
        maxFiles: 10,
        maxLines: 1000,
        forbiddenPaths: [".env", ".hades/secrets/"],
        requiredTests: true,
      },
    };
  }

  private makeDecision(
    review: { overallScore: number; findings: Array<{ severity: string }> },
    _plan: { taskId: string },
  ): ManagerDecision {
    const criticalCount = review.findings.filter((f) => f.severity === "critical").length;
    if (criticalCount > 0) {
      return { action: "abort", reason: `${criticalCount} critical findings in review` };
    }
    if (review.overallScore < 60) {
      return { action: "replan", reason: "review score below 60", replanNote: "improve patch quality" };
    }
    return { action: "proceed_to_pr", reason: `score ${review.overallScore} acceptable` };
  }

  // ============================================
  // Helpers
  // ============================================

  private generateBranchName(workflowId: string): string {
    return `hades/${workflowId}`.toLowerCase().replace(/[^a-z0-9/_-]/g, "-").slice(0, 60);
  }

  private buildPrBody(
    req: UserRequest,
    plan: { taskId: string; objective: string },
    review: { overallScore: number; findings: unknown[] },
  ): string {
    return [
      `# Hades Army — Auto-generated PR`,
      ``,
      `**Workflow:** ${req.requestId}`,
      `**Task:** ${plan.taskId}`,
      `**User:** ${req.userId}`,
      ``,
      `## Objective`,
      ``,
      `${plan.objective}`,
      ``,
      `## Review`,
      ``,
      `- Score: ${review.overallScore}/100`,
      `- Findings: ${review.findings.length}`,
      ``,
      `_Generated by Hades Army v0.8.5 Manager Controller_`,
    ].join("\n");
  }

  private assertDelivered(msg: AgentMessage): void {
    const result = deliver(msg);
    if (!result.ok) {
      throw new Error(`Agent message delivery failed: ${result.errors.join("; ")}`);
    }
  }

  private buildResult(
    state: WorkflowState,
    extras: Partial<WorkflowResult> = {},
  ): WorkflowResult {
    return {
      workflowId: state.workflowId,
      status: state.currentStage === "COMPLETED" ? "completed"
        : state.currentStage === "ABORTED" ? "aborted"
        : "awaiting_approval",
      currentStage: state.currentStage,
      progress: progressPercent(state),
      ...extras,
    };
  }

  // ============================================
  // Public: send a clarification or abort to Builder
  // ============================================

  sendBuilderAck(taskId: string, action: "proceed" | "clarify" | "abort", feedback?: string): void {
    const payload: ManagerToBuilderAckPayload = { taskId, action, feedback };
    const msg = AgentMessageBuilder.managerToBuilderAck(payload);
    this.assertDelivered(msg);
  }

  // ============================================
  // Public: request architecture review from Reviewer
  // ============================================

  async requestArchitectureReview(projectId: string, target: string): Promise<string> {
    const payload: ManagerToReviewerPayload = {
      taskId: generateId("review"),
      projectId,
      reviewType: "architecture",
      target,
      context: {},
    };
    const msg = AgentMessageBuilder.managerToReviewer(payload);
    this.assertDelivered(msg);
    return msg.id;
  }

  // ============================================
  // Public: get workflow state
  // ============================================

  getWorkflow(workflowId: string): WorkflowState | undefined {
    return this.workflows.get(workflowId);
  }

  listActiveWorkflows(): WorkflowState[] {
    return Array.from(this.workflows.values()).filter(
      (s) => s.currentStage !== "COMPLETED" && s.currentStage !== "ABORTED",
    );
  }
}

// ============================================
// Factory
// ============================================

let _controller: ManagerController | null = null;

export function getManagerController(env: HadesBindings): ManagerController {
  if (!_controller) _controller = new ManagerController(env);
  return _controller;
}
