/**
 * Hades Army v0.6 - Repository Intelligence Engine
 * Main Orchestrator
 */

import type { 
  RepositoryFile, DependencyGraph, ArchitectureMap, Hotspot, 
  TechnicalDebtItem, ChangeImpact, Symbol, FunctionSymbol, ClassSymbol 
} from '../core/types';
import type { DBContext } from '../db';
import { getFileContent, scanRepository, getCommitHistory, getCommitFiles, type GitHubContext } from '../github';
import { parseGeneric, detectLanguage, calculateComplexity } from './parser';
import { buildDependencyGraph, calculateFileImportance } from './dependency-graph';
import { detectArchitecture, detectArchitectureDrift } from './architecture-detection';
import { detectHotspots } from './hotspot-detection';
import { detectTechnicalDebt, calculateTechnicalDebtScore } from './technical-debt';
import { analyzeChangeImpact, analyzeMultiFileImpact } from './impact-analysis';
import { createRepoFile, updateRepoFile, getRepoFiles } from '../db';

export interface IntelligenceReport {
  projectId: number;
  timestamp: string;
  fileCount: number;
  languages: Record<string, number>;
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
}

export async function analyzeRepository(
  ctx: DBContext,
  githubCtx: GitHubContext,
  projectId: number,
  previousReport?: IntelligenceReport
): Promise<IntelligenceReport> {
  // Step 1: Scan repository
  const { files: githubFiles, languages, totalSize, fileCount } = await scanRepository(githubCtx);

  // Step 2: Parse each file
  const parsedFiles: RepositoryFile[] = [];
  const fileContents = new Map<string, string>();
  const allSymbols: Symbol[] = [];
  const allFunctions: FunctionSymbol[] = [];
  const allClasses: ClassSymbol[] = [];

  for (const ghFile of githubFiles) {
    if (ghFile.size > 1024 * 1024) continue; // Skip files > 1MB

    try {
      const content = await getFileContent(githubCtx, ghFile.path);
      fileContents.set(ghFile.path, content);

      const language = detectLanguage(ghFile.name);
      const parseResult = parseGeneric(content, ghFile.name, language);
      const complexity = calculateComplexity(content, language);

      const repoFile: RepositoryFile = {
        id: 0,
        projectId,
        path: ghFile.path,
        name: ghFile.name,
        extension: language,
        language,
        size: ghFile.size,
        lines: content.split('\n').length,
        complexity,
        importanceScore: 0, // Will be calculated after graph build
        lastModified: undefined,
        imports: parseResult.imports,
        exports: parseResult.exports,
        functions: parseResult.functions,
        classes: parseResult.classes,
        symbols: parseResult.symbols,
        dependencies: parseResult.dependencies,
        dependents: [],
        isHotspot: false,
        technicalDebtScore: 0,
      };

      parsedFiles.push(repoFile);
      allSymbols.push(...parseResult.symbols);
      allFunctions.push(...parseResult.functions);
      allClasses.push(...parseResult.classes);
    } catch {
      // Skip files that can't be parsed
    }
  }

  // Step 3: Build dependency graph
  const dependencyGraph = buildDependencyGraph(ctx, projectId, parsedFiles);

  // Step 4: Calculate importance scores
  for (const file of parsedFiles) {
    file.importanceScore = calculateFileImportance(file, parsedFiles);
    file.dependents = dependencyGraph.edges
      .filter(e => e.targetFileId === file.id && !e.isExternal)
      .map(e => parsedFiles.find(f => f.id === e.sourceFileId)?.path)
      .filter((p): p is string => p !== undefined);
  }

  // Step 5: Detect architecture
  const architectureMap = detectArchitecture(parsedFiles, dependencyGraph.edges);
  architectureMap.projectId = projectId;

  // Step 6: Detect hotspots (requires commit history)
  const commitHistory = await fetchCommitHistory(githubCtx, parsedFiles);
  const hotspots = detectHotspots(parsedFiles, commitHistory);

  // Mark hotspot files
  for (const hotspot of hotspots) {
    const file = parsedFiles.find(f => f.path === hotspot.filePath);
    if (file) file.isHotspot = true;
  }

  // Step 7: Detect technical debt
  const technicalDebt = detectTechnicalDebt(parsedFiles, fileContents);
  const technicalDebtScore = calculateTechnicalDebtScore(technicalDebt);

  // Update files with debt scores
  for (const file of parsedFiles) {
    file.technicalDebtScore = technicalDebt
      .filter(d => d.filePath === file.path)
      .reduce((sum, d) => sum + (d.severity === 'critical' ? 20 : d.severity === 'high' ? 10 : d.severity === 'medium' ? 5 : 1), 0);
  }

  // Step 8: Detect architecture drift
  const architectureDrift = previousReport 
    ? detectArchitectureDrift(architectureMap, previousReport.architectureMap)
    : [];

  // Step 9: Generate recommendations
  const recommendations = generateRecommendations(
    dependencyGraph, architectureMap, hotspots, technicalDebt, parsedFiles
  );

  // Step 10: Save to database
  await saveIntelligenceData(ctx, projectId, parsedFiles, dependencyGraph, allSymbols);

  // Identify critical and orphan files
  const criticalFiles = parsedFiles
    .filter(f => f.importanceScore > 50 || f.isHotspot)
    .map(f => f.path);

  const orphanFiles = parsedFiles
    .filter(f => f.dependents?.length === 0 && (f.dependencies?.length === 0 || f.dependencies?.length === 0))
    .map(f => f.path);

  return {
    projectId,
    timestamp: new Date().toISOString(),
    fileCount,
    languages,
    dependencyGraph,
    architectureMap,
    hotspots,
    technicalDebt,
    technicalDebtScore,
    criticalFiles,
    orphanFiles,
    architectureDrift,
    recommendations,
  };
}

