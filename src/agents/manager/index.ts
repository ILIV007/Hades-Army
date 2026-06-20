/**
 * Hades Army v0.6.1 — Manager Agent (Technical Lead)
 * Performs deep analysis before ANY task creation
 * Can reject, delay, escalate, merge, split, reprioritize tasks
 */

import type { Task, Project, RepositoryFile, DependencyGraph, ArchitectureMap, Failure, ADR, ChangeImpact, KnowledgeGraph } from '../core/types';
import type { DBContext } from '../db';
import { getProject, createTask, updateTask, listTasks, getFailures, getADRs, getRepoFiles } from '../db';
import { callLLM, buildManagerSystemPrompt } from '../llm';
import { analyzeRepository, analyzeChangeImpact } from '../intelligence';
import { getFailureWarnings, getRiskAssessment, analyzeFailures } from '../memory/failure-learning';
import { queryKnowledgeGraph, findRelatedNodes } from '../memory/knowledge-graph';
import { getArchitectureDecisions } from '../memory/architecture';
import { CONFIG } from '../core/config';

// ============================================================================
// TASK ANALYSIS RESULT
// ============================================================================

export interface TaskAnalysis {
  canProceed: boolean;
  action: 'proceed' | 'reject' | 'delay' | 'escalate' | 'split' | 'merge';
  reason: string;
  affectedFiles: string[];
  affectedModules: string[];
  architectureRisk: 'low' | 'medium' | 'high' | 'critical';
  dependencyRisk: 'low' | 'medium' | 'high' | 'critical';
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
  suggestedTasks?: Array<{
    title: string;
    description: string;
    files: string[];
    priority: Task['priority'];
    riskLevel: Task['riskLevel'];
  }>;
  failureWarnings: string[];
  adrConflicts: string[];
  knowledgeGraphImpact: string[];
}

// ============================================================================
// MAIN: ANALYZE BEFORE PLANNING
// ============================================================================

export async function analyzeBeforePlanning(
  ctx: DBContext,
  projectId: number,
  taskRequest: string,
  env: Record<string, string>
): Promise<TaskAnalysis> {
  const project = await getProject(ctx, projectId);

  // 1. Repository Intelligence Analysis
  const repoFiles = await getRepoFiles(ctx, projectId);
  const fileMap = new Map(repoFiles.map(f => [f.path, f]));

  // 2. Knowledge Graph Analysis
  const kg = await queryKnowledgeGraph(ctx, projectId, {});
  const kgImpact = analyzeKnowledgeGraphImpact(kg.nodes, kg.edges, taskRequest);

  // 3. ADR Analysis
  const adrs = await getADRs(ctx, projectId);
  const adrConflicts = detectADRConflicts(taskRequest, adrs);

  // 4. Failure Learning Analysis
  const failureAnalysis = await analyzeFailures(ctx, projectId);
  const failureWarnings = await getFailureWarnings(ctx, projectId, {
    id: 0, projectId, title: taskRequest, status: 'pending',
    priority: 'medium', riskLevel: 'medium', createdAt: '', updatedAt: ''
  });

  // 5. Dependency Analysis
  const dependencyAnalysis = analyzeDependencies(repoFiles, taskRequest);

  // 6. Risk Analysis
  const riskAnalysis = calculateRisk(repoFiles, failureAnalysis, adrConflicts, kgImpact);

  // 7. Impact Analysis on specific files
  const impactedFiles = identifyImpactedFiles(repoFiles, taskRequest);
  const impactedModules = [...new Set(impactedFiles.map(f => extractModule(f)))];

  // Determine action
  const action = determineAction(riskAnalysis, failureAnalysis, adrConflicts);

  const analysis: TaskAnalysis = {
    canProceed: action === 'proceed',
    action,
    reason: generateReason(action, riskAnalysis, failureAnalysis, adrConflicts),
    affectedFiles: impactedFiles,
    affectedModules: impactedModules,
    architectureRisk: riskAnalysis.architecture,
    dependencyRisk: riskAnalysis.dependency,
    overallRisk: riskAnalysis.overall,
    recommendations: generateRecommendations(riskAnalysis, failureAnalysis, impactedFiles),
    failureWarnings,
    adrConflicts,
    knowledgeGraphImpact: kgImpact,
  };

  // If split recommended, generate sub-tasks
  if (action === 'split') {
    analysis.suggestedTasks = await generateSplitTasks(ctx, taskRequest, impactedFiles, repoFiles, env);
  }

  return analysis;
}

