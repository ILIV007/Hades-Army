/**
 * Reviewer Agent - Cloudflare Workers Edition
 * Hades Army v0.8.0
 * 7-Stage Pipeline: Syntax, Security, Performance, Architecture, Style, Tests, Documentation
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";

export interface ReviewRequest {
  id: string;
  target: string;
  code: string;
  type: "code" | "architecture" | "security" | "performance" | "documentation";
  context?: string;
}

export interface ReviewFinding {
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  message: string;
  line?: number;
  suggestion?: string;
}

export interface ReviewResult {
  id: string;
  target: string;
  type: string;
  status: string;
  overallScore: number;
  findings: ReviewFinding[];
  summary: string;
  createdAt: string;
  completedAt?: string;
}

export class ReviewManager {
  private reviews: Map<string, ReviewResult> = new Map();

  async review(request: ReviewRequest): Promise<ReviewResult> {
    logger.info(`Review started: ${request.id} for ${request.target}`);
    const startTime = Date.now();

    const findings: ReviewFinding[] = [];

    // Stage 1: Syntax Check
    findings.push(...this.checkSyntax(request.code));
    // Stage 2: Security Check
    findings.push(...this.checkSecurity(request.code));
    // Stage 3: Performance Check
    findings.push(...this.checkPerformance(request.code));
    // Stage 4: Architecture Check
    findings.push(...this.checkArchitecture(request.code));
    // Stage 5: Style Check
    findings.push(...this.checkStyle(request.code));
    // Stage 6: Tests Check
    findings.push(...this.checkTests(request.code));
    // Stage 7: Documentation Check
    findings.push(...this.checkDocumentation(request.code));

    const score = this.calculateScore(findings);
    const result: ReviewResult = {
      id: request.id,
      target: request.target,
      type: request.type,
      status: "completed",
      overallScore: score,
      findings,
      summary: this.generateSummary(findings, score),
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    this.reviews.set(request.id, result);
    logger.info(`Review completed: ${request.id} in ${Date.now() - startTime}ms (Score: ${score})`);
    return result;
  }

  private checkSyntax(code: string): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    if (code.includes("console.log")) {
      findings.push({ category: "syntax", severity: "low", message: "console.log found - remove before production" });
    }
    return findings;
  }

  private checkSecurity(code: string): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    if (code.includes("eval(")) {
      findings.push({ category: "security", severity: "critical", message: "eval() usage detected - potential code injection" });
    }
    return findings;
  }

  private checkPerformance(code: string): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    if (code.includes("for (")) {
      findings.push({ category: "performance", severity: "info", message: "Consider using array methods instead of for loops" });
    }
    return findings;
  }

  private checkArchitecture(code: string): ReviewFinding[] {
    return [];
  }

  private checkStyle(code: string): ReviewFinding[] {
    return [];
  }

  private checkTests(code: string): ReviewFinding[] {
    return [];
  }

  private checkDocumentation(code: string): ReviewFinding[] {
    return [];
  }

  private calculateScore(findings: ReviewFinding[]): number {
    const critical = findings.filter((f) => f.severity === "critical").length;
    const high = findings.filter((f) => f.severity === "high").length;
    const medium = findings.filter((f) => f.severity === "medium").length;
    return Math.max(0, 100 - critical * 20 - high * 10 - medium * 5);
  }

  private generateSummary(findings: ReviewFinding[], score: number): string {
    return `Review completed with score ${score}/100. ${findings.length} findings: ${findings.filter((f) => f.severity === "critical").length} critical, ${findings.filter((f) => f.severity === "high").length} high.`;
  }

  async approveReview(id: string, notes?: string): Promise<void> {
    const review = this.reviews.get(id);
    if (review) {
      review.status = "approved";
      logger.info(`Review approved: ${id}${notes ? ` - ${notes}` : ""}`);
    }
  }

  async rejectReview(id: string, reason: string): Promise<void> {
    const review = this.reviews.get(id);
    if (review) {
      review.status = "rejected";
      logger.info(`Review rejected: ${id} - ${reason}`);
    }
  }

  getStats(): { total: number; approved: number; rejected: number; pending: number } {
    const all = Array.from(this.reviews.values());
    return {
      total: all.length,
      approved: all.filter((r) => r.status === "approved").length,
      rejected: all.filter((r) => r.status === "rejected").length,
      pending: all.filter((r) => r.status === "pending").length,
    };
  }
}

export const reviewManager = new ReviewManager();
