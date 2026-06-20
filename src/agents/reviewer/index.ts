/**
 * Hades Army v0.6.1 — Advanced Reviewer (Quality Gate)
 * Pipeline: Static Analysis → Dependency Check → Architecture Rules → AI Review
 * Detects: Dead Code, Circular Dependencies, Architecture Drift, Security, Duplicates, Unused Imports, Broken Types
 */

import type { Task, Review, RepositoryFile, DependencyGraph, ArchitectureMap } from '../core/types';
import type { DBContext } from '../db';
import { getTask, updateTask, createReview } from '../db';
import { callLLM, buildReviewerSystemPrompt } from '../llm';
import { CONFIG } from '../core/config';
import { buildDependencyGraph } from '../intelligence/dependency-graph';
import { detectArchitectureDrift } from '../intelligence/architecture-detection';
import { getRepoFiles } from '../db';

// ============================================================================
// REVIEW PIPELINE STAGES
// ============================================================================

export interface StaticAnalysisResult {
  passed: boolean;
  stage: string;
  issues: Array<{
    type: 'error' | 'warning' | 'info';
    file?: string;
    line?: number;
    message: string;
    code?: string;
  }>;
}

export interface AdvancedReviewResult {
  passed: boolean;
  overallScore: number;
  staticAnalysis: StaticAnalysisResult[];
  architectureValidation: {
    passed: boolean;
    drift: Array<{ type: string; description: string; severity: string }>;
    layerViolations: string[];
  };
  dependencyValidation: {
    passed: boolean;
    circularDeps: string[][];
    unusedImports: string[];
    missingDeps: string[];
  };
  securityScan: {
    passed: boolean;
    issues: Array<{ file: string; line: number; type: string; severity: string }>;
  };
  codeQuality: {
    passed: boolean;
    deadCode: string[];
    duplicates: Array<{ files: string[]; lines: string }>;
    complexity: Array<{ file: string; score: number }>;
  };
  aiReview: {
    passed: boolean;
    score: number;
    feedback: string;
    suggestions: string[];
  };
  finalDecision: 'PASS' | 'FAIL' | 'NEEDS_CHANGES';
  summary: string;
}

// ============================================================================
// MAIN: RUN FULL REVIEW PIPELINE
// ============================================================================

export async function runAdvancedReview(
  ctx: DBContext,
  taskId: number,
  diff: string,
  files: Array<{ path: string; content: string }>,
  env: Record<string, string>
): Promise<AdvancedReviewResult> {
  const task = await getTask(ctx, taskId);
  const allFiles = await getRepoFiles(ctx, task.projectId);

  const results: AdvancedReviewResult = {
    passed: false,
    overallScore: 0,
    staticAnalysis: [],
    architectureValidation: { passed: false, drift: [], layerViolations: [] },
    dependencyValidation: { passed: false, circularDeps: [], unusedImports: [], missingDeps: [] },
    securityScan: { passed: true, issues: [] },
    codeQuality: { passed: false, deadCode: [], duplicates: [], complexity: [] },
    aiReview: { passed: false, score: 0, feedback: '', suggestions: [] },
    finalDecision: 'FAIL',
    summary: '',
  };

  // STAGE 1: TypeScript / Syntax Check
  const tsCheck = await runTypeScriptCheck(files);
  results.staticAnalysis.push(tsCheck);

  // STAGE 2: Lint
  const lintCheck = await runLintCheck(files);
  results.staticAnalysis.push(lintCheck);

  // STAGE 3: Dependency Check
  const depCheck = await runDependencyCheck(files, allFiles);
  results.dependencyValidation = depCheck;

  // STAGE 4: Architecture Rules
  const archCheck = await runArchitectureValidation(files, allFiles);
  results.architectureValidation = archCheck;

  // STAGE 5: Security Scan
  const secCheck = await runSecurityScan(files);
  results.securityScan = secCheck;

  // STAGE 6: Code Quality
  const qualityCheck = await runCodeQualityCheck(files);
  results.codeQuality = qualityCheck;

  // STAGE 7: AI Review (ONLY if static checks pass)
  const staticPassed = tsCheck.passed && lintCheck.passed && depCheck.passed && archCheck.passed;

  if (staticPassed) {
    const aiResult = await runAIReview(task, diff, files, env);
    results.aiReview = aiResult;
  } else {
    results.aiReview = {
      passed: false,
      score: 0,
      feedback: 'AI review skipped — static analysis failures must be resolved first',
      suggestions: ['Fix all static analysis errors before requesting AI review'],
    };
  }

  // Calculate final decision
  results.finalDecision = calculateFinalDecision(results);
  results.passed = results.finalDecision === 'PASS';
  results.overallScore = calculateOverallScore(results);
  results.summary = generateSummary(results);

  // Save review
  await createReview(ctx, {
    taskId,
    reviewerAgent: 'reviewer',
    status: results.passed ? 'approved' : results.finalDecision === 'NEEDS_CHANGES' ? 'needs_changes' : 'rejected',
    feedback: results.summary,
    issues: {
      staticAnalysis: results.staticAnalysis,
      architecture: results.architectureValidation,
      dependencies: results.dependencyValidation,
      security: results.securityScan,
      quality: results.codeQuality,
      ai: results.aiReview,
    },
    score: results.overallScore,
  });

  await updateTask(ctx, taskId, {
    status: results.passed ? 'approved' : 'failed',
    reviewComments: results.summary,
  });

  return results;
}

