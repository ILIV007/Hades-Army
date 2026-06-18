/**
 * Hades Army v0.4 — Risk Manager
 * Adaptive strictness based on task risk level.
 */

import type { HadesEnv } from "../config/env";
import type { Task, RiskLevel } from "../types";
import { Logger } from "../utils/logger";

const HIGH_RISK_PATTERNS = [
  "auth", "authentication", "login", "password", "token", "jwt", "oauth",
  "payment", "billing", "stripe", "paypal", "credit card",
  "database", "migration", "schema", "sql", "postgres", "mysql",
  "permission", "role", "admin", "access control", "rbac",
  "secret", "env", "api key", "private key", "certificate",
  "encryption", "hash", "bcrypt", "crypto",
  "webhook", "callback", "redirect",
  "cors", "csp", "security header", "xss", "csrf",
  "production", "deploy", "release",
];

const CRITICAL_RISK_PATTERNS = [
  "production secret", "database migration", "permission system",
  "security system", "payment gateway", "ssl certificate",
  "root access", "sudo", "kernel",
];

const LOW_RISK_PATTERNS = [
  "readme", "comment", "doc", "documentation",
  "typo", "spelling", "text", "label", "ui text",
  "color", "style", "css", "tailwind", "theme",
  "icon", "image", "logo", "font",
];

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
  requiresHumanApproval: boolean;
  autoMergeAllowed: boolean;
  additionalReviewRequired: boolean;
}

export class RiskManager {
  private logger: Logger;

  constructor(env: HadesEnv, projectId: string) {
    this.logger = new Logger(env, projectId);
  }

  assess(task: Task): RiskAssessment {
    const text = `${task.title} ${task.description} ${task.requiredFiles.join(" ")}`.toLowerCase();
    const reasons: string[] = [];

    // Check critical patterns
    for (const pattern of CRITICAL_RISK_PATTERNS) {
      if (text.includes(pattern)) {
        reasons.push(`Critical pattern detected: "${pattern}"`);
      }
    }
    if (reasons.length > 0) {
      return {
        level: "critical",
        reasons,
        requiresHumanApproval: true,
        autoMergeAllowed: false,
        additionalReviewRequired: true,
      };
    }

    // Check high risk patterns
    for (const pattern of HIGH_RISK_PATTERNS) {
      if (text.includes(pattern)) {
        reasons.push(`High risk pattern detected: "${pattern}"`);
      }
    }
    if (reasons.length > 0) {
      return {
        level: "high",
        reasons,
        requiresHumanApproval: true,
        autoMergeAllowed: false,
        additionalReviewRequired: true,
      };
    }

    // Check low risk patterns
    for (const pattern of LOW_RISK_PATTERNS) {
      if (text.includes(pattern)) {
        reasons.push(`Low risk pattern detected: "${pattern}"`);
      }
    }
    if (reasons.length > 0 && reasons.length >= 2) {
      return {
        level: "low",
        reasons,
        requiresHumanApproval: false,
        autoMergeAllowed: true,
        additionalReviewRequired: false,
      };
    }

    // Default: medium risk
    return {
      level: "medium",
      reasons: ["No specific risk patterns detected — defaulting to medium"],
      requiresHumanApproval: false,
      autoMergeAllowed: false,
      additionalReviewRequired: false,
    };
  }

  async logAssessment(taskId: string, assessment: RiskAssessment): Promise<void> {
    await this.logger.info("risk", `Task ${taskId} risk: ${assessment.level}`, {
      reasons: assessment.reasons,
      requiresHumanApproval: assessment.requiresHumanApproval,
      autoMergeAllowed: assessment.autoMergeAllowed,
    });
  }
}
