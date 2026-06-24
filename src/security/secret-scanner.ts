
/**
 * Secret Scanner - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Detects secrets and sensitive data in code:
 * - API keys and tokens
 * - Passwords and credentials
 * - Private keys
 * - Environment variable leaks
 * - Database connection strings
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { SecurityFinding } from "./manager";

// ============================================
// Types
// ============================================

export interface SecretPattern {
  name: string;
  severity: "critical" | "high" | "medium" | "low";
  pattern: RegExp;
  description: string;
  remediation: string;
}

export interface ScanOptions {
  filename?: string;
  ignoreComments?: boolean;
  maxFindings?: number;
}

// ============================================
// Secret Patterns
// ============================================

const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: "AWS Access Key ID",
    severity: "critical",
    pattern: /AKIA[0-9A-Z]{16}/g,
    description: "AWS Access Key ID detected",
    remediation: "Move to environment variables or AWS Secrets Manager",
  },
  {
    name: "AWS Secret Access Key",
    severity: "critical",
    pattern: /[0-9a-zA-Z/+]{40}/g,
    description: "Potential AWS Secret Access Key detected",
    remediation: "Move to environment variables or AWS Secrets Manager",
  },
  {
    name: "GitHub Token",
    severity: "critical",
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    description: "GitHub personal access token detected",
    remediation: "Move to environment variables or GitHub Secrets",
  },
  {
    name: "GitHub OAuth Token",
    severity: "critical",
    pattern: /gho_[A-Za-z0-9_]{36}/g,
    description: "GitHub OAuth token detected",
    remediation: "Move to environment variables",
  },
  {
    name: "Slack Token",
    severity: "critical",
    pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}(-[a-zA-Z0-9]{24})?/g,
    description: "Slack API token detected",
    remediation: "Move to environment variables or Slack app configuration",
  },
  {
    name: "Slack Webhook URL",
    severity: "high",
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]{8}\/B[a-zA-Z0-9_]{8,}\/[a-zA-Z0-9_]{24}/g,
    description: "Slack webhook URL detected",
    remediation: "Move to environment variables",
  },
  {
    name: "OpenAI API Key",
    severity: "critical",
    pattern: /sk-[a-zA-Z0-9]{48}/g,
    description: "OpenAI API key detected",
    remediation: "Move to environment variables",
  },
  {
    name: "Anthropic API Key",
    severity: "critical",
    pattern: /sk-ant-[a-zA-Z0-9_-]{32,}/g,
    description: "Anthropic API key detected",
    remediation: "Move to environment variables",
  },
  {
    name: "Google API Key",
    severity: "critical",
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
    description: "Google API key detected",
    remediation: "Move to environment variables or Google Secret Manager",
  },
  {
    name: "Stripe API Key",
    severity: "critical",
    pattern: /sk_(live|test)_[0-9a-zA-Z]{24,}/g,
    description: "Stripe API key detected",
    remediation: "Move to environment variables",
  },
  {
    name: "Private Key",
    severity: "critical",
    pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    description: "Private key detected",
    remediation: "Move to secure key storage - never commit private keys",
  },
  {
    name: "Password in Code",
    severity: "high",
    pattern: /password\s*[:=]\s*["\'][^"\']{4,}["\']/gi,
    description: "Hardcoded password detected",
    remediation: "Use environment variables or a secrets manager",
  },
  {
    name: "Database Connection String",
    severity: "high",
    pattern: /(mongodb|mysql|postgres|postgresql|redis)://[^:]+:[^@]+@/gi,
    description: "Database connection string with credentials detected",
    remediation: "Use environment variables for connection strings",
  },
  {
    name: "JWT Token",
    severity: "high",
    pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
    description: "JWT token detected",
    remediation: "JWT tokens should not be hardcoded - use secure storage",
  },
  {
    name: "Telegram Bot Token",
    severity: "critical",
    pattern: /[0-9]{8,10}:[a-zA-Z0-9_-]{35}/g,
    description: "Telegram bot token detected",
    remediation: "Move to environment variables",
  },
  {
    name: "Cloudflare API Token",
    severity: "critical",
    pattern: /[a-f0-9]{37}/g,
    description: "Potential Cloudflare API token detected",
    remediation: "Move to environment variables or Cloudflare Secrets",
  },
  {
    name: "Generic API Key",
    severity: "medium",
    pattern: /api[_-]?key\s*[:=]\s*["\'][a-zA-Z0-9_-]{16,}["\']/gi,
    description: "Generic API key pattern detected",
    remediation: "Verify if this is a real API key and move to environment variables",
  },
  {
    name: "Generic Secret",
    severity: "medium",
    pattern: /secret\s*[:=]\s*["\'][a-zA-Z0-9_-]{8,}["\']/gi,
    description: "Generic secret pattern detected",
    remediation: "Verify if this is a real secret and move to environment variables",
  },
  {
    name: "Bearer Token",
    severity: "high",
    pattern: /Bearer\s+[a-zA-Z0-9_-]{20,}/g,
    description: "Bearer token detected",
    remediation: "Bearer tokens should not be hardcoded",
  },
  {
    name: "Basic Auth",
    severity: "high",
    pattern: /Basic\s+[a-zA-Z0-9+/]{20,}={0,2}/g,
    description: "Basic authentication credentials detected",
    remediation: "Use token-based authentication instead of Basic Auth",
  },
];

// ============================================
// Secret Scanner
// ============================================

export class SecretScanner {
  private patterns: SecretPattern[] = [...SECRET_PATTERNS];
  private customPatterns: SecretPattern[] = [];

  // ============================================
  // Pattern Management
  // ============================================

  addPattern(pattern: SecretPattern): void {
    this.customPatterns.push(pattern);
    logger.info(`Custom secret pattern added: ${pattern.name}`);
  }

  removePattern(name: string): boolean {
    const index = this.customPatterns.findIndex((p) => p.name === name);
    if (index >= 0) {
      this.customPatterns.splice(index, 1);
      logger.info(`Custom secret pattern removed: ${name}`);
      return true;
    }
    return false;
  }

  getPatterns(): SecretPattern[] {
    return [...this.patterns, ...this.customPatterns];
  }

  // ============================================
  // Scanning
  // ============================================

  async scan(code: string, filename?: string, options: ScanOptions = {}): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];
    const maxFindings = options.maxFindings || 100;

    // Prepare code for scanning
    let scanCode = code;
    if (options.ignoreComments) {
      scanCode = this.removeComments(code);
    }

    const allPatterns = this.getPatterns();

    for (const pattern of allPatterns) {
      const matches = scanCode.matchAll(pattern.pattern);

      for (const match of matches) {
        if (findings.length >= maxFindings) {
          logger.warn(`Maximum findings (${maxFindings}) reached, stopping scan`);
          break;
        }

        // Calculate line number
        const lineNumber = this.getLineNumber(code, match.index || 0);

        findings.push({
          id: generateId("finding"),
          severity: pattern.severity,
          category: "secret_exposure",
          message: pattern.description,
          file: filename,
          line: lineNumber,
          remediation: pattern.remediation,
        });
      }

      if (findings.length >= maxFindings) break;
    }

    logger.info(`Secret scan completed: ${findings.length} findings in ${filename || "unknown file"}`);
    return findings;
  }

  async scanFiles(files: Array<{ path: string; content: string }>): Promise<{
    findings: SecurityFinding[];
    filesScanned: number;
    filesWithSecrets: number;
  }> {
    const allFindings: SecurityFinding[] = [];
    let filesWithSecrets = 0;

    for (const file of files) {
      const findings = await this.scan(file.content, file.path);
      allFindings.push(...findings);

      if (findings.length > 0) {
        filesWithSecrets++;
      }
    }

    return {
      findings: allFindings,
      filesScanned: files.length,
      filesWithSecrets,
    };
  }

  // ============================================
  // Helpers
  // ============================================

  private removeComments(code: string): string {
    // Remove single-line comments
    let result = code.replace(/\/\/.*$/gm, "");
    // Remove multi-line comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, "");
    return result;
  }

  private getLineNumber(code: string, index: number): number {
    const lines = code.substring(0, index).split("\n");
    return lines.length;
  }

  // ============================================
  // Statistics
  // ============================================

  getStats(): {
    totalPatterns: number;
    builtInPatterns: number;
    customPatterns: number;
  } {
    return {
      totalPatterns: this.patterns.length + this.customPatterns.length,
      builtInPatterns: this.patterns.length,
      customPatterns: this.customPatterns.length,
    };
  }
}

export const secretScanner = new SecretScanner();
