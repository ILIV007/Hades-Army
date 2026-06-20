/**
 * Hades Army v0.6 - Core Types
 * Global type definitions for the entire system
 */

// ============================================================================
// PROJECT TYPES
// ============================================================================

export interface Project {
  id: number;
  name: string;
  description?: string;
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  githubToken?: string;
  status: ProjectStatus;
  complexityScore: number;
  architectureScore: number;
  healthScore: number;
  memoryScore: number;
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
  settings?: ProjectSettings;
}

export type ProjectStatus = 
  | 'pending' 
  | 'interviewing' 
  | 'analyzing' 
  | 'active' 
  | 'paused' 
  | 'archived';

export interface ProjectSettings {
  autoReview: boolean;
  requireApproval: boolean;
  maxConcurrentTasks: number;
  preferredProvider: string;
  notificationChannel?: string;
  secretScanEnabled: boolean;
  architectureCheckEnabled: boolean;
}

// ============================================================================
// TASK TYPES
// ============================================================================

export interface Task {
  id: number;
  projectId: number;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: Priority;
  riskLevel: RiskLevel;
  assignedAgent?: AgentType;
  files?: string[];
  diff?: string;
  reviewComments?: string;
  prUrl?: string;
  prNumber?: number;
  branchName?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type TaskStatus = 
  | 'pending' 
  | 'planning' 
  | 'building' 
  | 'reviewing' 
  | 'approved' 
  | 'merged' 
  | 'failed' 
  | 'rolled_back';

export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// ============================================================================
// AGENT TYPES
// ============================================================================

export type AgentType = 'manager' | 'builder' | 'reviewer';

export interface Agent {
  id: string;
  type: AgentType;
  name: string;
  status: AgentStatus;
  currentTaskId?: number;
  capabilities: string[];
  efficiency: number;
  lastActiveAt?: string;
}

export type AgentStatus = 'idle' | 'working' | 'error' | 'offline';

export interface AgentContext {
  agentId: string;
  projectId: number;
  taskId?: number;
  conversationHistory: Message[];
  repositoryContext: RepositoryContext;
  memoryReferences: string[];
  timestamp: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// REPOSITORY INTELLIGENCE TYPES (Section 1)
// ============================================================================

export interface RepositoryFile {
  id: number;
  projectId: number;
  path: string;
  name: string;
  extension?: string;
  language?: string;
  size: number;
  lines: number;
  complexity: number;
  importanceScore: number;
  lastModified?: string;
  imports?: string[];
  exports?: string[];
  functions?: FunctionSymbol[];
  classes?: ClassSymbol[];
  symbols?: Symbol[];
  dependencies?: string[];
  dependents?: string[];
  isHotspot: boolean;
  technicalDebtScore: number;
}

export interface Symbol {
  id: number;
  projectId: number;
  fileId: number;
  name: string;
  symbolType: SymbolType;
  lineStart?: number;
  lineEnd?: number;
  signature?: string;
  documentation?: string;
  isExported: boolean;
  isPublic: boolean;
  dependencies?: string[];
  dependents?: string[];
}

export type SymbolType = 
  | 'function' 
  | 'class' 
  | 'interface' 
  | 'type' 
  | 'variable' 
  | 'constant' 
  | 'enum' 
  | 'module';

export interface FunctionSymbol extends Symbol {
  parameters?: Parameter[];
  returnType?: string;
  isAsync: boolean;
  isGenerator: boolean;
}

export interface ClassSymbol extends Symbol {
  extends?: string;
  implements?: string[];
  methods?: FunctionSymbol[];
  properties?: Symbol[];
  isAbstract: boolean;
}

export interface Parameter {
  name: string;
  type?: string;
  optional: boolean;
  defaultValue?: string;
}

export interface DependencyEdge {
  id: number;
  projectId: number;
  sourceFileId: number;
  targetFileId: number;
  dependencyType: DependencyType;
  isCircular: boolean;
  isExternal: boolean;
}

export type DependencyType = 
  | 'import' 
  | 'require' 
  | 'dynamic_import' 
  | 'type_reference' 
  | 'inheritance' 
  | 'composition';

export interface DependencyGraph {
  nodes: RepositoryFile[];
  edges: DependencyEdge[];
  cycles: Cycle[];
  externalDependencies: ExternalDependency[];
}

export interface Cycle {
  files: string[];
  severity: 'warning' | 'critical';
}

export interface ExternalDependency {
  name: string;
  version?: string;
  type: 'npm' | 'pypi' | 'cargo' | 'go' | 'maven' | 'other';
  usage: string[];
}

export interface ArchitectureMap {
  projectId: number;
  detectedPattern?: ArchitecturePattern;
  layers: ArchitectureLayer[];
  modules: Module[];
  entryPoints: string[];
  criticalPaths: string[][];
  hotspots: Hotspot[];
  technicalDebt: TechnicalDebtItem[];
}

export type ArchitecturePattern = 
  | 'mvc' 
  | 'mvvm' 
  | 'microservices' 
  | 'monolith' 
  | 'layered' 
  | 'hexagonal' 
  | 'clean_architecture' 
  | 'event_driven' 
  | 'serverless' 
  | 'unknown';

export interface ArchitectureLayer {
  name: string;
  files: string[];
  responsibility: string;
  dependencies: string[];
  stability: number; // 0-1
}

export interface Module {
  name: string;
  path: string;
  files: string[];
  exports: string[];
  imports: string[];
  cohesion: number; // 0-1
  coupling: number; // 0-1
  isCritical: boolean;
}

export interface Hotspot {
  filePath: string;
  changeFrequency: number;
  complexity: number;
  riskScore: number;
  lastChanged: string;
  contributors: string[];
}

export interface TechnicalDebtItem {
  filePath: string;
  debtType: DebtType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  estimatedEffort: number; // hours
  createdAt: string;
}

export type DebtType = 
  | 'code_smell' 
  | 'duplication' 
  | 'complexity' 
  | 'outdated_dependency' 
  | 'missing_tests' 
  | 'documentation' 
  | 'security';

export interface ChangeImpact {
  filePath: string;
  impactedFiles: string[];
  impactedModules: string[];
  riskScore: number;
  testCoverage: number;
  estimatedBreakingChanges: number;
}

// ============================================================================
// ARCHITECTURE MEMORY TYPES (Section 2)
// ============================================================================

export interface ADR {
  id: number;
  projectId: number;
  adrNumber: string;
  title: string;
  decision: string;
  reason: string;
  alternatives?: string;
  consequences?: string;
  status: ADRStatus;
  author?: string;
  date: string;
  tags?: string[];
  createdAt: string;
}

export type ADRStatus = 'proposed' | 'accepted' | 'deprecated' | 'superseded';

// ============================================================================
// KNOWLEDGE GRAPH TYPES (Section 3)
// ============================================================================

export interface KnowledgeNode {
  id: number;
  projectId: number;
  nodeType: NodeType;
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
  importanceScore: number;
}

export type NodeType = 
  | 'feature' 
  | 'module' 
  | 'service' 
  | 'file' 
  | 'task' 
  | 'dependency' 
  | 'api' 
  | 'database' 
  | 'config';

export interface KnowledgeEdge {
  id: number;
  projectId: number;
  sourceId: number;
  targetId: number;
  relationType: RelationType;
  weight: number;
  metadata?: Record<string, unknown>;
}

export type RelationType = 
  | 'depends_on' 
  | 'imports' 
  | 'calls' 
  | 'extends' 
  | 'implements' 
  | 'uses' 
  | 'contains' 
  | 'related_to' 
  | 'triggers';

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  version: number;
  lastUpdated: string;
}

// ============================================================================
// FAILURE LEARNING TYPES (Section 4)
// ============================================================================

export interface Failure {
  id: number;
  projectId: number;
  taskId?: number;
  failureType: FailureType;
  description: string;
  rootCause?: string;
  solution?: string;
  prevention?: string;
  filesAffected?: string[];
  severity: Severity;
  resolved: boolean;
  createdAt: string;
}

export type FailureType = 
  | 'review_rejected' 
  | 'build_failed' 
  | 'test_failed' 
  | 'merge_failed' 
  | 'architecture_mistake' 
  | 'security_issue' 
  | 'performance_issue';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface FailurePattern {
  pattern: string;
  frequency: number;
  affectedFiles: string[];
  commonSolutions: string[];
  preventionStrategies: string[];
}

// ============================================================================
// INTERVIEW TYPES (Section 5)
// ============================================================================

export interface Interview {
  id: number;
  projectId: number;
  status: InterviewStatus;
  currentStep: number;
  totalSteps: number;
  answers?: Record<string, string>;
  architectureProposal?: string;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
}

export type InterviewStatus = 'in_progress' | 'completed' | 'abandoned';

export interface InterviewStep {
  stepNumber: number;
  title: string;
  question: string;
  type: 'text' | 'choice' | 'multiselect' | 'repository_url' | 'architecture_proposal';
  options?: string[];
  required: boolean;
  validation?: ValidationRule;
}

export interface ValidationRule {
  type: 'required' | 'url' | 'email' | 'regex' | 'min_length' | 'max_length';
  value?: string | number;
  message: string;
}

// ============================================================================
// CONTEXT MANAGEMENT TYPES (Section 8)
// ============================================================================

export interface ContextWindow {
  maxTokens: number;
  currentTokens: number;
  availableTokens: number;
  compressionRatio: number;
}

export interface SemanticSummary {
  id: string;
  type: 'repository' | 'task' | 'conversation' | 'historical';
  content: string;
  keyPoints: string[];
  relevanceScore: number;
  tokenCount: number;
  createdAt: string;
  expiresAt?: string;
}

export interface ContextRanking {
  itemId: string;
  itemType: string;
  relevanceScore: number;
  lastAccessed: string;
  accessCount: number;
  importance: number;
}

// ============================================================================
// MONITORING TYPES (Sections 7, 11)
// ============================================================================

export interface ProviderHealth {
  id: number;
  providerName: string;
  status: ProviderStatus;
  latencyMs?: number;
  errorRate: number;
  quotaRemaining?: number;
  quotaTotal?: number;
  lastCheck: string;
  lastError?: string;
  consecutiveFailures: number;
}

export type ProviderStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface SystemHealth {
  overall: number; // 0-100
  github: number;
  googleAI: number;
  openRouter: number;
  d1: number;
  kv: number;
  telegram: number;
  lastUpdated: string;
}

export interface DashboardMetrics {
  totalProjects: number;
  activeTasks: number;
  pendingReviews: number;
  successRate: number;
  averageTaskTime: number;
  agentEfficiency: Record<string, number>;
  repositoryHealth: Record<number, number>;
}

// ============================================================================
// SECURITY TYPES (Section 10)
// ============================================================================

export interface SecretScanResult {
  id: number;
  projectId: number;
  commitSha?: string;
  filePath: string;
  secretType: SecretType;
  lineNumber?: number;
  severity: Severity;
  isFalsePositive: boolean;
  resolvedAt?: string;
  createdAt: string;
}

export type SecretType = 
  | 'api_key' 
  | 'token' 
  | 'password' 
  | 'private_key' 
  | 'credential' 
  | 'env_var' 
  | 'database_url';

// ============================================================================
// RECOVERY TYPES (Section 13)
// ============================================================================

export interface Snapshot {
  id: number;
  projectId: number;
  snapshotType: SnapshotType;
  data: Record<string, unknown>;
  checksum: string;
  createdAt: string;
}

export type SnapshotType = 'interview' | 'task' | 'workflow' | 'agent_context' | 'approval';

export interface RecoveryState {
  projectId: number;
  lastSnapshotId: number;
  recoveredAt: string;
  recoveredFrom: string;
  dataIntegrity: boolean;
}

// ============================================================================
// HEALTH TYPES (Section 14)
// ============================================================================

export interface ProjectHealth {
  projectId: number;
  architectureScore: number;
  repositoryScore: number;
  memoryScore: number;
  workflowStability: number;
  reviewSuccess: number;
  agentEfficiency: number;
  overallScore: number;
  recommendations: HealthRecommendation[];
  generatedAt: string;
}

export interface HealthRecommendation {
  category: string;
  severity: Severity;
  message: string;
  actionable: boolean;
  suggestedAction?: string;
}

// ============================================================================
// LLM TYPES
// ============================================================================

export interface LLMProvider {
  name: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
  defaultModel: string;
  maxTokens: number;
  temperature: number;
}

export interface LLMRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  tools?: LLMTool[];
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ============================================================================
// GITHUB TYPES
// ============================================================================

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  url: string;
  defaultBranch: string;
  languages: Record<string, number>;
  stars: number;
  forks: number;
  openIssues: number;
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
}

export interface GitHubFile {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size: number;
  sha: string;
  content?: string;
  downloadUrl?: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  user: {
    login: string;
  };
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  htmlUrl: string;
}

// ============================================================================
// TELEGRAM TYPES
// ============================================================================

export interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
}

export interface TelegramMessage {
  messageId: number;
  from: TelegramUser;
  chat: {
    id: number;
    type: string;
  };
  text?: string;
  date: number;
}

// ============================================================================
// ENVIRONMENT TYPES
// ============================================================================

export interface Env {
  DB: D1Database;
  KV_CACHE: KVNamespace;
  KV_SESSIONS: KVNamespace;
  KV_PROJECTS: KVNamespace;
  FILE_STORAGE: R2Bucket;
  JOB_QUEUE: Queue;
  GITHUB_TOKEN: string;
  OPENROUTER_API_KEY: string;
  GOOGLE_AI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  ENVIRONMENT: string;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    timestamp: string;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  stack?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}
