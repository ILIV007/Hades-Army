/**
 * Repository Secret Scanner (Pre-PR) - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Additional improvement: Secret Scanner
 *
 * This module is the REPOSITORY-LEVEL secret scanner that runs BEFORE
 * the Manager creates a pull request. It blocks the PR if any
 * secret / credential / API key is detected in the patch.
 *
 * The existing src/security/secret-scanner.ts (v0.8.0) is UNMODIFIED
 * and continues to handle code-level scanning. This new module wraps
 * it for the repository workflow and adds:
 *   - Pre-PR gating (returns blocked = true if any critical finding)
 *   - Patch-level scanning (only scans the diff, not the full file)
 *   - .hades/ path protection (never scan .hades/secrets/ which is
 *     explicitly intended for encrypted secrets)
 *
 * Integration point: ManagerController calls scanPatch() before
 * invoking ManagerGitHubOperations.createPullRequest().
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";

// ============================================
// Types
// ============================================

export interface PatchFile {
  path: string;
  content: string;
  status: "added" | "modified" | "deleted";
}

export interface PatchScanFinding {
  id: string;
  file: string;
  line?: number;
  severity: "critical" | "high" | "medium" | "low";
  ruleName: string;
  description: string;
  remediation: string;
  matchedSnippet: string; // redacted
}

export interface PatchScanResult {
  id: string;
  blocked: boolean;
  findings: PatchScanFinding[];
  scannedAt: string;
  scannedFileCount: number;
  totalLinesScanned: number;
  rules: string[];
}

// ============================================
// Secret patterns (high-signal, low-false-positive subset)
// ============================================

interface SecretRule {
  name: string;
  severity: "critical" | "high" | "medium" | "low";
  pattern: RegExp;
  description: string;
  remediation: string;
}

const SECRET_RULES: SecretRule[] = [
  {
    name: "AWS Access Key ID",
    severity: "critical",
    pattern: /AKIA[0-9A-Z]{16}/g,
    description: "AWS Access Key ID detected",
    remediation: "Move to environment variables or AWS Secrets Manager",
  },
  {
    name: "GitHub Personal Access Token",
    severity: "critical",
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    description: "GitHub personal access token detected",
    remediation: "Revoke immediately at https://github.com/settings/tokens and rotate",
  },
  {
    name: "Google API Key",
    severity: "critical",
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
    description: "Google API key detected",
    remediation: "Move to Cloudflare Worker secrets",
  },
  {
    name: "OpenAI API Key",
    severity: "critical",
    pattern: /sk-[A-Za-z0-9]{20,}/g,
    description: "OpenAI API key detected",
    remediation: "Revoke at https://platform.openai.com/api-keys and rotate",
  },
  {
    name: "Anthropic API Key",
    severity: "critical",
    pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g,
    description: "Anthropic API key detected",
    remediation: "Revoke and rotate",
  },
  {
    name: "Slack Token",
    severity: "critical",
    pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}(-[a-zA-Z0-9]{24})?/g,
    description: "Slack API token detected",
    remediation: "Move to environment variables",
  },
  {
    name: "OpenRouter API Key",
    severity: "critical",
    pattern: /sk-or-[A-Za-z0-9_-]{40,}/g,
    description: "OpenRouter API key detected",
    remediation: "Revoke at https://openrouter.ai/keys and rotate",
  },
  {
    name: "Private Key Block",
    severity: "critical",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    description: "Private key block detected",
    remediation: "Move to a secrets manager — never commit private keys",
  },
  {
    name: "Telegram Bot Token",
    severity: "high",
    pattern: /\b\d{8,12}:AA[A-Za-z0-9_-]{30,}\b/g,
    description: "Telegram bot token detected",
    remediation: "Revoke via @BotFather and rotate",
  },
  {
    name: "Generic Password Assignment",
    severity: "medium",
    pattern: /\bpassword\s*[:=]\s*['"][^'"\s]{8,}['"]/gi,
    description: "Hardcoded password assignment detected",
    remediation: "Use environment variables",
  },
  {
    name: "Generic API Key Assignment",
    severity: "medium",
    pattern: /\b(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*['"][^'"\s]{12,}['"]/gi,
    description: "Hardcoded API key assignment detected",
    remediation: "Use environment variables",
  },
];

// ============================================
// Paths to NEVER scan (allowed-to-contain-secrets)
// ============================================

const NEVER_SCAN_PATHS: RegExp[] = [
  /^\.hades\/secrets\//,
  /^\.hades\/secure\//,
  /^docs\/secrets\./,
];

// ============================================
// Files to NEVER commit (block on detection, even outside secret scanning)
// ============================================

const FORBIDDEN_PATHS: RegExp[] = [
  /^\.env$/i,
  /^\.env\.local$/i,
  /^\.env\.production$/i,
  /^\.env\.development$/i,
  /^secrets\//i,
];

// ============================================
// Scanner
// ============================================

export class RepositorySecretScanner {
  /**
   * Scan a patch (set of file changes) for secrets BEFORE creating a PR.
   * Returns blocked=true if any critical or high finding is present,
   * or if any file is in the forbidden paths list.
   */
  scanPatch(patchContent: string, files?: PatchFile[]): PatchScanResult {
    const start = Date.now();
    const findings: PatchScanFinding[] = [];
    let totalLinesScanned = 0;

    // Build the file list from the patch string if not provided
    const fileList: PatchFile[] = files ?? this.parsePatchFiles(patchContent);

    for (const file of fileList) {
      // Check forbidden paths first
      if (FORBIDDEN_PATHS.some((re) => re.test(file.path))) {
        findings.push({
          id: generateId("find"),
          file: file.path,
          severity: "critical",
          ruleName: "Forbidden Path",
          description: `File at forbidden path: ${file.path}`,
          remediation: "Do not commit environment or secrets files. Use Cloudflare Worker secrets.",
          matchedSnippet: "(path only)",
        });
        continue;
      }

      // Skip explicitly-allowed secret paths
      if (NEVER_SCAN_PATHS.some((re) => re.test(file.path))) {
        continue;
      }

      // Scan content line by line for accurate line numbers
      const lines = file.content.split("\n");
      totalLinesScanned += lines.length;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const rule of SECRET_RULES) {
          rule.pattern.lastIndex = 0;
          const matches = line.match(rule.pattern);
          if (matches) {
            for (const match of matches) {
              findings.push({
                id: generateId("find"),
                file: file.path,
                line: i + 1,
                severity: rule.severity,
                ruleName: rule.name,
                description: rule.description,
                remediation: rule.remediation,
                matchedSnippet: this.redact(match),
              });
            }
          }
        }
      }
    }

    const blocked = findings.some((f) => f.severity === "critical" || f.severity === "high");

    const result: PatchScanResult = {
      id: generateId("scan"),
      blocked,
      findings,
      scannedAt: new Date().toISOString(),
      scannedFileCount: fileList.length,
      totalLinesScanned,
      rules: SECRET_RULES.map((r) => r.name),
    };

    logger.info(`RepositorySecretScanner: scan complete in ${Date.now() - start}ms`, {
      blocked,
      findings: findings.length,
      files: fileList.length,
    });

    return result;
  }

  // ============================================
  // Helpers
  // ============================================

  private redact(match: string): string {
    if (match.length <= 12) return "***";
    return `${match.slice(0, 4)}…${match.slice(-2)}`;
  }

  /**
   * Best-effort parse of a unified diff into PatchFile[].
   * Used only when the caller passes a raw diff string instead of
   * structured files.
   */
  private parsePatchFiles(diff: string): PatchFile[] {
    const files: PatchFile[] = [];
    const lines = diff.split("\n");
    let currentPath: string | null = null;
    let currentContent: string[] = [];

    for (const line of lines) {
      if (line.startsWith("+++ b/")) {
        if (currentPath) {
          files.push({ path: currentPath, content: currentContent.join("\n"), status: "modified" });
        }
        currentPath = line.slice(6);
        currentContent = [];
      } else if (line.startsWith("+++ /dev/null")) {
        if (currentPath) {
          files.push({ path: currentPath, content: "", status: "deleted" });
        }
        currentPath = null;
      } else if (line.startsWith("--- a/")) {
        // New file marker
        const path = line.slice(6);
        if (!currentPath) currentPath = path;
      } else if (currentPath && (line.startsWith("+") || line.startsWith(" "))) {
        currentContent.push(line.startsWith("+") ? line.slice(1) : line);
      }
    }
    if (currentPath) {
      files.push({ path: currentPath, content: currentContent.join("\n"), status: "modified" });
    }
    return files;
  }
}
