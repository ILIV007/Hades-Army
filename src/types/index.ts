/**
 * Hades Army — Core Type Definitions
 * All types are pure data contracts — no logic.
 */

// ============================================================
// AGENT TYPES
// ============================================================

export type AgentRole = 'manager' | 'builder' | 'reviewer';

export type AgentProvider = 'openrouter' | 'google';

export interface AgentConfig {
  role: AgentRole;
  model: string;
  provider: AgentProvider;
  temperature: number;
  maxTokens: number;
  capabilities: string[];
  restrictions: string[];
}

export interface AgentRegistry {
  manager: AgentConfig;
  builder: AgentConfig;
  reviewer: AgentConfig;
}

export interface AgentRun {
  id: string;
  taskId: string;
  projectId: string;
  agentRole: AgentRole;
  model: string;
  provider: AgentProvider;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costEstimate: number;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  status: 'running' | 'success' | 'failed' | 'timeout';
  output?: string;
  error?: string;
}

// ============================================================
// TASK TYPES
// ============================================================

export type TaskState =
  | 'CREATED'
  | 'PLANNING'
  | 'READY'
  | 'BUILDING'
  | 'REVIEWING'
  | 'PR_CREATED'
  | 'WAITING_APPROVAL'
  | 'MERGED'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'CANCELLED';

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  state: TaskState;
  priority: TaskPriority;
  assignedAgent: AgentRole | null;
  parentTaskId?: string;
  dependencies: string[];
  requiredFiles: string[];
  constraints: string[];
  expectedOutput: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  retryCount: number;
  maxRetries: number;
}

export interface TaskStateTransition {
  id: string;
  taskId: string;
  previousState: TaskState;
  newState: TaskState;
  triggeredBy: AgentRole | 'system' | 'user';
  reason: string;
  timestamp: string;
}

export interface TaskInput {
  taskId: string;
  description: string;
  context: string;
  requiredFiles: string[];
  constraints: string[];
  expectedOutput: string;
  priority: TaskPriority;
  dependencies: string[];
}

// ============================================================
// BUILDER OUTPUT
// ============================================================

export interface BuilderOutput {
  patchDiff: string;
  explanation: string;
  affectedFiles: string[];
  taskId: string;
}

// ============================================================
// REVIEWER OUTPUT
// ============================================================

export type ReviewStatus = 'PASS' | 'FAIL';

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ReviewIssue {
  file: string;
  line?: number;
  severity: IssueSeverity;
  message: string;
  suggestion?: string;
}

export interface ReviewerOutput {
  status: ReviewStatus;
  issues: ReviewIssue[];
  summary: string;
  taskId: string;
  runId: string;
}

// ============================================================
// MANAGER OUTPUT
// ============================================================

export interface ManagerOutput {
  updatedState: TaskState;
  nextAction: string;
  workflowTransition: TaskStateTransition;
  tasksToCreate?: TaskInput[];
  messageToUser?: string;
}

// ============================================================
// PROJECT TYPES
// ============================================================

export type ProjectStatus = 'onboarding' | 'active' | 'paused' | 'archived';

export interface Project {
  id: string;
  userId: string;
  name: string;
  repoUrl: string;
  repoName: string;
  repoOwner: string;
  defaultBranch: string;
  status: ProjectStatus;
  githubTokenEncrypted: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectIndex {
  version: string;
  generatedAt: string;
  files: ProjectIndexFile[];
  modules: ProjectIndexModule[];
  dependencies: ProjectIndexDependency[];
}

export interface ProjectIndexFile {
  path: string;
  type: 'source' | 'config' | 'doc' | 'test' | 'asset';
  size: number;
  lastModified: string;
  module: string;
  features: string[];
}

export interface ProjectIndexModule {
  name: string;
  files: string[];
  dependencies: string[];
  description?: string;
}

export interface ProjectIndexDependency {
  from: string;
  to: string;
  type: 'import' | 'require' | 'reference';
}

// ============================================================
// GITHUB TYPES
// ============================================================

export interface GitHubBranch {
  name: string;
  sha: string;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
  state: 'open' | 'closed' | 'merged';
  url: string;
  htmlUrl: string;
}

export interface GitHubFile {
  path: string;
  content: string;
  sha: string;
}

// ============================================================
// MEMORY TYPES
// ============================================================

export interface HadesMemory {
  version: string;
  projectState: ProjectStateMemory;
  tasks: TaskMemory[];
  reviews: ReviewMemory[];
  decisions: DecisionMemory[];
  context: ContextMemory;
  index: ProjectIndex;
}

export interface ProjectStateMemory {
  currentStatus: string;
  activeTaskId: string | null;
  lastUpdated: string;
  metadata: Record<string, unknown>;
}

export interface TaskMemory {
  taskId: string;
  title: string;
  state: TaskState;
  createdAt: string;
  completedAt?: string;
  result?: string;
}

export interface ReviewMemory {
  reviewId: string;
  taskId: string;
  status: ReviewStatus;
  reviewer: string;
  timestamp: string;
}

export interface DecisionMemory {
  id: string;
  timestamp: string;
  decision: string;
  reason: string;
  irreversible: boolean;
}

export interface ContextMemory {
  recentTasks: string[];
  recentDecisions: string[];
  activeFiles: string[];
  workingNotes: string;
}

// ============================================================
// FILE LOCK TYPES
// ============================================================

export interface FileLock {
  filePath: string;
  taskId: string;
  lockedAt: string;
  expiresAt: string;
}

// ============================================================
// APPROVAL TYPES
// ============================================================

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

export interface Approval {
  id: string;
  taskId: string;
  prNumber: number;
  status: ApprovalStatus;
  requestedAt: string;
  respondedAt?: string;
  responderTelegramId?: number;
  comment?: string;
}

// ============================================================
// MODEL USAGE TYPES
// ============================================================

export interface ModelUsage {
  id: string;
  provider: string;
  model: string;
  tokensUsed: number;
  cost: number;
  success: boolean;
  durationMs: number;
  timestamp: string;
}

// ============================================================
// LOG TYPES
// ============================================================

export type LogType = 'task' | 'agent' | 'github' | 'memory' | 'error' | 'security' | 'workflow';

export interface SystemLog {
  id: string;
  projectId?: string;
  taskId?: string;
  type: LogType;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

// ============================================================
// TELEGRAM TYPES
// ============================================================

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: TelegramMessageEntity[];
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

export interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data: string;
}

// ============================================================
// PROGRESS REPORTING
// ============================================================

export interface ProgressEvent {
  id: string;
  projectId: string;
  taskId?: string;
  stage: string;
  message: string;
  detail?: string;
  percentComplete?: number;
  timestamp: string;
}

// ============================================================
// WORKFLOW TYPES
// ============================================================

export interface WorkflowContext {
  projectId: string;
  taskId: string;
  currentState: TaskState;
  agentRunId?: string;
  githubBranch?: string;
  githubPR?: GitHubPR;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStep {
  id: string;
  workflowId: string;
  stepName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}
