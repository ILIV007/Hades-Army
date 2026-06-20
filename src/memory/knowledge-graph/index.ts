/**
 * Hades Army v0.6 - Knowledge Graph System
 * Manages relationships between features, modules, services, files, tasks, and dependencies
 */

import type { KnowledgeNode, KnowledgeEdge, NodeType, RelationType, Task, RepositoryFile } from '../core/types';
import type { DBContext } from '../db';
import { createKnowledgeNode, createKnowledgeEdge, getKnowledgeGraph } from '../db';

export interface GraphQuery {
  nodeType?: NodeType;
  relationType?: RelationType;
  fromNode?: number;
  toNode?: number;
  minWeight?: number;
}

export async function buildKnowledgeGraph(
  ctx: DBContext,
  projectId: number,
  files: RepositoryFile[],
  tasks: Task[]
): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
  const nodes: Omit<KnowledgeNode, 'id'>[] = [];
  const edges: Omit<KnowledgeEdge, 'id'>[] = [];
  const nodeMap = new Map<string, number>(); // name -> temp index

  // Add file nodes
  for (const file of files) {
    const node = {
      projectId,
      nodeType: 'file' as NodeType,
      name: file.name,
      description: `${file.language || 'Unknown'} file with ${file.lines} lines`,
      metadata: { path: file.path, complexity: file.complexity, importance: file.importanceScore },
      importanceScore: file.importanceScore,
    };
    nodes.push(node);
    nodeMap.set(`file:${file.path}`, nodes.length - 1);
  }

  // Add module nodes
  const modules = groupFilesByModule(files);
  for (const [moduleName, moduleFiles] of modules) {
    const node = {
      projectId,
      nodeType: 'module' as NodeType,
      name: moduleName,
      description: `Module containing ${moduleFiles.length} files`,
      metadata: { fileCount: moduleFiles.length, paths: moduleFiles.map(f => f.path) },
      importanceScore: moduleFiles.reduce((sum, f) => sum + f.importanceScore, 0) / moduleFiles.length,
    };
    nodes.push(node);
    const moduleIndex = nodes.length - 1;
    nodeMap.set(`module:${moduleName}`, moduleIndex);

    // Connect module to its files
    for (const file of moduleFiles) {
      const fileIndex = nodeMap.get(`file:${file.path}`);
      if (fileIndex !== undefined) {
        edges.push({
          projectId,
          sourceId: moduleIndex,
          targetId: fileIndex,
          relationType: 'contains',
          weight: 1.0,
          metadata: {},
        });
      }
    }
  }

  // Add task nodes
  for (const task of tasks) {
    const node = {
      projectId,
      nodeType: 'task' as NodeType,
      name: task.title,
      description: task.description || `Task: ${task.title}`,
      metadata: { status: task.status, priority: task.priority, risk: task.riskLevel },
      importanceScore: task.priority === 'critical' ? 100 : task.priority === 'high' ? 75 : task.priority === 'medium' ? 50 : 25,
    };
    nodes.push(node);
    const taskIndex = nodes.length - 1;
    nodeMap.set(`task:${task.id}`, taskIndex);

    // Connect task to affected files
    if (task.files) {
      for (const filePath of task.files) {
        const fileIndex = nodeMap.get(`file:${filePath}`);
        if (fileIndex !== undefined) {
          edges.push({
            projectId,
            sourceId: taskIndex,
            targetId: fileIndex,
            relationType: 'triggers',
            weight: 1.0,
            metadata: { taskStatus: task.status },
          });
        }
      }
    }
  }

  // Add dependency relationships between files
  for (const file of files) {
    if (file.imports) {
      for (const imp of file.imports) {
        const sourceIndex = nodeMap.get(`file:${file.path}`);
        // Try to resolve import to a file
        const resolvedPath = resolveImportToFile(imp, files);
        if (resolvedPath) {
          const targetIndex = nodeMap.get(`file:${resolvedPath}`);
          if (sourceIndex !== undefined && targetIndex !== undefined && sourceIndex !== targetIndex) {
            edges.push({
              projectId,
              sourceId: sourceIndex,
              targetId: targetIndex,
              relationType: 'imports',
              weight: 1.0,
              metadata: { importPath: imp },
            });
          }
        }
      }
    }
  }

  // Add feature nodes based on file paths and naming
  const features = detectFeatures(files);
  for (const [featureName, featureFiles] of features) {
    const node = {
      projectId,
      nodeType: 'feature' as NodeType,
      name: featureName,
      description: `Feature: ${featureName}`,
      metadata: { fileCount: featureFiles.length },
      importanceScore: featureFiles.reduce((sum, f) => sum + f.importanceScore, 0) / featureFiles.length,
    };
    nodes.push(node);
    const featureIndex = nodes.length - 1;
    nodeMap.set(`feature:${featureName}`, featureIndex);

    // Connect feature to its files
    for (const file of featureFiles) {
      const fileIndex = nodeMap.get(`file:${file.path}`);
      if (fileIndex !== undefined) {
        edges.push({
          projectId,
          sourceId: featureIndex,
          targetId: fileIndex,
          relationType: 'contains',
          weight: 0.8,
          metadata: {},
        });
      }
    }
  }

  // Save to database
  const savedNodes: KnowledgeNode[] = [];
  for (const node of nodes) {
    const saved = await createKnowledgeNode(ctx, node);
    savedNodes.push(saved);
  }

  const savedEdges: KnowledgeEdge[] = [];
  for (const edge of edges) {
    // Remap temp indices to actual IDs
    const sourceNode = savedNodes[edge.sourceId];
    const targetNode = savedNodes[edge.targetId];
    if (sourceNode && targetNode) {
      const saved = await createKnowledgeEdge(ctx, {
        ...edge,
        sourceId: sourceNode.id,
        targetId: targetNode.id,
      });
      savedEdges.push(saved);
    }
  }

  return { nodes: savedNodes, edges: savedEdges };
}

