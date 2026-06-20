/**
 * Hades Army v0.6 - Repository Intelligence Engine
 * Dependency Graph Builder
 */

import type { DependencyGraph, DependencyEdge, RepositoryFile, Cycle, ExternalDependency } from '../../core/types';
import type { DBContext } from '../../db';

interface GraphNode {
  fileId: number;
  path: string;
  imports: string[];
  exports: string[];
  dependencies: string[];
}

export async function buildDependencyGraph(
  ctx: DBContext,
  projectId: number,
  files: RepositoryFile[]
): Promise<DependencyGraph> {
  const nodes: GraphNode[] = files.map(f => ({
    fileId: f.id,
    path: f.path,
    imports: f.imports || [],
    exports: f.exports || [],
    dependencies: f.dependencies || [],
  }));

  const edges: DependencyEdge[] = [];
  const pathToId = new Map<string, number>();
  files.forEach(f => pathToId.set(f.path, f.id));

  // Build edges from imports
  for (const node of nodes) {
    for (const imp of node.imports) {
      // Resolve import path to file path
      const resolvedPath = resolveImportPath(imp, node.path, files);
      if (resolvedPath && pathToId.has(resolvedPath)) {
        const targetId = pathToId.get(resolvedPath)!;
        edges.push({
          id: 0,
          projectId,
          sourceFileId: node.fileId,
          targetFileId: targetId,
          dependencyType: 'import',
          isCircular: false,
          isExternal: false,
        });
      } else if (!imp.startsWith('.')) {
        // External dependency
        edges.push({
          id: 0,
          projectId,
          sourceFileId: node.fileId,
          targetFileId: -1,
          dependencyType: 'import',
          isCircular: false,
          isExternal: true,
        });
      }
    }
  }

  // Detect cycles
  const cycles = detectCycles(nodes, edges, pathToId);

  // Mark circular dependencies
  for (const cycle of cycles) {
    for (let i = 0; i < cycle.files.length; i++) {
      const sourcePath = cycle.files[i];
      const targetPath = cycle.files[(i + 1) % cycle.files.length];
      const sourceId = pathToId.get(sourcePath);
      const targetId = pathToId.get(targetPath);
      if (sourceId && targetId) {
        const edge = edges.find(e => e.sourceFileId === sourceId && e.targetFileId === targetId);
        if (edge) edge.isCircular = true;
      }
    }
  }

  // Collect external dependencies
  const externalDeps = collectExternalDependencies(edges, nodes);

  return {
    nodes: files,
    edges,
    cycles,
    externalDependencies: externalDeps,
  };
}

function resolveImportPath(importPath: string, sourcePath: string, files: RepositoryFile[]): string | null {
  const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));

  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    // Relative import
    const resolved = resolveRelativePath(sourceDir, importPath);

    // Try exact match
    const exact = files.find(f => f.path === resolved || f.path === resolved + '.ts' || f.path === resolved + '.js' || f.path === resolved + '.tsx' || f.path === resolved + '.jsx');
    if (exact) return exact.path;

    // Try index file
    const index = files.find(f => f.path === resolved + '/index.ts' || f.path === resolved + '/index.js');
    if (index) return index.path;
  }

  if (importPath.startsWith('@/')) {
    // Alias import (e.g., @/components/Button)
    const aliasPath = importPath.replace('@/', '');
    const matched = files.find(f => f.path.includes(aliasPath));
    if (matched) return matched.path;
  }

  return null;
}

function resolveRelativePath(sourceDir: string, importPath: string): string {
  const parts = importPath.split('/');
  const result: string[] = sourceDir.split('/').filter(p => p);

  for (const part of parts) {
    if (part === '..') {
      result.pop();
    } else if (part !== '.' && part !== '') {
      result.push(part);
    }
  }

  return result.join('/');
}

