/**
 * Hades Army v0.6.1 — Repository Intelligence Integration
 * Makes intelligence ACTIVE in every planning decision
 */

import type { RepositoryFile, DependencyGraph, ArchitectureMap, Hotspot, TechnicalDebtItem, ChangeImpact, KnowledgeGraph } from '../core/types';
import type { DBContext } from '../db';
import { getRepoFiles } from '../db';
import { buildDependencyGraph, calculateFileImportance, getCriticalFiles, getOrphanFiles } from '../intelligence/dependency-graph';
import { detectArchitecture, detectArchitectureDrift } from '../intelligence/architecture-detection';
import { detectHotspots, calculateComplexity } from '../intelligence/hotspot-detection';
import { detectTechnicalDebt, calculateTechnicalDebtScore } from '../intelligence/technical-debt';
import { analyzeChangeImpact, analyzeMultiFileImpact } from '../intelligence/impact-analysis';
import { queryKnowledgeGraph, findRelatedNodes } from '../memory/knowledge-graph';

export interface IntelligenceReport {
  projectId: number;
  timestamp: string;
  files: RepositoryFile[];
  dependencyGraph: DependencyGraph;
  architectureMap: ArchitectureMap;
  hotspots: Hotspot[];
  technicalDebt: TechnicalDebtItem[];
  technicalDebtScore: number;
  criticalFiles: string[];
  orphanFiles: string[];
  architectureDrift: Array<{
    type: string;
    description: string;
    severity: string;
  }>;
  recommendations: string[];
  knowledgeGraph?: KnowledgeGraph;
}

export interface TaskIntelligence {
  affectedFiles: string[];
  affectedModules: string[];
  architectureRisk: 'low' | 'medium' | 'high' | 'critical';
  dependencyRisk: 'low' | 'medium' | 'high' | 'critical';
  impactedHotspots: Hotspot[];
  impactedDebt: TechnicalDebtItem[];
  changeImpact: ChangeImpact[];
  knowledgeGraphPaths: string[][];
  circularDependencies: string[][];
  externalDependencies: string[];
  testCoverage: number;
  estimatedBreakingChanges: number;
  recommendations: string[];
}

// ============================================================================
// MAIN: Build full intelligence for a task
// ============================================================================

export async function buildTaskIntelligence(
  ctx: DBContext,
  projectId: number,
  taskFiles: string[]
): Promise<TaskIntelligence> {
  // 1. Get all repository files
  const allFiles = await getRepoFiles(ctx, projectId);
  const fileMap = new Map(allFiles.map(f => [f.path, f]));

  // 2. Build dependency graph
  const depGraph = buildDependencyGraph(ctx, projectId, allFiles);

  // 3. Detect architecture
  const archMap = detectArchitecture(allFiles, depGraph.edges);
  archMap.projectId = projectId;

  // 4. Detect hotspots
  const hotspots = detectHotspots(allFiles, []); // Commit history would be passed in production

  // 5. Detect technical debt
  // In production, we'd fetch file contents
  const debtItems: TechnicalDebtItem[] = [];
  const debtScore = calculateTechnicalDebtScore(debtItems);

  // 6. Analyze change impact for each task file
  const impacts = analyzeMultiFileImpact(taskFiles, allFiles, depGraph.edges, []);

  // 7. Query knowledge graph for related components
  const kg = await queryKnowledgeGraph(ctx, projectId, {});
  const kgPaths: string[][] = [];
  for (const file of taskFiles) {
    const fileNode = kg.nodes.find(n => n.name === file.split('/').pop());
    if (fileNode) {
      const related = await findRelatedNodes(ctx, projectId, fileNode.id, 2);
      const path = related.nodes.map(n => n.name);
      if (path.length > 1) kgPaths.push(path);
    }
  }

  // 8. Calculate risks
  const archRisk = calculateArchitectureRisk(archMap, taskFiles, impacts);
  const depRisk = calculateDependencyRisk(depGraph, taskFiles, allFiles);

  // 9. Find impacted hotspots and debt
  const impactedHotspots = hotspots.filter(h =>
    taskFiles.some(tf => h.filePath === tf || h.filePath.includes(tf))
  );

  const impactedDebt = debtItems.filter(d =>
    taskFiles.some(tf => d.filePath === tf || d.filePath.includes(tf))
  );

  // 10. Generate recommendations
  const recommendations = generateIntelligenceRecommendations(
    impacts, archRisk, depRisk, impactedHotspots, impactedDebt, depGraph.cycles
  );

  // 11. Calculate test coverage
  const testCoverage = calculateTestCoverage(taskFiles, allFiles);

  // 12. Estimate breaking changes
  const breakingChanges = impacts.reduce((sum, i) => sum + i.estimatedBreakingChanges, 0);

  return {
    affectedFiles: [...new Set(impacts.flatMap(i => [i.filePath, ...i.impactedFiles]))],
    affectedModules: [...new Set(impacts.flatMap(i => i.impactedModules))],
    architectureRisk: archRisk,
    dependencyRisk: depRisk,
    impactedHotspots,
    impactedDebt,
    changeImpact: impacts,
    knowledgeGraphPaths: kgPaths,
    circularDependencies: depGraph.cycles.map(c => c.files),
    externalDependencies: depGraph.externalDependencies.map(d => d.name),
    testCoverage,
    estimatedBreakingChanges: breakingChanges,
    recommendations,
  };
}