export async function queryKnowledgeGraph(
  ctx: DBContext,
  projectId: number,
  query: GraphQuery
): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
  const { nodes, edges } = await getKnowledgeGraph(ctx, projectId);

  let filteredNodes = nodes;
  let filteredEdges = edges;

  if (query.nodeType) {
    filteredNodes = filteredNodes.filter(n => n.nodeType === query.nodeType);
  }

  if (query.relationType) {
    filteredEdges = filteredEdges.filter(e => e.relationType === query.relationType);
  }

  if (query.fromNode) {
    filteredEdges = filteredEdges.filter(e => e.sourceId === query.fromNode);
  }

  if (query.toNode) {
    filteredEdges = filteredEdges.filter(e => e.targetId === query.toNode);
  }

  if (query.minWeight) {
    filteredEdges = filteredEdges.filter(e => e.weight >= query.minWeight);
  }

  // Get only nodes that are connected by filtered edges
  const connectedNodeIds = new Set<number>();
  filteredEdges.forEach(e => {
    connectedNodeIds.add(e.sourceId);
    connectedNodeIds.add(e.targetId);
  });

  filteredNodes = filteredNodes.filter(n => connectedNodeIds.has(n.id));

  return { nodes: filteredNodes, edges: filteredEdges };
}

export async function findRelatedNodes(
  ctx: DBContext,
  projectId: number,
  nodeId: number,
  depth: number = 1
): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
  const { nodes, edges } = await getKnowledgeGraph(ctx, projectId);
  const relatedNodes = new Set<number>([nodeId]);
  const relatedEdges: KnowledgeEdge[] = [];

  for (let d = 0; d < depth; d++) {
    const currentIds = Array.from(relatedNodes);
    for (const edge of edges) {
      if (currentIds.includes(edge.sourceId) || currentIds.includes(edge.targetId)) {
        relatedEdges.push(edge);
        relatedNodes.add(edge.sourceId);
        relatedNodes.add(edge.targetId);
      }
    }
  }

  return {
    nodes: nodes.filter(n => relatedNodes.has(n.id)),
    edges: relatedEdges,
  };
}