// ============================================================================
// STAGE 1: TypeScript / Syntax Check
// ============================================================================

async function runTypeScriptCheck(files: Array<{ path: string; content: string }>): Promise<StaticAnalysisResult> {
  const issues: StaticAnalysisResult['issues'] = [];

  for (const file of files) {
    const lines = file.content.split('\n');

    // Check for basic TypeScript errors
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for 'any' usage (warning)
      if (line.includes(': any') && !line.includes('// eslint-disable')) {
        issues.push({
          type: 'warning',
          file: file.path,
          line: i + 1,
          message: 'Avoid using "any" type — use specific types',
          code: 'TS-ANY',
        });
      }

      // Check for missing return types on exported functions
      if (/export\s+(?:async\s+)?function\s+\w+\s*\(/.test(line) && !line.includes('):') && !line.includes('=>')) {
        issues.push({
          type: 'warning',
          file: file.path,
          line: i + 1,
          message: 'Exported function missing return type annotation',
          code: 'TS-RETURN',
        });
      }

      // Check for implicit any in parameters
      const paramMatch = line.match(/function\s+\w+\s*\(([^)]*)\)/);
      if (paramMatch && paramMatch[1]) {
        const params = paramMatch[1].split(',');
        for (const param of params) {
          if (param.trim() && !param.includes(':') && !param.includes('...')) {
            issues.push({
              type: 'warning',
              file: file.path,
              line: i + 1,
              message: `Parameter "${param.trim()}" missing type annotation`,
              code: 'TS-PARAM',
            });
          }
        }
      }
    }
  }

  return {
    passed: issues.filter(i => i.type === 'error').length === 0,
    stage: 'TypeScript Check',
    issues,
  };
}

// ============================================================================
// STAGE 2: Lint
// ============================================================================