// ============================================================================
// RISK CALCULATIONS
// ============================================================================

function calculateArchitectureRisk(
  archMap: ArchitectureMap,
  taskFiles: string[],
  impacts: ChangeImpact[]
): TaskIntelligence['architectureRisk'] {
  let score = 0;

  // Check if task files span multiple layers (bad for clean architecture)
  const layersSpanned = new Set<string>();
  for (const file of taskFiles) {
    for (const layer of archMap.layers) {
      if (layer.files.some(f => file.includes(f) || f.includes(file))) {
        layersSpanned.add(layer.name);
      }
    }
  }

  if (layersSpanned.size > 2) {
    score += 30; // Spans too many layers
  }

  // Check for architecture drift
  if (archMap.architectureDrift && archMap.architectureDrift.length > 0) {
    score += archMap.architectureDrift.length * 10;
  }

  // Impact score
  const maxImpact = impacts.length > 0 ? Math.max(...impacts.map(i => i.riskScore)) : 0;
  score += maxImpact * 0.3;

  if (score >= 70) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

function calculateDependencyRisk(
  depGraph: DependencyGraph,
  taskFiles: string[],
  allFiles: RepositoryFile[]
): TaskIntelligence['dependencyRisk'] {
  let score = 0;

  // Check for circular dependencies in affected files
  const affectedCycles = depGraph.cycles.filter(cycle =>
    taskFiles.some(tf => cycle.files.some(cf => cf.includes(tf) || tf.includes(cf)))
  );
  score += affectedCycles.length * 20;

  // Check for external dependencies (harder to control)
  const affectedExternals = depGraph.externalDependencies.filter(ext =>
    taskFiles.some(tf => ext.usage.some(u => u.includes(tf) || tf.includes(u)))
  );
  score += affectedExternals.length * 5;

  // Check if critical files are affected
  const criticalFiles = getCriticalFiles(depGraph);
  const affectedCritical = criticalFiles.filter(cf =>
    taskFiles.some(tf => cf.path.includes(tf) || tf.includes(cf.path))
  );
  score += affectedCritical.length * 15;

  if (score >= 60) return 'critical';
  if (score >= 40) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

// ============================================================================
// RECOMMENDATIONS
// ============================================================================

function generateIntelligenceRecommendations(
  impacts: ChangeImpact[],
  archRisk: string,
  depRisk: string,
  hotspots: Hotspot[],
  debt: TechnicalDebtItem[],
  cycles: Array<{ files: string[]; severity: 'warning' | 'critical' }>
): string[] {
  const recs: string[] = [];

  // Architecture recommendations
  if (archRisk === 'high' || archRisk === 'critical') {
    recs.push('⚠️ HIGH ARCHITECTURE RISK: Changes may violate architectural boundaries');
    recs.push('→ Review ADRs before proceeding');
  }

  // Dependency recommendations
  if (depRisk === 'high' || depRisk === 'critical') {
    recs.push('⚠️ HIGH DEPENDENCY RISK: Changes affect critical paths');
    recs.push('→ Consider dependency injection or abstraction layers');
  }

  // Hotspot recommendations
  for (const hotspot of hotspots.slice(0, 3)) {
    recs.push(`🔥 HOTSPOT: ${hotspot.filePath} (risk: ${hotspot.riskScore}) — ${hotspot.changeFrequency} changes, ${hotspot.contributors.length} contributors`);
  }

  // Technical debt recommendations
  for (const item of debt.filter(d => d.severity === 'critical' || d.severity === 'high').slice(0, 3)) {
    recs.push(`🔧 TECHNICAL DEBT: ${item.filePath} — ${item.debtType} (${item.severity})`);
  }

  // Circular dependency recommendations
  for (const cycle of cycles.filter(c => c.severity === 'critical')) {
    recs.push(`🔄 CIRCULAR DEPENDENCY detected: ${cycle.files.join(' → ')} → ${cycle.files[0]}`);
    recs.push('→ Break the cycle before adding more dependencies');
  }

  // Impact recommendations
  const totalImpacted = impacts.reduce((sum, i) => sum + i.impactedFiles.length, 0);
  if (totalImpacted > 20) {
    recs.push(`📊 LARGE BLAST RADIUS: ${totalImpacted} files may be affected`);
    recs.push('→ Consider splitting into smaller, focused changes');
  }

  // Test coverage recommendations
  const avgCoverage = impacts.length > 0
    ? impacts.reduce((sum, i) => sum + i.testCoverage, 0) / impacts.length
    : 0;
  if (avgCoverage < 50) {
    recs.push(`🧪 LOW TEST COVERAGE: ${avgCoverage.toFixed(0)}% — Add tests before changing`);
  }

  return recs;
}

// ============================================================================
// TEST COVERAGE
// ============================================================================

function calculateTestCoverage(taskFiles: string[], allFiles: RepositoryFile[]): number {
  const testExtensions = ['.test.ts', '.test.js', '.spec.ts', '.spec.js', '_test.py'];
  let filesWithTests = 0;

  for (const file of taskFiles) {
    const basePath = file.replace(/\.(ts|js|tsx|jsx|py)$/, '');
    const hasTest = allFiles.some(f =>
      testExtensions.some(ext => f.path === basePath + ext) ||
      f.path.includes('/__tests__/') && f.path.includes(basePath.split('/').pop() || '')
    );
    if (hasTest) filesWithTests++;
  }

  return taskFiles.length > 0 ? Math.round((filesWithTests / taskFiles.length) * 100) : 0;
}

// ============================================================================
// FORMAT OUTPUT
// ============================================================================

export function formatTaskIntelligence(report: TaskIntelligence): string {
  let output = `## Task Intelligence Report

`;

  output += `### Risk Assessment
`;
  output += `- **Architecture Risk:** ${report.architectureRisk.toUpperCase()}
`;
  output += `- **Dependency Risk:** ${report.dependencyRisk.toUpperCase()}
`;
  output += `- **Test Coverage:** ${report.testCoverage}%
`;
  output += `- **Estimated Breaking Changes:** ${report.estimatedBreakingChanges}

`;

  output += `### Impact Analysis
`;
  output += `- **Affected Files:** ${report.affectedFiles.length}
`;
  output += `- **Affected Modules:** ${report.affectedModules.join(', ') || 'None'}
`;
  output += `- **Circular Dependencies:** ${report.circularDependencies.length}
`;
  output += `- **External Dependencies:** ${report.externalDependencies.length}

`;

  if (report.impactedHotspots.length > 0) {
    output += `### Hotspots Affected
`;
    for (const h of report.impactedHotspots) {
      output += `- 🔥 ${h.filePath} (risk: ${h.riskScore})
`;
    }
    output += `
`;
  }

  if (report.knowledgeGraphPaths.length > 0) {
    output += `### Knowledge Graph Impact Chains
`;
    for (const path of report.knowledgeGraphPaths) {
      output += `- ${path.join(' → ')}
`;
    }
    output += `
`;
  }

  if (report.recommendations.length > 0) {
    output += `### Recommendations
`;
    for (const rec of report.recommendations) {
      output += `- ${rec}
`;
    }
  }

  return output;
}

// ============================================================================
// VALIDATION: Check if task can proceed based on intelligence
// ============================================================================

export function validateTaskAgainstIntelligence(
  report: TaskIntelligence
): {
  valid: boolean;
  blockers: string[];
  warnings: string[];
} {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Blockers
  if (report.architectureRisk === 'critical') {
    blockers.push('Architecture risk is CRITICAL — violates architectural boundaries');
  }
  if (report.dependencyRisk === 'critical') {
    blockers.push('Dependency risk is CRITICAL — affects critical system paths');
  }
  if (report.circularDependencies.length > 0) {
    blockers.push('Circular dependencies detected — must be resolved first');
  }
  if (report.testCoverage < 20 && report.affectedFiles.length > 5) {
    blockers.push('Test coverage too low (<20%) for large change');
  }

  // Warnings
  if (report.architectureRisk === 'high') {
    warnings.push('High architecture risk — review ADRs');
  }
  if (report.dependencyRisk === 'high') {
    warnings.push('High dependency risk — may cause cascading failures');
  }
  if (report.impactedHotspots.length > 0) {
    warnings.push(`Changes affect ${report.impactedHotspots.length} hotspots`);
  }
  if (report.estimatedBreakingChanges > 3) {
    warnings.push(`May cause ${report.estimatedBreakingChanges} breaking changes`);
  }

  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
  };
}