// ============================================================================
// TASK PLANNING (only called if analysis says proceed)
// ============================================================================

export async function planTask(
  ctx: DBContext,
  projectId: number,
  taskRequest: string,
  env: Record<string, string>
): Promise<TaskAnalysis> {
  // ALWAYS analyze first
  const analysis = await analyzeBeforePlanning(ctx, projectId, taskRequest, env);

  if (!analysis.canProceed) {
    return analysis; // Return with rejection reason
  }

  // If we get here, proceed with planning
  const project = await getProject(ctx, projectId);

  const repoInfo = formatRepositoryContext(analysis);
  const failureInfo = analysis.failureWarnings.join('\n');
  const adrInfo = analysis.adrConflicts.length > 0
    ? `ADR Conflicts:\n${analysis.adrConflicts.join('\n')}`
    : 'No ADR conflicts';

  const prompt = buildManagerSystemPrompt({
    projectName: project.name,
    repositoryInfo: repoInfo,
    architectureMap: `Risk: ${analysis.architectureRisk}`,
    failures: analysis.failureWarnings,
    adrs: analysis.adrConflicts,
  });

  const response = await callLLM({
    model: CONFIG.LLM_PROVIDERS.openrouter.defaultModel,
    messages: [
      { role: 'system', content: prompt, timestamp: new Date().toISOString() },
      { role: 'user', content: `PLANNING REQUEST: ${taskRequest}\n\nANALYSIS:\n${formatAnalysisForLLM(analysis)}`, timestamp: new Date().toISOString() }
    ],
  }, env as any);

  // Parse LLM response for task details
  const plan = parseTaskPlan(response.content, projectId);

  // Merge analysis into plan
  return {
    ...analysis,
    ...plan,
  };
}

// ============================================================================
// TASK OPERATIONS: Reject, Delay, Escalate, Merge, Split, Reprioritize
// ============================================================================

export async function rejectTask(
  ctx: DBContext,
  taskId: number,
  reason: string
): Promise<void> {
  await updateTask(ctx, taskId, {
    status: 'failed',
    reviewComments: `REJECTED by Manager: ${reason}`,
  });
}

export async function delayTask(
  ctx: DBContext,
  taskId: number,
  reason: string,
  dependencies: string[]
): Promise<void> {
  await updateTask(ctx, taskId, {
    status: 'pending',
    reviewComments: `DELAYED by Manager: ${reason}\nDependencies: ${dependencies.join(', ')}`,
  });
}

export async function escalateTask(
  ctx: DBContext,
  taskId: number,
  reason: string
): Promise<void> {
  const task = await ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
  if (task) {
    await updateTask(ctx, taskId, {
      priority: 'critical',
      riskLevel: 'critical',
      reviewComments: `ESCALATED by Manager: ${reason}`,
    });
  }
}

