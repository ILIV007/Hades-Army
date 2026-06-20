/**
 * Hades Army v0.6 - Failure Learning System
 * Learns from past failures to prevent future mistakes
 */

import type { Failure, FailurePattern, Task, FailureType } from '../core/types';
import type { DBContext } from '../db';
import { recordFailure, getFailures, resolveFailure } from '../db';

export interface FailureAnalysis {
  totalFailures: number;
  byType: Record<FailureType, number>;
  bySeverity: Record<string, number>;
  patterns: FailurePattern[];
  recurringIssues: string[];
  preventionStrategies: string[];
  riskFiles: string[];
}

export async function recordTaskFailure(
  ctx: DBContext,
  projectId: number,
  task: Task,
  failureType: FailureType,
  description: string,
  rootCause?: string,
  filesAffected?: string[]
): Promise<Failure> {
  const failure = await recordFailure(ctx, {
    projectId,
    taskId: task.id,
    failureType,
    description,
    rootCause,
    filesAffected,
    severity: determineSeverity(failureType, task),
    resolved: false,
  });

  return failure;
}

export async function analyzeFailures(ctx: DBContext, projectId: number): Promise<FailureAnalysis> {
  const failures = await getFailures(ctx, projectId);

  if (failures.length === 0) {
    return {
      totalFailures: 0,
      byType: {} as Record<FailureType, number>,
      bySeverity: {},
      patterns: [],
      recurringIssues: [],
      preventionStrategies: [],
      riskFiles: [],
    };
  }

  // Count by type
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  for (const failure of failures) {
    byType[failure.failureType] = (byType[failure.failureType] || 0) + 1;
    bySeverity[failure.severity] = (bySeverity[failure.severity] || 0) + 1;
  }

  // Detect patterns
  const patterns = detectFailurePatterns(failures);

  // Find recurring issues
  const recurringIssues = findRecurringIssues(failures);

  // Generate prevention strategies
  const preventionStrategies = generatePreventionStrategies(patterns, failures);

  // Identify risk files
  const riskFiles = findRiskFiles(failures);

  return {
    totalFailures: failures.length,
    byType: byType as Record<FailureType, number>,
    bySeverity,
    patterns,
    recurringIssues,
    preventionStrategies,
    riskFiles,
  };
}

export async function getFailureWarnings(
  ctx: DBContext,
  projectId: number,
  task: Task
): Promise<string[]> {
  const analysis = await analyzeFailures(ctx, projectId);
  const warnings: string[] = [];

  // Check if similar tasks have failed before
  const similarFailures = await findSimilarFailures(ctx, projectId, task);
  for (const failure of similarFailures) {
    warnings.push(
      `WARNING: Similar task previously failed with: ${failure.description}. ` +
      `Root cause: ${failure.rootCause || 'Unknown'}`
    );
  }

  // Check if files have failure history
  if (task.files) {
    for (const file of task.files) {
      const fileFailures = analysis.riskFiles.filter(rf => file.includes(rf) || rf.includes(file));
      if (fileFailures.length > 0) {
        warnings.push(
          `WARNING: File ${file} has ${fileFailures.length} historical failures. ` +
          `Extra caution recommended.`
        );
      }
    }
  }

  // Check for common builder errors
  const commonErrors = analysis.patterns
    .filter(p => p.frequency >= 3)
    .map(p => p.pattern);

  for (const error of commonErrors) {
    warnings.push(`COMMON ERROR PATTERN: ${error}. Ensure this is avoided.`);
  }

  return warnings;
}

export async function getRiskAssessment(
  ctx: DBContext,
  projectId: number,
  files: string[]
): Promise<{
  riskScore: number;
  warnings: string[];
  similarFailures: Failure[];
}> {
  const analysis = await analyzeFailures(ctx, projectId);
  let riskScore = 0;
  const warnings: string[] = [];
  const similarFailures: Failure[] = [];

  for (const file of files) {
    // Check file failure history
    const fileFailures = analysis.patterns.filter(p => 
      p.affectedFiles.some(af => af.includes(file) || file.includes(af))
    );

    for (const pattern of fileFailures) {
      riskScore += pattern.frequency * 10;
      warnings.push(`File ${file} has ${pattern.frequency} similar failures: ${pattern.pattern}`);
    }
  }

  // Cap risk score at 100
  riskScore = Math.min(riskScore, 100);

  return { riskScore, warnings, similarFailures };
}

