/**
 * Orchestration Module - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Public API for the real-agent-orchestration layer.
 *
 * Usage:
 *   import { getManagerController } from "./orchestration";
 *   const controller = getManagerController(env);
 *   const result = await controller.executeRequest({ ... });
 */

export { ManagerController, getManagerController } from "./manager-controller";
export type { UserRequest, ManagerDecision, WorkflowResult } from "./manager-controller";

export {
  AgentMessageBuilder,
  AgentMessageLog,
  agentMessageLog,
  deliver,
  validateMessage,
} from "./agent-communication";
export type {
  AgentMessage,
  AgentRole,
  MessageKind,
  MessageStatus,
  ManagerToBuilderPayload,
  BuilderToReviewerPayload,
  ReviewerToManagerPayload,
  ManagerToReviewerPayload,
  ManagerToBuilderAckPayload,
  SystemPayload,
  RepositoryContext,
  MemoryContext,
  PatchArtifact,
  ChangedFile,
  ReviewIssue,
} from "./agent-communication";

export {
  WORKFLOW_STAGES,
  FORWARD_ORDER,
  createWorkflowState,
  transition,
  isValidTransition,
  assertTransition,
  progressPercent,
} from "./workflow";
export type { WorkflowStage, StageDefinition, WorkflowState } from "./workflow";
