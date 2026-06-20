/**
 * Hades Army v0.6 - Repository Intelligence Engine
 * Technical Debt Detection
 */

import type { TechnicalDebtItem, DebtType, RepositoryFile } from '../../core/types';

interface DebtPattern {
  type: DebtType;
  regex: RegExp;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  estimatedEffort: number;
}

const DEBT_PATTERNS: DebtPattern[] = [
  // Code smells
  {
    type: 'code_smell',
    regex: /\/\/\s*TODO|FIXME|HACK|XXX|BUG/gi,
    severity: 'medium',
    description: 'Unresolved TODO/FIXME comments',
    estimatedEffort: 2,
  },
  {
    type: 'code_smell',
    regex: /console\.(log|warn|error|debug)\(/g,
    severity: 'low',
    description: 'Console statements in production code',
    estimatedEffort: 1,
  },
  {
    type: 'code_smell',
    regex: /\/\/\s*eslint-disable|\/\*\s*eslint-disable/g,
    severity: 'medium',
    description: 'Disabled linting rules',
    estimatedEffort: 3,
  },
  // Complexity
  {
    type: 'complexity',
    regex: /function.*\{[\s\S]{2000,}\}/g,
    severity: 'high',
    description: 'Very long function (>2000 chars)',
    estimatedEffort: 4,
  },
  // Duplication indicators
  {
    type: 'duplication',
    regex: /\/\/\s*Copied from|\/\/\s*Duplicate|same as above/gi,
    severity: 'medium',
    description: 'Potential code duplication',
    estimatedEffort: 3,
  },
  // Missing tests
  {
    type: 'missing_tests',
    regex: /test\.(skip|todo|only)\(/g,
    severity: 'medium',
    description: 'Skipped or pending tests',
    estimatedEffort: 2,
  },
  // Documentation
  {
    type: 'documentation',
    regex: /^(?!.*\/\*\*).*function\s+\w+\s*\([^)]*\)(?!.*\{)/gm,
    severity: 'low',
    description: 'Public function without JSDoc',
    estimatedEffort: 1,
  },
  // Security
  {
    type: 'security',
    regex: /eval\s*\(|new\s+Function\s*\(|innerHTML\s*=|document\.write\s*\(/g,
    severity: 'critical',
    description: 'Potentially unsafe code patterns',
    estimatedEffort: 5,
  },
  {
    type: 'security',
    regex: /process\.env\.[A-Z_]+\s*\|\|\s*['"]\w+['"]/g,
    severity: 'high',
    description: 'Hardcoded fallback values for environment variables',
    estimatedEffort: 2,
  },
  // Outdated dependencies
  {
    type: 'outdated_dependency',
    regex: /"version"\s*:\s*"\^?0\./g,
    severity: 'medium',
    description: 'Using 0.x version dependencies',
    estimatedEffort: 4,
  },
];

export function detectTechnicalDebt(files: RepositoryFile[], contents: Map<string, string>): TechnicalDebtItem[] {
  const debts: TechnicalDebtItem[] = [];

  for (const file of files) {
    const content = contents.get(file.path);
    if (!content) continue;

    for (const pattern of DEBT_PATTERNS) {
      const matches = content.match(pattern.regex);
      if (matches && matches.length > 0) {
        for (const match of matches) {
          const lineNumber = content.substring(0, content.indexOf(match)).split('
').length;

          debts.push({
            filePath: file.path,
            debtType: pattern.type,
            severity: pattern.severity,
            description: `${pattern.description} at line ${lineNumber}`,
            estimatedEffort: pattern.estimatedEffort,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    // Check file-level metrics
    const lines = content.split('
');
    const lineCount = lines.length;

    // Large file
    if (lineCount > 500) {
      debts.push({
        filePath: file.path,
        debtType: 'complexity',
        severity: lineCount > 1000 ? 'high' : 'medium',
        description: `Large file: ${lineCount} lines (consider splitting)`,
        estimatedEffort: Math.ceil(lineCount / 200),
        createdAt: new Date().toISOString(),
      });
    }

    // High complexity
    if (file.complexity > 30) {
      debts.push({
        filePath: file.path,
        debtType: 'complexity',
        severity: file.complexity > 50 ? 'critical' : 'high',
        description: `High cyclomatic complexity: ${file.complexity}`,
        estimatedEffort: Math.ceil(file.complexity / 10),
        createdAt: new Date().toISOString(),
      });
    }
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  return debts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

export function calculateTechnicalDebtScore(debts: TechnicalDebtItem[]): number {
  const severityWeights = { critical: 20, high: 10, medium: 5, low: 1 };
  let totalScore = 0;
  let maxPossible = 0;

  for (const debt of debts) {
    totalScore += severityWeights[debt.severity] * debt.estimatedEffort;
    maxPossible += severityWeights.critical * 10; // normalize
  }

  return Math.min((totalScore / Math.max(maxPossible, 1)) * 100, 100);
}

export function getDebtSummary(debts: TechnicalDebtItem[]): {
  total: number;
  byType: Record<DebtType, number>;
  bySeverity: Record<string, number>;
  totalEffort: number;
  criticalFiles: string[];
} {
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let totalEffort = 0;
  const criticalFiles = new Set<string>();

  for (const debt of debts) {
    byType[debt.debtType] = (byType[debt.debtType] || 0) + 1;
    bySeverity[debt.severity] = (bySeverity[debt.severity] || 0) + 1;
    totalEffort += debt.estimatedEffort;

    if (debt.severity === 'critical' || debt.severity === 'high') {
      criticalFiles.add(debt.filePath);
    }
  }

  return {
    total: debts.length,
    byType: byType as Record<DebtType, number>,
    bySeverity,
    totalEffort,
    criticalFiles: Array.from(criticalFiles),
  };
}