async function fetchCommitHistory(
  githubCtx: GitHubContext,
  files: RepositoryFile[]
): Promise<Array<{ sha: string; date: string; author: string; files: string[] }>> {
  const history = await getCommitHistory(githubCtx, undefined, 100);

  // Fetch files for each commit
  const enrichedHistory = [];
  for (const commit of history.slice(0, 50)) { // Limit to 50 commits for performance
    try {
      const commitFiles = await getCommitFiles(githubCtx, commit.sha);
      enrichedHistory.push({
        ...commit,
        files: commitFiles,
      });
    } catch {
      enrichedHistory.push(commit);
    }
  }

  return enrichedHistory;
}

async function saveIntelligenceData(
  ctx: DBContext,
  projectId: number,
  files: RepositoryFile[],
  graph: DependencyGraph,
  symbols: Symbol[]
): Promise<void> {
  // Save files
  for (const file of files) {
    try {
      await createRepoFile(ctx, file);
    } catch {
      // File might already exist, try update
    }
  }

  // TODO: Save dependency edges and symbols to database
  // This would require additional DB operations
}

function generateRecommendations(
  graph: DependencyGraph,
  arch: ArchitectureMap,
  hotspots: Hotspot[],
  debts: TechnicalDebtItem[],
  files: RepositoryFile[]
): string[] {
  const recommendations: string[] = [];

  // Architecture recommendations
  if (arch.detectedPattern === 'monolith' && files.length > 50) {
    recommendations.push('Consider modularizing the monolith architecture as the codebase has grown beyond 50 files.');
  }

  // Cycle recommendations
  if (graph.cycles.length > 0) {
    recommendations.push(`Found ${graph.cycles.length} circular dependencies. Consider refactoring to break these cycles.`);
  }

  // Hotspot recommendations
  if (hotspots.length > 0) {
    const topHotspot = hotspots[0];
    recommendations.push(`Priority refactoring: ${topHotspot.filePath} has risk score ${topHotspot.riskScore}. ${topHotspot.changeFrequency} changes by ${topHotspot.contributors.length} contributors.`);
  }

  // Technical debt recommendations
  const criticalDebts = debts.filter(d => d.severity === 'critical');
  if (criticalDebts.length > 0) {
    recommendations.push(`Address ${criticalDebts.length} critical technical debt items, starting with security issues.`);
  }

  // Orphan files
  const orphanCount = files.filter(f => f.dependents?.length === 0 && f.importanceScore < 10).length;
  if (orphanCount > 5) {
    recommendations.push(`${orphanCount} files appear unused. Consider removing dead code.`);
  }

  // Test coverage
  const filesWithTests = files.filter(f => {
    const testPaths = [
      f.path.replace(/\.(ts|js|tsx|jsx)$/, '.test.$1'),
      f.path.replace(/\.(ts|js|tsx|jsx)$/, '.spec.$1'),
    ];
    return testPaths.some(tp => files.some(af => af.path === tp));
  });
  const testCoverage = files.length > 0 ? (filesWithTests.length / files.length) * 100 : 0;
  if (testCoverage < 30) {
    recommendations.push(`Test coverage is ${testCoverage.toFixed(1)}%. Consider adding tests for critical modules.`);
  }

  return recommendations;
}

export { parseGeneric, detectLanguage, buildDependencyGraph, detectArchitecture, 
         detectHotspots, detectTechnicalDebt, analyzeChangeImpact };
