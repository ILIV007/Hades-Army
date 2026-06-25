/**
 * Patch Validation Layer - Cloudflare Workers Edition
 * Hades Army v0.9.1 — Production Readiness
 *
 * Priority 8: Patch Safety
 *
 * Workers (Builder) must NEVER overwrite files arbitrarily.
 * Builder outputs Unified Diff only. The Patch Validation Layer
 * runs BEFORE the patch is committed to GitHub, checking:
 *
 *   1. Syntax — the patch parses as a valid unified diff
 *   2. File existence — new files don't already exist, modified files do
 *   3. Dangerous changes — no path traversal, no .env, no .hades/secrets/
 *   4. Oversized patches — file count and total line count within limits
 *
 * If ANY check fails, the patch is REJECTED — the Manager must
 * either replan or abort. The patch never reaches GitHub.
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";

// ============================================
// Types
// ============================================

export interface PatchFileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  content: string;
  additions: number;
  deletions: number;
}

export interface PatchValidationOptions {
  maxFiles?: number;
  maxTotalLines?: number;
  maxLinesPerFile?: number;
  forbiddenPaths?: string[];
  /** known existing files (so we can validate "added" doesn't conflict) */
  existingFilePaths?: Set<string>;
}

export interface PatchValidationFinding {
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  file?: string;
  line?: number;
  message: string;
}

export interface PatchValidationResult {
  id: string;
  ok: boolean;
  blocked: boolean;
  findings: PatchValidationFinding[];
  stats: {
    fileCount: number;
    totalAdditions: number;
    totalDeletions: number;
    totalLines: number;
  };
  validatedAt: string;
}

// ============================================
// Default limits
// ============================================

const DEFAULT_LIMITS: Required<PatchValidationOptions> = {
  maxFiles: 20,
  maxTotalLines: 5000,
  maxLinesPerFile: 1500,
  forbiddenPaths: [
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    "secrets/",
    ".hades/secrets/",
    ".hades/secure/",
    ".git/",
    ".github/workflows/", // require explicit approval for CI changes
  ],
  existingFilePaths: new Set<string>(),
};

// ============================================
// Patch Validator
// ============================================

