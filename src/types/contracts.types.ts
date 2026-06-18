/**
 * Hades Army v0.4 — Agent Contract Types
 * Structured JSON contracts for all agent communication.
 */

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Priority = "low" | "medium" | "high" | "critical";
export type ContractVersion = "1.0";

// Manager → Builder Contract
export interface ManagerBuilderContract {
  version: ContractVersion;
  taskId: string;
  goal: string;
  files: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  riskLevel: RiskLevel;
  priority: Priority;
  deadline?: string;
  context?: string;
}

// Builder → Reviewer Contract
export interface BuilderReviewerContract {
  version: ContractVersion;
  taskId: string;
  filesChanged: string[];
  summary: string;
  patch: string;
  tests?: string[];
  dependencies?: string[];
  explanation?: string;
}

// Reviewer → Manager Contract
export interface ReviewerManagerContract {
  version: ContractVersion;
  taskId: string;
  status: "PASS" | "FAIL";
  issues: Array<{
    severity: "critical" | "high" | "medium" | "low" | "info";
    file?: string;
    line?: number;
    message: string;
    suggestion?: string;
  }>;
  riskLevel: RiskLevel;
  recommendations: string[];
  securityNotes?: string;
  performanceNotes?: string;
}

export type AgentContract = ManagerBuilderContract | BuilderReviewerContract | ReviewerManagerContract;

export interface ContractValidationResult {
  valid: boolean;
  errors: string[];
  contract?: AgentContract;
}