function determineSeverity(failureType: FailureType, task: Task): 'low' | 'medium' | 'high' | 'critical' {
  switch (failureType) {
    case 'security_issue':
      return 'critical';
    case 'architecture_mistake':
      return task.priority === 'critical' ? 'critical' : 'high';
    case 'merge_failed':
      return 'high';
    case 'build_failed':
    case 'test_failed':
      return task.priority === 'critical' ? 'high' : 'medium';
    case 'review_rejected':
      return 'medium';
    case 'performance_issue':
      return task.priority === 'critical' ? 'high' : 'medium';
    default:
      return 'medium';
  }
}

function detectFailurePatterns(failures: Failure[]): FailurePattern[] {
  const patterns: FailurePattern[] = [];
  const patternMap = new Map<string, { count: number; files: Set<string>; solutions: Set<string> }>();

  for (const failure of failures) {
    // Extract key pattern from description
    const pattern = extractPattern(failure.description);
    if (!patternMap.has(pattern)) {
      patternMap.set(pattern, { count: 0, files: new Set(), solutions: new Set() });
    }

    const entry = patternMap.get(pattern)!;
    entry.count++;
    failure.filesAffected?.forEach(f => entry.files.add(f));
    if (failure.solution) entry.solutions.add(failure.solution);
  }

  for (const [pattern, data] of patternMap) {
    if (data.count >= 2) { // Only include patterns that occurred at least twice
      patterns.push({
        pattern,
        frequency: data.count,
        affectedFiles: Array.from(data.files),
        commonSolutions: Array.from(data.solutions),
        preventionStrategies: generatePatternPrevention(pattern),
      });
    }
  }

  return patterns.sort((a, b) => b.frequency - a.frequency);
}

function extractPattern(description: string): string {
  // Simplify description to extract pattern
  const simplified = description
    .toLowerCase()
    .replace(/\d+/g, 'N') // Replace numbers with N
    .replace(/['"][^'"]*['"]/g, 'STRING') // Replace strings
    .replace(/\b[a-f0-9]{7,}\b/g, 'HASH') // Replace hashes
    .trim();

  // Extract first meaningful sentence or phrase
  const sentences = simplified.split(/[.!?]/);
  return sentences[0]?.trim() || simplified;
}

function findRecurringIssues(failures: Failure[]): string[] {
  const issueMap = new Map<string, number>();

  for (const failure of failures) {
    const key = failure.failureType;
    issueMap.set(key, (issueMap.get(key) || 0) + 1);
  }

  return Array.from(issueMap.entries())
    .filter(([, count]) => count >= 3)
    .map(([issue, count]) => `${issue} (${count} occurrences)`);
}

function generatePreventionStrategies(patterns: FailurePattern[], failures: Failure[]): string[] {
  const strategies = new Set<string>();

  for (const pattern of patterns) {
    for (const strategy of pattern.preventionStrategies) {
      strategies.add(strategy);
    }
  }

  // Add general strategies based on failure types
  const typeStrategies: Record<FailureType, string[]> = {
    review_rejected: ['Ensure code follows style guidelines', 'Run linter before submitting', 'Add comprehensive tests'],
    build_failed: ['Verify dependencies are installed', 'Check for syntax errors', 'Run build locally first'],
    test_failed: ['Run tests locally before pushing', 'Check test environment setup', 'Update snapshots if needed'],
    merge_failed: ['Resolve conflicts carefully', 'Rebase before merging', 'Ensure CI passes before merge'],
    architecture_mistake: ['Review architecture decisions before implementation', 'Consult ADRs', 'Get architecture review'],
    security_issue: ['Run security scan before commit', 'Never hardcode secrets', 'Use parameterized queries'],
    performance_issue: ['Profile before optimizing', 'Use caching strategically', 'Monitor resource usage'],
  };

  for (const failure of failures) {
    const typeStrats = typeStrategies[failure.failureType];
    if (typeStrats) {
      typeStrats.forEach(s => strategies.add(s));
    }
  }

  return Array.from(strategies);
}

