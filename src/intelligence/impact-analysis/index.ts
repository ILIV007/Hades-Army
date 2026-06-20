/**
 * Hades Army v0.6 - Repository Intelligence Engine
 * Change Impact Analysis
 */

import type { ChangeImpact, RepositoryFile, DependencyEdge, Symbol } from '../../core/types';

export function analyzeChangeImpact(
  filePath: string,
  files: RepositoryFile[],
  edges: DependencyEdge[],
  symbols: Symbol[]
): ChangeImpact {
  const file = files.find(f => f.path === filePath);
  if (!file) {
    return {
      filePath,
      impactedFiles: [],
      impactedModules: [],
      riskScore: 0,
      testCoverage: 0,
      estimatedBreakingChanges: 0,
    };
  }

  // Find all files that depend on this file (transitive)
  const impactedFileIds = new Set<number>();
  const visited = new Set<number>();
  const queue: number[] = [file.id];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    // Find all files that import from current file
    const dependents = edges.filter(e => e.targetFileId === currentId && !e.isExternal);
    for (const dep of dependents) {
      impactedFileIds.add(dep.sourceFileId);
      queue.push(dep.sourceFileId);
    }
  }

  // Remove the original file
  impactedFileIds.delete(file.id);

  const impactedFiles = Array.from(impactedFileIds)
    .map(id => files.find(f => f.id === id)?.path)
    .filter((p): p is string => p !== undefined);

  // Determine impacted modules
  const impactedModules = [...new Set(impactedFiles.map(path => {
    const parts = path.split('/');
    return parts.length > 1 ? parts[1] : parts[0];
  }))];

  // Calculate risk score
  const riskScore = calculateRiskScore(file, impactedFiles.length, impactedModules.length, files);

  // Estimate breaking changes
  const fileSymbols = symbols.filter(s => s.fileId === file.id && s.isExported);
  const estimatedBreakingChanges = fileSymbols.length > 0 
    ? Math.ceil(fileSymbols.length * 0.3) 
    : 0;

  return {
    filePath,
    impactedFiles,
    impactedModules,
    riskScore,
    testCoverage: estimateTestCoverage(filePath, files),
    estimatedBreakingChanges,
  };
}

function calculateRiskScore(
  file: RepositoryFile,
  impactedFileCount: number,
  impactedModuleCount: number,
  allFiles: RepositoryFile[]
): number {
  let score = 0;

  // Base risk from file importance
  score += file.importanceScore * 0.3;

  // Risk from number of impacted files
  const impactRatio = allFiles.length > 0 ? impactedFileCount / allFiles.length : 0;
  score += impactRatio * 100 * 0.3;

  // Risk from module spread
  score += Math.min(impactedModuleCount * 10, 30);

  // Risk from complexity
  score += Math.min(file.complexity * 0.5, 20);

  // Risk from being a hotspot
  if (file.isHotspot) score += 20;

  // Risk from technical debt
  score += file.technicalDebtScore * 0.1;

  return Math.min(Math.round(score), 100);
}

function estimateTestCoverage(filePath: string, allFiles: RepositoryFile[]): number {
  // Look for test files related to this file
  const possibleTestPaths = [
    filePath.replace(/\.(ts|js|tsx|jsx)$/, '.test.$1'),
    filePath.replace(/\.(ts|js|tsx|jsx)$/, '.spec.$1'),
    filePath.replace(/\/(src|lib)\//, '/__tests__/'),
    filePath.replace(/\.(ts|js|tsx|jsx)$/, '_test.$1'),
  ];

  const hasTest = possibleTestPaths.some(path => 
    allFiles.some(f => f.path === path)
  );

  // Look for test directories
  const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
  const hasTestDir = allFiles.some(f => 
    f.path.includes(`${fileDir}/__tests__/`) || 
    f.path.includes(`${fileDir}/tests/`)
  );

  if (hasTest) return 80;
  if (hasTestDir) return 50;
  return 20;
}

export function analyzeMultiFileImpact(
  filePaths: string[],
  files: RepositoryFile[],
  edges: DependencyEdge[],
  symbols: Symbol[]
): ChangeImpact[] {
  return filePaths.map(path => analyzeChangeImpact(path, files, edges, symbols));
}

export function getHighestRiskChanges(impacts: ChangeImpact[], limit: number = 5): ChangeImpact[] {
  return impacts
    .filter(i => i.riskScore > 0)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, limit);
}

export function generateImpactReport(impacts: ChangeImpact[]): string {
  const highRisk = impacts.filter(i => i.riskScore >= 70);
  const mediumRisk = impacts.filter(i => i.riskScore >= 40 && i.riskScore < 70);
  const lowRisk = impacts.filter(i => i.riskScore > 0 && i.riskScore < 40);

  let report = '## Change Impact Analysis Report\n\n';

  report += `**Total Files Changed:** ${impacts.length}\n`;
  report += `**High Risk:** ${highRisk.length}\n`;
  report += `**Medium Risk:** ${mediumRisk.length}\n`;
  report += `**Low Risk:** ${lowRisk.length}\n\n`;

  if (highRisk.length > 0) {
    report += '### High Risk Changes\n\n';
    for (const impact of highRisk) {
      report += `- **${impact.filePath}** (Risk: ${impact.riskScore})\n`;
      report += `  - Impacted Files: ${impact.impactedFiles.length}\n`;
      report += `  - Impacted Modules: ${impact.impactedModules.join(', ')}\n`;
      report += `  - Estimated Breaking Changes: ${impact.estimatedBreakingChanges}\n`;
      report += `  - Test Coverage: ${impact.testCoverage}%\n\n`;
    }
  }

  if (mediumRisk.length > 0) {
    report += '### Medium Risk Changes\n\n';
    for (const impact of mediumRisk) {
      report += `- **${impact.filePath}** (Risk: ${impact.riskScore})\n`;
      report += `  - Impacted Files: ${impact.impactedFiles.length}\n`;
      report += `  - Test Coverage: ${impact.testCoverage}%\n\n`;
    }
  }

  return report;
}