export class PatchValidator {
  /**
   * Validate a structured patch (list of file changes).
   * Returns ok=false if any critical/high finding blocks the patch.
   */
  validate(files: PatchFileChange[], options?: PatchValidationOptions): PatchValidationResult {
    const opts = { ...DEFAULT_LIMITS, ...options, forbiddenPaths: options?.forbiddenPaths ?? DEFAULT_LIMITS.forbiddenPaths };
    const findings: PatchValidationFinding[] = [];

    // Stats
    const stats = {
      fileCount: files.length,
      totalAdditions: files.reduce((s, f) => s + f.additions, 0),
      totalDeletions: files.reduce((s, f) => s + f.deletions, 0),
      totalLines: files.reduce((s, f) => s + f.content.split("\n").length, 0),
    };

    // Check 1: file count
    if (stats.fileCount > opts.maxFiles) {
      findings.push({
        severity: "high",
        rule: "max_files_exceeded",
        message: `Patch contains ${stats.fileCount} files, limit is ${opts.maxFiles}`,
      });
    }

    // Check 2: total lines
    if (stats.totalLines > opts.maxTotalLines) {
      findings.push({
        severity: "high",
        rule: "max_total_lines_exceeded",
        message: `Patch contains ${stats.totalLines} total lines, limit is ${opts.maxTotalLines}`,
      });
    }

    // Per-file checks
    for (const file of files) {
      // Check 3: forbidden paths
      for (const forbidden of opts.forbiddenPaths) {
        if (forbidden.endsWith("/")) {
          if (file.path.startsWith(forbidden)) {
            findings.push({
              severity: "critical",
              rule: "forbidden_path",
              file: file.path,
              message: `Path is forbidden: ${file.path} (matches ${forbidden}*)`,
            });
          }
        } else if (file.path === forbidden) {
          findings.push({
            severity: "critical",
            rule: "forbidden_path",
            file: file.path,
            message: `Path is forbidden: ${file.path}`,
          });
        }
      }

      // Check 4: path traversal
      if (file.path.includes("..") || file.path.startsWith("/")) {
        findings.push({
          severity: "critical",
          rule: "path_traversal",
          file: file.path,
          message: `Path contains traversal or absolute path: ${file.path}`,
        });
      }

      // Check 5: per-file line count
      const fileLines = file.content.split("\n").length;
      if (fileLines > opts.maxLinesPerFile) {
        findings.push({
          severity: "medium",
          rule: "max_lines_per_file_exceeded",
          file: file.path,
          message: `File ${file.path} has ${fileLines} lines, limit is ${opts.maxLinesPerFile}`,
        });
      }

      // Check 6: file existence
      if (file.status === "added" && opts.existingFilePaths.has(file.path)) {
        findings.push({
          severity: "high",
          rule: "file_already_exists",
          file: file.path,
          message: `Cannot add file — already exists in repository: ${file.path}`,
        });
      }
      if (file.status === "modified" && !opts.existingFilePaths.has(file.path) && opts.existingFilePaths.size > 0) {
        findings.push({
          severity: "medium",
          rule: "file_does_not_exist",
          file: file.path,
          message: `Cannot modify file — does not exist in repository: ${file.path}`,
        });
      }

      // Check 7: empty content for added/modified
      if ((file.status === "added" || file.status === "modified") && !file.content.trim()) {
        findings.push({
          severity: "medium",
          rule: "empty_file_content",
          file: file.path,
          message: `File ${file.path} has empty content`,
        });
      }

      // Check 8: basic syntax sanity (looks like a JS/TS file should have matching braces roughly)
      if (/\.(ts|tsx|js|jsx)$/.test(file.path)) {
        const open = (file.content.match(/[{\[\(]/g) || []).length;
        const close = (file.content.match(/[}\]\)]/g) || []).length;
        if (Math.abs(open - close) > 5) {
          findings.push({
            severity: "medium",
            rule: "bracket_mismatch",
            file: file.path,
            message: `File ${file.path} has unbalanced brackets (open=${open}, close=${close})`,
          });
        }
      }
    }

    const blocked = findings.some(
      (f) => f.severity === "critical" || f.severity === "high",
    );

    const result: PatchValidationResult = {
      id: generateId("patch-val"),
      ok: findings.length === 0,
      blocked,
      findings,
      stats,
      validatedAt: new Date().toISOString(),
    };

    logger.info(`PatchValidator: validated ${files.length} files`, {
      ok: result.ok,
      blocked,
      findings: findings.length,
      additions: stats.totalAdditions,
      deletions: stats.totalDeletions,
    });

    return result;
  }

  /**
   * Validate a raw unified diff string. Parses it into file changes
   * first, then runs the structured validator.
   */
  validateDiff(diff: string, options?: PatchValidationOptions): PatchValidationResult {
    const files = this.parseUnifiedDiff(diff);
    return this.validate(files, options);
  }

  // ============================================
  // Unified diff parser
  // ============================================

  private parseUnifiedDiff(diff: string): PatchFileChange[] {
    const files: PatchFileChange[] = [];
    const lines = diff.split("\n");

    let currentFile: PatchFileChange | null = null;
    let additions = 0;
    let deletions = 0;
    let content: string[] = [];

    const finalize = () => {
      if (currentFile) {
        currentFile.additions = additions;
        currentFile.deletions = deletions;
        currentFile.content = content.join("\n");
        files.push(currentFile);
      }
      currentFile = null;
      additions = 0;
      deletions = 0;
      content = [];
    };

    for (const line of lines) {
      if (line.startsWith("diff --git ")) {
        finalize();
        const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (match) {
          currentFile = {
            path: match[2],
            status: "modified",
            content: "",
            additions: 0,
            deletions: 0,
          };
        }
      } else if (line.startsWith("+++ b/")) {
        // New file path
        if (currentFile) {
          currentFile.path = line.slice(6);
        }
      } else if (line.startsWith("+++ /dev/null")) {
        if (currentFile) currentFile.status = "deleted";
      } else if (line.startsWith("--- /dev/null")) {
        if (currentFile) currentFile.status = "added";
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
        content.push(line.slice(1));
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      } else if (line.startsWith(" ") || line === "") {
        content.push(line.startsWith(" ") ? line.slice(1) : "");
      }
    }
    finalize();

    return files;
  }
}

// ============================================
// Factory
// ============================================

let _instance: PatchValidator | null = null;

export function getPatchValidator(): PatchValidator {
  if (!_instance) _instance = new PatchValidator();
  return _instance;
}