export function findPathBetweenNodes(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  fromId: number,
  toId: number
): KnowledgeNode[] | null {
  // BFS to find shortest path
  const queue: Array<{ nodeId: number; path: number[] }> = [{ nodeId: fromId, path: [fromId] }];
  const visited = new Set<number>();

  const adjacency = new Map<number, number[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.sourceId)) adjacency.set(edge.sourceId, []);
    if (!adjacency.has(edge.targetId)) adjacency.set(edge.targetId, []);
    adjacency.get(edge.sourceId)!.push(edge.targetId);
    adjacency.get(edge.targetId)!.push(edge.sourceId); // Undirected for path finding
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.nodeId)) continue;
    visited.add(current.nodeId);

    if (current.nodeId === toId) {
      return current.path.map(id => nodes.find(n => n.id === id)).filter((n): n is KnowledgeNode => n !== undefined);
    }

    const neighbors = adjacency.get(current.nodeId) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push({ nodeId: neighbor, path: [...current.path, neighbor] });
      }
    }
  }

  return null;
}

export function getGraphMetrics(nodes: KnowledgeNode[], edges: KnowledgeEdge[]): {
  totalNodes: number;
  totalEdges: number;
  density: number;
  avgDegree: number;
  connectedComponents: number;
  centralNodes: KnowledgeNode[];
} {
  const totalNodes = nodes.length;
  const totalEdges = edges.length;
  const maxEdges = totalNodes * (totalNodes - 1) / 2;
  const density = maxEdges > 0 ? totalEdges / maxEdges : 0;

  // Calculate degree for each node
  const degrees = new Map<number, number>();
  for (const edge of edges) {
    degrees.set(edge.sourceId, (degrees.get(edge.sourceId) || 0) + 1);
    degrees.set(edge.targetId, (degrees.get(edge.targetId) || 0) + 1);
  }

  const avgDegree = totalNodes > 0 ? Array.from(degrees.values()).reduce((a, b) => a + b, 0) / totalNodes : 0;

  // Find connected components
  const visited = new Set<number>();
  let components = 0;
  const adjacency = new Map<number, number[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.sourceId)) adjacency.set(edge.sourceId, []);
    if (!adjacency.has(edge.targetId)) adjacency.set(edge.targetId, []);
    adjacency.get(edge.sourceId)!.push(edge.targetId);
    adjacency.get(edge.targetId)!.push(edge.sourceId);
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      components++;
      const stack = [node.id];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        const neighbors = adjacency.get(current) || [];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) stack.push(neighbor);
        }
      }
    }
  }

  // Find central nodes (highest degree)
  const centralNodes = nodes
    .map(n => ({ node: n, degree: degrees.get(n.id) || 0 }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 5)
    .map(x => x.node);

  return {
    totalNodes,
    totalEdges,
    density,
    avgDegree,
    connectedComponents: components,
    centralNodes,
  };
}

function groupFilesByModule(files: RepositoryFile[]): Map<string, RepositoryFile[]> {
  const modules = new Map<string, RepositoryFile[]>();

  for (const file of files) {
    const parts = file.path.split('/');
    let moduleName = 'root';

    // Find module boundary
    const moduleIndicators = ['src', 'lib', 'app', 'packages', 'modules', 'components', 'services', 'features'];
    for (let i = 0; i < parts.length - 1; i++) {
      if (moduleIndicators.includes(parts[i]) && i + 1 < parts.length) {
        moduleName = parts[i + 1];
        break;
      }
    }

    if (!modules.has(moduleName)) modules.set(moduleName, []);
    modules.get(moduleName)!.push(file);
  }

  return modules;
}

function detectFeatures(files: RepositoryFile[]): Map<string, RepositoryFile[]> {
  const features = new Map<string, RepositoryFile[]>();

  for (const file of files) {
    // Try to detect feature from path
    const featureMatch = file.path.match(/\/(features|pages|screens|views)\/([^/]+)/);
    if (featureMatch) {
      const featureName = featureMatch[2];
      if (!features.has(featureName)) features.set(featureName, []);
      features.get(featureName)!.push(file);
    }
  }

  return features;
}

function resolveImportToFile(importPath: string, files: RepositoryFile[]): string | null {
  // Simple resolution - try exact match with extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go'];

  for (const ext of extensions) {
    const exact = files.find(f => f.path === importPath + ext);
    if (exact) return exact.path;
  }

  // Try index file
  for (const ext of extensions) {
    const index = files.find(f => f.path === importPath + '/index' + ext);
    if (index) return index.path;
  }

  return null;
}