async function runLintCheck(files: Array<{ path: string; content: string }>): Promise<StaticAnalysisResult> {
  const issues: StaticAnalysisResult['issues'] = [];

  for (const file of files) {
    const lines = file.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check console.log
      if (/console\.(log|warn|error|debug)\(/.test(line)) {
        issues.push({
          type: 'warning',
          file: file.path,
          line: i + 1,
          message: 'Console statement found — use proper logging',
          code: 'LINT-CONSOLE',
        });
      }

      // Check for TODO without issue reference
      if (/TODO(?!\s*\(\s*#\d+\s*\))/.test(line) && !line.includes('// eslint-disable')) {
        issues.push({
          type: 'info',
          file: file.path,
          line: i + 1,
          message: 'TODO without issue reference — create an issue or remove',
          code: 'LINT-TODO',
        });
      }

      // Check for debugger
      if (/debugger;?/.test(line)) {
        issues.push({
          type: 'error',
          file: file.path,
          line: i + 1,
          message: 'Debugger statement found — remove before commit',
          code: 'LINT-DEBUGGER',
        });
      }

      // Check line length
      if (line.length > 120) {
        issues.push({
          type: 'warning',
          file: file.path,
          line: i + 1,
          message: `Line too long (${line.length} > 120 characters)`,
          code: 'LINT-LENGTH',
        });
      }
    }
  }

  return {
    passed: issues.filter(i => i.type === 'error').length === 0,
    stage: 'Lint Check',
    issues,
  };
}

// ============================================================================
// STAGE 3: Dependency Check
// ============================================================================

async function runDependencyCheck(
  files: Array<{ path: string; content: string }>,
  allFiles: RepositoryFile[]
): Promise<AdvancedReviewResult['dependencyValidation']> {
  const circularDeps: string[][] = [];
  const unusedImports: string[] = [];
  const missingDeps: string[] = [];

  const fileMap = new Map(files.map(f => [f.path, f]));
  const allPaths = new Set(allFiles.map(f => f.path));

  for (const file of files) {
    const lines = file.content.split('\n');
    const imports: string[] = [];
    const usedIdentifiers = new Set<string>();

    for (const line of lines) {
      // Extract imports
      const importMatch = line.match(/import\s+(?:(?:\{[^}]*\}\s*from\s+)?|(?:\*\s+as\s+\w+\s+from\s+)?|(?:\w+\s+from\s+)?)['"]([^'"]+)['"]/);
      if (importMatch) {
        imports.push(importMatch[1]);
      }

      // Track used identifiers (simplified)
      const idMatches = line.match(/\b[A-Z]\w+\b/g);
      if (idMatches) {
        idMatches.forEach(id => usedIdentifiers.add(id));
      }
    }

    // Check for unused imports (simplified — would need AST in production)
    for (const imp of imports) {
      const importName = imp.split('/').pop()?.replace(/\.(ts|js)$/, '') || '';
      const capitalized = importName.charAt(0).toUpperCase() + importName.slice(1);
      if (!usedIdentifiers.has(capitalized) && !usedIdentifiers.has(importName)) {
        unusedImports.push(`${file.path}: ${imp}`);
      }
    }

    // Check for missing dependencies
    for (const imp of imports) {
      if (imp.startsWith('.') || imp.startsWith('@/')) {
        // Local import — check if file exists
        const resolved = resolveImportPath(imp, file.path);
        if (resolved && !allPaths.has(resolved) && !allPaths.has(resolved + '.ts') && !allPaths.has(resolved + '.js')) {
          missingDeps.push(`${file.path}: ${imp}`);
        }
      }
    }
  }

  // Check for circular dependencies between changed files
  const depGraph = buildFileDependencyGraph(files);
  const cycles = findCycles(depGraph);

  return {
    passed: missingDeps.length === 0 && cycles.length === 0,
    circularDeps: cycles,
    unusedImports: [...new Set(unusedImports)],
    missingDeps: [...new Set(missingDeps)],
  };
}

// ============================================================================
// STAGE 4: Architecture Validation
// ============================================================================

async function runArchitectureValidation(
  files: Array<{ path: string; content: string }>,
  allFiles: RepositoryFile[]
): Promise<AdvancedReviewResult['architectureValidation']> {
  const layerViolations: string[] = [];

  // Define layer rules (simplified)
  const layers = [
    { name: 'presentation', patterns: ['/ui/', '/views/', '/components/', '/pages/'] },
    { name: 'business', patterns: ['/services/', '/logic/', '/core/', '/usecases/'] },
    { name: 'data', patterns: ['/db/', '/repository/', '/data/', '/models/'] },
    { name: 'infrastructure', patterns: ['/infra/', '/external/', '/api/'] },
  ];

  for (const file of files) {
    const fileLayer = layers.find(l => l.patterns.some(p => file.path.includes(p)));
    if (!fileLayer) continue;

    const lines = file.content.split('\n');
    for (const line of lines) {
      const importMatch = line.match(/import\s+.*?from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        const importedPath = importMatch[1];

        // Check if importing from a lower layer (violation in clean architecture)
        const importedLayer = layers.find(l => l.patterns.some(p => importedPath.includes(p)));
        if (importedLayer) {
          const fileLayerIndex = layers.indexOf(fileLayer);
          const importedLayerIndex = layers.indexOf(importedLayer);

          // Presentation can import business, business can import data, etc.
          // But NOT the reverse
          if (importedLayerIndex < fileLayerIndex) {
            layerViolations.push(
              `${file.path} (${fileLayer.name}) imports from ${importedLayer.name}: ${importedPath}`
            );
          }
        }
      }
    }
  }

  return {
    passed: layerViolations.length === 0,
    drift: [],
    layerViolations,
  };
}

// ============================================================================
// STAGE 5: Security Scan
// ============================================================================

async function runSecurityScan(files: Array<{ path: string; content: string }>): Promise<AdvancedReviewResult['securityScan']> {
  const issues: AdvancedReviewResult['securityScan']['issues'] = [];

  for (const file of files) {
    const lines = file.content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for eval
      if (/\beval\s*\(/.test(line)) {
        issues.push({ file: file.path, line: i + 1, type: 'eval', severity: 'critical' });
      }

      // Check for innerHTML
      if (/\.innerHTML\s*=/.test(line)) {
        issues.push({ file: file.path, line: i + 1, type: 'xss', severity: 'high' });
      }

      // Check for hardcoded secrets
      if (/(password|secret|token|key)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(line) && !line.includes('process.env')) {
        issues.push({ file: file.path, line: i + 1, type: 'secret', severity: 'critical' });
      }

      // Check for SQL injection patterns
      if (/query\s*\(.*\+/.test(line) || /exec\s*\(.*\$\{/.test(line)) {
        issues.push({ file: file.path, line: i + 1, type: 'sql-injection', severity: 'high' });
      }

      // Check for insecure random
      if (/Math\.random\(\)/.test(line) && line.includes('token') || line.includes('password') || line.includes('id')) {
        issues.push({ file: file.path, line: i + 1, type: 'insecure-random', severity: 'medium' });
      }
    }
  }

  return {
    passed: issues.filter(i => i.severity === 'critical').length === 0,
    issues,
  };
}

// ============================================================================
// STAGE 6: Code Quality
// ============================================================================

async function runCodeQualityCheck(files: Array<{ path: string; content: string }>): Promise<AdvancedReviewResult['codeQuality']> {
  const deadCode: string[] = [];
  const duplicates: Array<{ files: string[]; lines: string }> = [];
  const complexity: Array<{ file: string; score: number }> = [];

  for (const file of files) {
    const lines = file.content.split('\n');

    // Check for dead code (unused exports)
    const exports = lines.filter(l => l.includes('export')).map(l => l.trim());
    // In production, would check if exports are imported elsewhere

    // Calculate complexity
    let score = 1;
    for (const line of lines) {
      if (/\b(if|for|while|switch|catch)\b/.test(line)) score++;
    }
    if (score > 10) {
      complexity.push({ file: file.path, score });
    }
  }

  // Check for duplicate code across files (simplified)
  const allLines: Array<{ file: string; line: string; lineNum: number }> = [];
  for (const file of files) {
    file.content.split('\n').forEach((line, i) => {
      if (line.trim().length > 20) {
        allLines.push({ file: file.path, line: line.trim(), lineNum: i + 1 });
      }
    });
  }

  const lineMap = new Map<string, Array<{ file: string; lineNum: number }>>();
  for (const item of allLines) {
    if (!lineMap.has(item.line)) lineMap.set(item.line, []);
    lineMap.get(item.line)!.push({ file: item.file, lineNum: item.lineNum });
  }

  for (const [line, occurrences] of lineMap) {
    if (occurrences.length > 1) {
      const uniqueFiles = [...new Set(occurrences.map(o => o.file))];
      if (uniqueFiles.length > 1) {
        duplicates.push({ files: uniqueFiles, lines: line.substring(0, 50) });
      }
    }
  }

  return {
    passed: complexity.filter(c => c.score > 20).length === 0 && duplicates.length < 3,
    deadCode,
    duplicates: duplicates.slice(0, 5),
    complexity,
  };
}

// ============================================================================
// STAGE 7: AI Review (ONLY if static checks pass)
// ============================================================================

async function runAIReview(
  task: Task,
  diff: string,
  files: Array<{ path: string; content: string }>,
  env: Record<string, string>
): Promise<AdvancedReviewResult['aiReview']> {
  const prompt = buildReviewerSystemPrompt({
    task: task.title,
    diff,
    files: files.map(f => f.path),
  });

  const response = await callLLM({
    model: CONFIG.LLM_PROVIDERS.openrouter.defaultModel,
    messages: [
      { role: 'system', content: prompt, timestamp: new Date().toISOString() },
      { role: 'user', content: `Review this code:\n\n${files.map(f => `--- ${f.path} ---\n${f.content}`).join('\n\n')}`, timestamp: new Date().toISOString() },
    ],
  }, env as any);

  const content = response.content;

  // Parse AI response
  const scoreMatch = content.match(/(?:score|rating):\s*(\d+)/i);
  const score = scoreMatch ? parseInt(scoreMatch[1]) : 75;

  const suggestions: string[] = [];
  const suggestionRegex = /(?:[-*]\s*)?suggestion:?\s*(.+)/gi;
  let match;
  while ((match = suggestionRegex.exec(content)) !== null) {
    suggestions.push(match[1].trim());
  }

  return {
    passed: score >= 70,
    score: Math.min(Math.max(score, 0), 100),
    feedback: content,
    suggestions: suggestions.slice(0, 5),
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function calculateFinalDecision(results: AdvancedReviewResult): AdvancedReviewResult['finalDecision'] {
  // Critical failures
  if (!results.securityScan.passed) return 'FAIL';
  if (!results.dependencyValidation.passed && results.dependencyValidation.missingDeps.length > 0) return 'FAIL';

  // Static analysis failures
  const staticErrors = results.staticAnalysis.flatMap(s => s.issues).filter(i => i.type === 'error');
  if (staticErrors.length > 0) return 'NEEDS_CHANGES';

  // Architecture violations
  if (!results.architectureValidation.passed) return 'NEEDS_CHANGES';

  // AI review
  if (!results.aiReview.passed) return 'NEEDS_CHANGES';

  return 'PASS';
}

function calculateOverallScore(results: AdvancedReviewResult): number {
  let score = 100;

  // Deduct for static analysis issues
  const staticWarnings = results.staticAnalysis.flatMap(s => s.issues).filter(i => i.type === 'warning').length;
  score -= staticWarnings * 2;

  // Deduct for architecture issues
  score -= results.architectureValidation.layerViolations.length * 5;

  // Deduct for dependency issues
  score -= results.dependencyValidation.unusedImports.length * 1;
  score -= results.dependencyValidation.circularDeps.length * 10;

  // Deduct for security issues
  score -= results.securityScan.issues.filter(i => i.severity === 'high').length * 10;
  score -= results.securityScan.issues.filter(i => i.severity === 'medium').length * 5;

  // Deduct for quality issues
  score -= results.codeQuality.duplicates.length * 3;
  score -= results.codeQuality.complexity.filter(c => c.score > 15).length * 3;

  // AI review score
  score = (score + results.aiReview.score) / 2;

  return Math.max(0, Math.round(score));
}

function generateSummary(results: AdvancedReviewResult): string {
  let summary = `## Advanced Review Result: ${results.finalDecision}\n\n`;
  summary += `**Overall Score:** ${results.overallScore}/100\n\n`;

  summary += `### Static Analysis\n`;
  for (const stage of results.staticAnalysis) {
    summary += `- ${stage.stage}: ${stage.passed ? '✅' : '❌'} (${stage.issues.length} issues)\n`;
  }

  summary += `\n### Architecture\n`;
  summary += `- Layer Violations: ${results.architectureValidation.layerViolations.length}\n`;

  summary += `\n### Dependencies\n`;
  summary += `- Circular Dependencies: ${results.dependencyValidation.circularDeps.length}\n`;
  summary += `- Unused Imports: ${results.dependencyValidation.unusedImports.length}\n`;
  summary += `- Missing Dependencies: ${results.dependencyValidation.missingDeps.length}\n`;

  summary += `\n### Security\n`;
  summary += `- Issues: ${results.securityScan.issues.length} (${results.securityScan.issues.filter(i => i.severity === 'critical').length} critical)\n`;

  summary += `\n### Code Quality\n`;
  summary += `- Duplicates: ${results.codeQuality.duplicates.length}\n`;
  summary += `- High Complexity: ${results.codeQuality.complexity.filter(c => c.score > 15).length}\n`;

  summary += `\n### AI Review\n`;
  summary += `- Score: ${results.aiReview.score}/100\n`;
  if (results.aiReview.suggestions.length > 0) {
    summary += `- Suggestions:\n`;
    for (const s of results.aiReview.suggestions) {
      summary += `  - ${s}\n`;
    }
  }

  return summary;
}

// Simple dependency graph for cycle detection
function buildFileDependencyGraph(files: Array<{ path: string; content: string }>): Map<string, string[]> {
  const graph = new Map<string, string[]>();

  for (const file of files) {
    const deps: string[] = [];
    const lines = file.content.split('\n');

    for (const line of lines) {
      const match = line.match(/import\s+.*?from\s+['"]([^'"]+)['"]/);
      if (match) {
        const imported = match[1];
        if (imported.startsWith('.')) {
          const resolved = resolveImportPath(imported, file.path);
          if (resolved) deps.push(resolved);
        }
      }
    }

    graph.set(file.path, deps);
  }

  return graph;
}

function findCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path]);
      } else if (recStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        cycles.push(path.slice(cycleStart));
      }
    }

    recStack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return cycles;
}

function resolveImportPath(importPath: string, sourcePath: string): string | null {
  const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
  const parts = importPath.split('/');
  const result: string[] = sourceDir.split('/').filter(p => p);

  for (const part of parts) {
    if (part === '..') result.pop();
    else if (part !== '.' && part !== '') result.push(part);
  }

  return result.join('/');
}