export async function mergeTasks(
  ctx: DBContext,
  taskIds: number[],
  newTitle: string
): Promise<Task> {
  const tasks = await Promise.all(taskIds.map(id =>
    ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first()
  ));

  const allFiles = tasks.flatMap(t => t?.files ? JSON.parse(t.files as string) : []);
  const uniqueFiles = [...new Set(allFiles)];

  const mergedTask = await createTask(ctx, {
    projectId: tasks[0]?.project_id as number,
    title: newTitle,
    description: `Merged tasks: ${taskIds.join(', ')}`,
    status: 'pending',
    priority: 'high',
    riskLevel: 'high',
    files: uniqueFiles,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Mark original tasks as merged
  for (const id of taskIds) {
    await updateTask(ctx, id, {
      status: 'merged',
      reviewComments: `Merged into task #${mergedTask.id}`,
    });
  }

  return mergedTask;
}

export async function splitTask(
  ctx: DBContext,
  taskId: number,
  subTasks: Array<{ title: string; files: string[] }>
): Promise<Task[]> {
  const originalTask = await ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
  if (!originalTask) throw new Error('Task not found');

  const projectId = originalTask.project_id as number;
  const newTasks: Task[] = [];

  for (const sub of subTasks) {
    const task = await createTask(ctx, {
      projectId,
      title: sub.title,
      description: `Split from task #${taskId}`,
      status: 'pending',
      priority: 'medium',
      riskLevel: 'medium',
      files: sub.files,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    newTasks.push(task);
  }

  await updateTask(ctx, taskId, {
    status: 'merged',
    reviewComments: `Split into tasks: ${newTasks.map(t => t.id).join(', ')}`,
  });

  return newTasks;
}

export async function reprioritizeTask(
  ctx: DBContext,
  taskId: number,
  newPriority: Task['priority'],
  reason: string
): Promise<void> {
  await updateTask(ctx, taskId, {
    priority: newPriority,
    reviewComments: `REPRIORITIZED to ${newPriority}: ${reason}`,
  });
}

// ============================================================================
// INTELLIGENCE INTEGRATION HELPERS
// ============================================================================

function analyzeKnowledgeGraphImpact(
  nodes: Array<{ nodeType: string; name: string }>,
  edges: Array<{ relationType: string; sourceId: number; targetId: number }>,
  taskRequest: string
): string[] {
  const impacts: string[] = [];
  const requestLower = taskRequest.toLowerCase();

  // Find nodes related to task
  const relatedNodes = nodes.filter(n =>
    requestLower.includes(n.name.toLowerCase()) ||
    n.name.toLowerCase().includes(requestLower.split(' ')[0])
  );

  for (const node of relatedNodes) {
    const connectedEdges = edges.filter(e =>
      e.sourceId === (node as any).id || e.targetId === (node as any).id
    );
    if (connectedEdges.length > 0) {
      impacts.push(`${node.name} affects ${connectedEdges.length} connected components`);
    }
  }

  return impacts.length > 0 ? impacts : ['No direct knowledge graph impact detected'];
}

function detectADRConflicts(taskRequest: string, adrs: ADR[]): string[] {
  const conflicts: string[] = [];
  const requestLower = taskRequest.toLowerCase();

  for (const adr of adrs) {
    const adrText = `${adr.title} ${adr.decision}`.toLowerCase();
    // Check for potential conflicts
    if (requestLower.includes('database') && adrText.includes('database') && adr.status === 'accepted') {
      conflicts.push(`ADR ${adr.adrNumber}: ${adr.title} — verify compliance`);
    }
    if (requestLower.includes('auth') && adrText.includes('auth') && adr.status === 'accepted') {
      conflicts.push(`ADR ${adr.adrNumber}: ${adr.title} — verify compliance`);
    }
  }

  return conflicts;
}

function analyzeDependencies(files: RepositoryFile[], taskRequest: string): {
  circularDeps: string[];
  externalDeps: string[];
  orphanedFiles: string[];
} {
  const circularDeps: string[] = [];
  const externalDeps: string[] = [];
  const orphanedFiles: string[] = [];

  for (const file of files) {
    if (file.dependencies && file.dependencies.length > 0) {
      externalDeps.push(...file.dependencies);
    }
    if (!file.dependents || file.dependents.length === 0) {
      orphanedFiles.push(file.path);
    }
  }

  return {
    circularDeps: [...new Set(circularDeps)],
    externalDeps: [...new Set(externalDeps)],
    orphanedFiles: orphanedFiles.slice(0, 5),
  };
}

interface RiskAnalysis {
  architecture: 'low' | 'medium' | 'high' | 'critical';
  dependency: 'low' | 'medium' | 'high' | 'critical';
  overall: 'low' | 'medium' | 'high' | 'critical';
  score: number;
}

function calculateRisk(
  files: RepositoryFile[],
  failureAnalysis: { totalFailures: number; criticalFiles: string[] },
  adrConflicts: string[],
  kgImpact: string[]
): RiskAnalysis {
  let score = 0;

  // File complexity risk
  const avgComplexity = files.length > 0
    ? files.reduce((sum, f) => sum + f.complexity, 0) / files.length
    : 0;
  score += Math.min(avgComplexity * 2, 30);

  // Hotspot risk
  const hotspotCount = files.filter(f => f.isHotspot).length;
  score += hotspotCount * 10;

  // Failure history risk
  score += failureAnalysis.totalFailures * 5;

  // ADR conflict risk
  score += adrConflicts.length * 15;

  // Knowledge graph impact risk
  score += kgImpact.filter(i => !i.includes('No direct')).length * 5;

  const overall: RiskAnalysis['overall'] =
    score >= 70 ? 'critical' :
    score >= 50 ? 'high' :
    score >= 30 ? 'medium' : 'low';

  return {
    architecture: score >= 60 ? 'high' : score >= 40 ? 'medium' : 'low',
    dependency: hotspotCount > 2 ? 'high' : hotspotCount > 0 ? 'medium' : 'low',
    overall,
    score: Math.min(score, 100),
  };
}

function determineAction(
  risk: RiskAnalysis,
  failureAnalysis: { totalFailures: number },
  adrConflicts: string[]
): TaskAnalysis['action'] {
  if (risk.overall === 'critical') return 'reject';
  if (risk.overall === 'high' && failureAnalysis.totalFailures >= 3) return 'escalate';
  if (risk.overall === 'high') return 'split';
  if (adrConflicts.length > 0) return 'delay';
  if (risk.score > 40) return 'split';
  return 'proceed';
}

function generateReason(
  action: TaskAnalysis['action'],
  risk: RiskAnalysis,
  failureAnalysis: { totalFailures: number; recurringIssues: string[] },
  adrConflicts: string[]
): string {
  switch (action) {
    case 'reject':
      return `CRITICAL RISK (${risk.score}/100): ${risk.overall} risk level. ${failureAnalysis.totalFailures} previous failures. ${adrConflicts.length} ADR conflicts.`;
    case 'delay':
      return `DELAYED: ${adrConflicts.length} ADR conflicts must be resolved. ${failureAnalysis.recurringIssues.slice(0, 3).join('; ')}`;
    case 'escalate':
      return `ESCALATED: High risk with ${failureAnalysis.totalFailures} historical failures. Requires senior review.`;
    case 'split':
      return `SPLIT RECOMMENDED: Risk score ${risk.score}/100. Too many affected files/modules. Break into smaller tasks.`;
    case 'merge':
      return `MERGE: Multiple related tasks detected. Combine for efficiency.`;
    default:
      return `PROCEED: Risk ${risk.overall} (${risk.score}/100). All checks passed.`;
  }
}

function generateRecommendations(
  risk: RiskAnalysis,
  failureAnalysis: { totalFailures: number; patterns: Array<{ pattern: string; frequency: number }> },
  impactedFiles: string[]
): string[] {
  const recs: string[] = [];

  if (risk.overall === 'high' || risk.overall === 'critical') {
    recs.push(`Consider splitting into smaller tasks (>${impactedFiles.length} files affected)`);
  }

  if (failureAnalysis.totalFailures > 0) {
    recs.push(`Review ${failureAnalysis.totalFailures} past failures before proceeding`);
  }

  for (const pattern of failureAnalysis.patterns.slice(0, 3)) {
    recs.push(`WARNING: "${pattern.pattern}" failed ${pattern.frequency} times before`);
  }

  if (impactedFiles.length > 10) {
    recs.push(`Large blast radius: ${impactedFiles.length} files. Consider phased approach.`);
  }

  return recs;
}

function identifyImpactedFiles(files: RepositoryFile[], taskRequest: string): string[] {
  const requestLower = taskRequest.toLowerCase();
  const keywords = requestLower.split(/\s+/).filter(w => w.length > 3);

  return files
    .filter(f => {
      const pathLower = f.path.toLowerCase();
      return keywords.some(kw => pathLower.includes(kw)) ||
             f.importanceScore > 50 ||
             f.isHotspot;
    })
    .map(f => f.path)
    .slice(0, 50);
}

function extractModule(filePath: string): string {
  const parts = filePath.split('/');
  const moduleIndicators = ['src', 'lib', 'app', 'packages', 'modules', 'components', 'services', 'features'];
  for (let i = 0; i < parts.length - 1; i++) {
    if (moduleIndicators.includes(parts[i]) && i + 1 < parts.length) {
      return parts[i + 1];
    }
  }
  return parts[0] || 'root';
}

async function generateSplitTasks(
  ctx: DBContext,
  taskRequest: string,
  files: string[],
  repoFiles: RepositoryFile[],
  env: Record<string, string>
): Promise<TaskAnalysis['suggestedTasks']> {
  // Group files by module for splitting
  const moduleGroups = new Map<string, string[]>();
  for (const file of files) {
    const mod = extractModule(file);
    if (!moduleGroups.has(mod)) moduleGroups.set(mod, []);
    moduleGroups.get(mod)!.push(file);
  }

  const suggestions: TaskAnalysis['suggestedTasks'] = [];
  let index = 1;

  for (const [mod, modFiles] of moduleGroups) {
    if (modFiles.length === 0) continue;
    suggestions.push({
      title: `${taskRequest} — Part ${index}: ${mod}`,
      description: `Focus on ${mod} module (${modFiles.length} files)`,
      files: modFiles,
      priority: 'medium',
      riskLevel: modFiles.length > 5 ? 'high' : 'medium',
    });
    index++;
  }

  return suggestions;
}

// ============================================================================
// FORMATTING HELPERS
// ============================================================================

function formatRepositoryContext(analysis: TaskAnalysis): string {
  return `Affected Files: ${analysis.affectedFiles.length}
Affected Modules: ${analysis.affectedModules.join(', ')}
Architecture Risk: ${analysis.architectureRisk}
Dependency Risk: ${analysis.dependencyRisk}
Overall Risk: ${analysis.overallRisk}`;
}

function formatAnalysisForLLM(analysis: TaskAnalysis): string {
  return `ACTION: ${analysis.action}
CAN PROCEED: ${analysis.canProceed}
REASON: ${analysis.reason}
AFFECTED FILES: ${analysis.affectedFiles.length}
AFFECTED MODULES: ${analysis.affectedModules.join(', ')}
ARCHITECTURE RISK: ${analysis.architectureRisk}
DEPENDENCY RISK: ${analysis.dependencyRisk}
OVERALL RISK: ${analysis.overallRisk}
FAILURE WARNINGS: ${analysis.failureWarnings.join('; ')}
ADR CONFLICTS: ${analysis.adrConflicts.join('; ')}
RECOMMENDATIONS: ${analysis.recommendations.join('; ')}`;
}

function parseTaskPlan(content: string, projectId: number): Partial<TaskAnalysis> {
  const titleMatch = content.match(/##?\s*Title:\s*(.+)/i);
  const priorityMatch = content.match(/##?\s*Priority:\s*(low|medium|high|critical)/i);
  const riskMatch = content.match(/##?\s*Risk:\s*(low|medium|high|critical)/i);

  const files: string[] = [];
  const filesMatch = content.match(/##?\s*Files:[\s\S]*?((?:- .+\n)+)/i);
  if (filesMatch) {
    const lines = filesMatch[1].split('\n');
    for (const line of lines) {
      const m = line.match(/- (.+)/);
      if (m) files.push(m[1].trim());
    }
  }

  return {
    affectedFiles: files,
    overallRisk: (riskMatch?.[1]?.trim() || 'medium') as TaskAnalysis['overallRisk'],
    recommendations: [],
    failureWarnings: [],
    adrConflicts: [],
    knowledgeGraphImpact: [],
  };
}
