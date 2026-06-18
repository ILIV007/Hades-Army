/**
 * Hades Army v0.4 — Contract Validator
 * Schema validation for all agent contracts.
 * Never allows malformed contracts to proceed.
 */

import type {
  ManagerBuilderContract,
  BuilderReviewerContract,
  ReviewerManagerContract,
  ContractValidationResult,
  RiskLevel,
  Priority,
} from "../types/contracts.types";

const VALID_RISK_LEVELS: RiskLevel[] = ["low", "medium", "high", "critical"];
const VALID_PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];

export class ContractValidator {
  /**
   * Validate Manager → Builder contract
   */
  static validateManagerBuilder(json: unknown): ContractValidationResult {
    const errors: string[] = [];

    if (!json || typeof json !== "object") {
      return { valid: false, errors: ["Contract must be a JSON object"] };
    }

    const contract = json as Record<string, unknown>;

    // Required fields
    if (contract.version !== "1.0") errors.push("version must be '1.0'");
    if (!contract.taskId || typeof contract.taskId !== "string") errors.push("taskId is required and must be a string");
    if (!contract.goal || typeof contract.goal !== "string") errors.push("goal is required and must be a string");
    if (!Array.isArray(contract.files)) errors.push("files must be an array");
    if (!Array.isArray(contract.constraints)) errors.push("constraints must be an array");
    if (!Array.isArray(contract.acceptanceCriteria)) errors.push("acceptanceCriteria must be an array");
    if (!VALID_RISK_LEVELS.includes(contract.riskLevel as RiskLevel)) errors.push(`riskLevel must be one of: ${VALID_RISK_LEVELS.join(", ")}`);
    if (!VALID_PRIORITIES.includes(contract.priority as Priority)) errors.push(`priority must be one of: ${VALID_PRIORITIES.join(", ")}`);

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return {
      valid: true,
      errors: [],
      contract: json as ManagerBuilderContract,
    };
  }

  /**
   * Validate Builder → Reviewer contract
   */
  static validateBuilderReviewer(json: unknown): ContractValidationResult {
    const errors: string[] = [];

    if (!json || typeof json !== "object") {
      return { valid: false, errors: ["Contract must be a JSON object"] };
    }

    const contract = json as Record<string, unknown>;

    if (contract.version !== "1.0") errors.push("version must be '1.0'");
    if (!contract.taskId || typeof contract.taskId !== "string") errors.push("taskId is required");
    if (!Array.isArray(contract.filesChanged)) errors.push("filesChanged must be an array");
    if (!contract.summary || typeof contract.summary !== "string") errors.push("summary is required");
    if (!contract.patch || typeof contract.patch !== "string") errors.push("patch is required");
    if (!isValidPatch(contract.patch as string)) errors.push("patch must be a valid unified diff");

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return {
      valid: true,
      errors: [],
      contract: json as BuilderReviewerContract,
    };
  }

  /**
   * Validate Reviewer → Manager contract
   */
  static validateReviewerManager(json: unknown): ContractValidationResult {
    const errors: string[] = [];

    if (!json || typeof json !== "object") {
      return { valid: false, errors: ["Contract must be a JSON object"] };
    }

    const contract = json as Record<string, unknown>;

    if (contract.version !== "1.0") errors.push("version must be '1.0'");
    if (!contract.taskId || typeof contract.taskId !== "string") errors.push("taskId is required");
    if (contract.status !== "PASS" && contract.status !== "FAIL") errors.push("status must be 'PASS' or 'FAIL'");
    if (!Array.isArray(contract.issues)) errors.push("issues must be an array");
    if (!VALID_RISK_LEVELS.includes(contract.riskLevel as RiskLevel)) errors.push(`riskLevel must be one of: ${VALID_RISK_LEVELS.join(", ")}`);
    if (!Array.isArray(contract.recommendations)) errors.push("recommendations must be an array");

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return {
      valid: true,
      errors: [],
      contract: json as ReviewerManagerContract,
    };
  }

  /**
   * Extract JSON from LLM output (handles markdown code blocks)
   */
  static extractJson(text: string): unknown {
    const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1]);
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("No JSON found in output");
  }
}

function isValidPatch(patch: string): boolean {
  const hasDiffHeader = /^diff --git/m.test(patch);
  const hasHunkHeader = /^@@ -\d+,?\d* \+\d+,?\d* @@/m.test(patch);
  return hasDiffHeader && hasHunkHeader;
}