function detectCycles(nodes: GraphNode[], edges: DependencyEdge[], pathToId: Map<string, number>): Cycle[] {
  const cycles: Cycle[] = [];
  const visited = new Set<number>();
  const recStack = new Set<number>();
  const adjacency = new Map<number, number[]>();

  // Build adjacency list (internal deps only)
  for (const edge of edges) {
    if (!edge.isExternal) {
      if (!adjacency.has(edge.sourceFileId)) adjacency.set(edge.sourceFileId, []);
      adjacency.get(edge.sourceFileId)!.push(edge.targetFileId);
    }
  }

  function dfs(nodeId: number, path: number[]): void {
    visited.add(nodeId);
    recStack.add(nodeId);
    path.push(nodeId);

    const neighbors = adjacency.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path]);
      } else if (recStack.has(neighbor)) {
        // Cycle detected
        const cycleStart = path.indexOf(neighbor);
        const cycleFiles = path.slice(cycleStart).map(id => {
          const node = nodes.find(n => n.fileId === id);
          return node?.path || String(id);
        });

        cycles.push({
          files: cycleFiles,
          severity: cycleFiles.length <= 2 ? 'critical' : 'warning',
        });
      }
    }

    recStack.delete(nodeId);
  }

  for (const node of nodes) {
    if (!visited.has(node.fileId)) {
      dfs(node.fileId, []);
    }
  }

  // Remove duplicate cycles
  const uniqueCycles: Cycle[] = [];
  const seen = new Set<string>();
  for (const cycle of cycles) {
    const key = [...cycle.files].sort().join(',');
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCycles.push(cycle);
    }
  }

  return uniqueCycles;
}

function collectExternalDependencies(edges: DependencyEdge[], nodes: GraphNode[]): ExternalDependency[] {
  const externalMap = new Map<string, { count: number; sources: Set<string> }>();

  for (const edge of edges) {
    if (edge.isExternal) {
      const sourceNode = nodes.find(n => n.fileId === edge.sourceFileId);
      if (sourceNode) {
        for (const dep of sourceNode.dependencies) {
          if (!externalMap.has(dep)) {
            externalMap.set(dep, { count: 0, sources: new Set() });
          }
          const entry = externalMap.get(dep)!;
          entry.count++;
          entry.sources.add(sourceNode.path);
        }
      }
    }
  }

  return Array.from(externalMap.entries()).map(([name, data]) => ({
    name,
    type: detectPackageManager(name),
    usage: Array.from(data.sources),
  }));
}

function detectPackageManager(name: string): ExternalDependency['type'] {
  if (name.startsWith('@')) return 'npm';
  // Simple heuristics
  const npmPackages = ['react', 'vue', 'angular', 'express', 'lodash', 'axios', 'next', 'nuxt'];
  if (npmPackages.includes(name)) return 'npm';
  return 'other';
}

export function calculateFileImportance(file: RepositoryFile, allFiles: RepositoryFile[]): number {
  let score = 0;

  // More dependents = more important
  const dependentCount = file.dependents?.length || 0;
  score += dependentCount * 10;

  // Higher complexity = more important (but also riskier)
  score += Math.min(file.complexity, 50);

  // Entry points are important
  if (file.path.includes('index.') || file.path.includes('main.')) {
    score += 50;
  }

  // Config files are important
  if (file.path.includes('config') || file.path.includes('setup')) {
    score += 30;
  }

  // Core/domain files are important
  if (file.path.includes('/core/') || file.path.includes('/domain/')) {
    score += 20;
  }

  return Math.min(score, 100);
}

export function getCriticalFiles(graph: DependencyGraph): RepositoryFile[] {
  return graph.nodes
    .filter(n => n.importanceScore > 50 || n.isHotspot)
    .sort((a, b) => b.importanceScore - a.importanceScore);
}

export function getOrphanFiles(graph: DependencyGraph): RepositoryFile[] {
  const hasDeps = new Set<number>();
  for (const edge of graph.edges) {
    hasDeps.add(edge.sourceFileId);
    hasDeps.add(edge.targetFileId);
  }
  return graph.nodes.filter(n => !hasDeps.has(n.id) && n.dependents?.length === 0);
}