function generatePatternPrevention(pattern: string): string[] {
  const strategies: string[] = [];

  if (pattern.includes('undefined') || pattern.includes('null')) {
    strategies.push('Add null/undefined checks');
    strategies.push('Use TypeScript strict mode');
  }
  if (pattern.includes('import') || pattern.includes('module')) {
    strategies.push('Verify all imports are correct');
    strategies.push('Check for circular dependencies');
  }
  if (pattern.includes('type') || pattern.includes('interface')) {
    strategies.push('Ensure type definitions are complete');
    strategies.push('Run TypeScript compiler');
  }
  if (pattern.includes('test')) {
    strategies.push('Update tests for new behavior');
    strategies.push('Ensure test data is valid');
  }
  if (pattern.includes('database') || pattern.includes('query')) {
    strategies.push('Validate database migrations');
    strategies.push('Check query syntax');
  }

  if (strategies.length === 0) {
    strategies.push('Review code carefully before submission');
    strategies.push('Add comprehensive tests');
  }

  return strategies;
}

function findRiskFiles(failures: Failure[]): string[] {
  const fileFailures = new Map<string, number>();

  for (const failure of failures) {
    failure.filesAffected?.forEach(file => {
      fileFailures.set(file, (fileFailures.get(file) || 0) + 1);
    });
  }

  return Array.from(fileFailures.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([file]) => file);
}

async function findSimilarFailures(
  ctx: DBContext,
  projectId: number,
  task: Task
): Promise<Failure[]> {
  const failures = await getFailures(ctx, projectId);

  return failures.filter(f => {
    // Same failure type
    if (task.title.toLowerCase().includes(f.failureType.replace('_', ' '))) return true;

    // Same files affected
    if (task.files && f.filesAffected) {
      return task.files.some(tf => f.filesAffected!.some(af => tf.includes(af) || af.includes(tf)));
    }

    return false;
  }).slice(0, 5);
}

export function generateFailureReport(analysis: FailureAnalysis): string {
  let report = '# Failure Analysis Report\n\n';

  report += `## Summary\n`;
  report += `- Total Failures: ${analysis.totalFailures}\n`;
  report += `- Recurring Issues: ${analysis.recurringIssues.length}\n`;
  report += `- Detected Patterns: ${analysis.patterns.length}\n\n`;

  if (Object.keys(analysis.byType).length > 0) {
    report += `## Failures by Type\n`;
    for (const [type, count] of Object.entries(analysis.byType)) {
      report += `- ${type}: ${count}\n`;
    }
    report += '\n';
  }

  if (analysis.patterns.length > 0) {
    report += `## Common Failure Patterns\n`;
    for (const pattern of analysis.patterns.slice(0, 5)) {
      report += `### ${pattern.pattern}\n`;
      report += `- Frequency: ${pattern.frequency}\n`;
      report += `- Affected Files: ${pattern.affectedFiles.length}\n`;
      report += `- Solutions: ${pattern.commonSolutions.join(', ') || 'None recorded'}\n`;
      report += `- Prevention: ${pattern.preventionStrategies.join(', ')}\n\n`;
    }
  }

  if (analysis.riskFiles.length > 0) {
    report += `## High-Risk Files\n`;
    for (const file of analysis.riskFiles) {
      report += `- ${file}\n`;
    }
    report += '\n';
  }

  if (analysis.preventionStrategies.length > 0) {
    report += `## Prevention Strategies\n`;
    for (const strategy of analysis.preventionStrategies) {
      report += `- ${strategy}\n`;
    }
  }

  return report;
}
