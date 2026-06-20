/**
 * Hades Army v0.6 - Repository Intelligence Engine
 * Architecture Detection
 */

import type { ArchitectureMap, ArchitecturePattern, ArchitectureLayer, Module, RepositoryFile, DependencyEdge } from '../../core/types';

export function detectArchitecture(
  files: RepositoryFile[],
  edges: DependencyEdge[]
): ArchitectureMap {
  const detectedPattern = identifyPattern(files);
  const layers = identifyLayers(files, edges, detectedPattern);
  const modules = identifyModules(files, edges);
  const entryPoints = findEntryPoints(files);
  const criticalPaths = findCriticalPaths(files, edges);

  return {
    projectId: 0,
    detectedPattern,
    layers,
    modules,
    entryPoints,
    criticalPaths,
    hotspots: [], // Will be populated by hotspot detection
    technicalDebt: [], // Will be populated by debt detection
  };
}

function identifyPattern(files: RepositoryFile[]): ArchitecturePattern {
  const paths = files.map(f => f.path.toLowerCase());
  const names = files.map(f => f.name.toLowerCase());

  // MVC detection
  const hasModels = paths.some(p => p.includes('/models/') || p.includes('/model/'));
  const hasViews = paths.some(p => p.includes('/views/') || p.includes('/view/') || p.includes('/templates/'));
  const hasControllers = paths.some(p => p.includes('/controllers/') || p.includes('/controller/'));
  if (hasModels && hasViews && hasControllers) return 'mvc';

  // Microservices detection
  const hasServices = paths.filter(p => p.includes('/service/') || p.includes('/services/')).length;
  const hasDockerCompose = names.some(n => n.includes('docker-compose'));
  const hasK8s = paths.some(p => p.includes('/k8s/') || p.includes('/kubernetes/'));
  if (hasServices >= 3 || hasDockerCompose || hasK8s) return 'microservices';

  // Clean Architecture / Hexagonal
  const hasDomain = paths.some(p => p.includes('/domain/') || p.includes('/entities/'));
  const hasUseCases = paths.some(p => p.includes('/usecases/') || p.includes('/use-cases/'));
  const hasAdapters = paths.some(p => p.includes('/adapters/') || p.includes('/infrastructure/'));
  if (hasDomain && hasUseCases && hasAdapters) return 'clean_architecture';
  if (hasDomain && hasAdapters) return 'hexagonal';

  // Event Driven
  const hasEvents = paths.some(p => p.includes('/events/') || p.includes('/event/'));
  const hasHandlers = paths.some(p => p.includes('/handlers/') || p.includes('/handler/'));
  if (hasEvents && hasHandlers) return 'event_driven';

  // Serverless
  const hasFunctions = paths.some(p => p.includes('/functions/') || p.includes('/lambda/'));
  const hasWrangler = names.some(n => n === 'wrangler.toml');
  const hasServerless = names.some(n => n.includes('serverless'));
  if (hasFunctions || hasWrangler || hasServerless) return 'serverless';

  // Layered
  const hasPresentation = paths.some(p => p.includes('/presentation/') || p.includes('/ui/') || p.includes('/frontend/'));
  const hasBusiness = paths.some(p => p.includes('/business/') || p.includes('/logic/') || p.includes('/core/'));
  const hasData = paths.some(p => p.includes('/data/') || p.includes('/db/') || p.includes('/database/'));
  if (hasPresentation && hasBusiness && hasData) return 'layered';

  // MVVM
  const hasViewModels = paths.some(p => p.includes('/viewmodels/') || p.includes('/view-model/'));
  if (hasViews && hasViewModels && hasModels) return 'mvvm';

  // Monolith (default)
  return 'monolith';
}

function identifyLayers(files: RepositoryFile[], edges: DependencyEdge[], pattern: ArchitecturePattern): ArchitectureLayer[] {
  const layers: ArchitectureLayer[] = [];

  switch (pattern) {
    case 'mvc':
      layers.push(
        { name: 'Model', files: files.filter(f => f.path.includes('/models/') || f.path.includes('/model/')).map(f => f.path), responsibility: 'Data and business logic', dependencies: [], stability: 0.8 },
        { name: 'View', files: files.filter(f => f.path.includes('/views/') || f.path.includes('/view/') || f.path.includes('/templates/')).map(f => f.path), responsibility: 'UI presentation', dependencies: ['Model'], stability: 0.3 },
        { name: 'Controller', files: files.filter(f => f.path.includes('/controllers/') || f.path.includes('/controller/')).map(f => f.path), responsibility: 'Request handling and routing', dependencies: ['Model', 'View'], stability: 0.5 },
      );
      break;

    case 'clean_architecture':
      layers.push(
        { name: 'Domain', files: files.filter(f => f.path.includes('/domain/') || f.path.includes('/entities/')).map(f => f.path), responsibility: 'Core business logic and entities', dependencies: [], stability: 0.9 },
        { name: 'Use Cases', files: files.filter(f => f.path.includes('/usecases/') || f.path.includes('/use-cases/') || f.path.includes('/application/')).map(f => f.path), responsibility: 'Application business rules', dependencies: ['Domain'], stability: 0.7 },
        { name: 'Interface Adapters', files: files.filter(f => f.path.includes('/adapters/') || f.path.includes('/interfaces/')).map(f => f.path), responsibility: 'Convert data for use cases and external agencies', dependencies: ['Use Cases'], stability: 0.5 },
        { name: 'Frameworks & Drivers', files: files.filter(f => f.path.includes('/infrastructure/') || f.path.includes('/frameworks/') || f.path.includes('/external/')).map(f => f.path), responsibility: 'External frameworks and tools', dependencies: ['Interface Adapters'], stability: 0.2 },
      );
      break;

    case 'layered':
      layers.push(
        { name: 'Presentation', files: files.filter(f => f.path.includes('/presentation/') || f.path.includes('/ui/') || f.path.includes('/frontend/')).map(f => f.path), responsibility: 'User interface', dependencies: [], stability: 0.3 },
        { name: 'Business Logic', files: files.filter(f => f.path.includes('/business/') || f.path.includes('/logic/') || f.path.includes('/core/') || f.path.includes('/service/')).map(f => f.path), responsibility: 'Business rules and workflows', dependencies: ['Presentation'], stability: 0.7 },
        { name: 'Data Access', files: files.filter(f => f.path.includes('/data/') || f.path.includes('/db/') || f.path.includes('/database/') || f.path.includes('/repository/')).map(f => f.path), responsibility: 'Database and storage access', dependencies: ['Business Logic'], stability: 0.6 },
      );
      break;

    case 'microservices':
      // Each service is a layer
      const servicePaths = new Set<string>();
      files.forEach(f => {
        const match = f.path.match(/\/services\/([^/]+)/);
        if (match) servicePaths.add(match[1]);
      });
      servicePaths.forEach(service => {
        layers.push({
          name: `Service: ${service}`,
          files: files.filter(f => f.path.includes(`/services/${service}/`)).map(f => f.path),
          responsibility: `Microservice: ${service}`,
          dependencies: [],
          stability: 0.6,
        });
      });
      break;

    default:
      // Generic layers based on folder structure
      const folderGroups = groupByTopLevelFolder(files);
      for (const [folder, folderFiles] of folderGroups) {
        layers.push({
          name: folder,
          files: folderFiles.map(f => f.path),
          responsibility: `${folder} module`,
          dependencies: [],
          stability: 0.5,
        });
      }
  }

  return layers;
}

function identifyModules(files: RepositoryFile[], edges: DependencyEdge[]): Module[] {
  const moduleMap = new Map<string, RepositoryFile[]>();

  for (const file of files) {
    const modulePath = extractModulePath(file.path);
    if (!moduleMap.has(modulePath)) {
      moduleMap.set(modulePath, []);
    }
    moduleMap.get(modulePath)!.push(file);
  }

  return Array.from(moduleMap.entries()).map(([path, moduleFiles]) => {
    const allImports = new Set<string>();
    const allExports = new Set<string>();
    const externalDeps = new Set<string>();

    for (const file of moduleFiles) {
      (file.imports || []).forEach(i => allImports.add(i));
      (file.exports || []).forEach(e => allExports.add(e));
      (file.dependencies || []).forEach(d => externalDeps.add(d));
    }

    // Calculate cohesion (internal connections / total connections)
    const internalEdges = edges.filter(e => 
      moduleFiles.some(f => f.id === e.sourceFileId) && 
      moduleFiles.some(f => f.id === e.targetFileId)
    ).length;
    const totalEdges = edges.filter(e => 
      moduleFiles.some(f => f.id === e.sourceFileId)
    ).length;
    const cohesion = totalEdges > 0 ? internalEdges / totalEdges : 0;

    // Calculate coupling (external connections / total possible)
    const externalConnections = edges.filter(e =>
      moduleFiles.some(f => f.id === e.sourceFileId) &&
      !moduleFiles.some(f => f.id === e.targetFileId)
    ).length;
    const coupling = files.length > 0 ? externalConnections / files.length : 0;

    return {
      name: path.split('/').pop() || path,
      path,
      files: moduleFiles.map(f => f.path),
      exports: Array.from(allExports),
      imports: Array.from(allImports),
      cohesion: Math.min(cohesion, 1),
      coupling: Math.min(coupling, 1),
      isCritical: moduleFiles.some(f => f.isHotspot || f.importanceScore > 70),
    };
  });
}

function findEntryPoints(files: RepositoryFile[]): string[] {
  const entryPatterns = [
    /index\.(ts|js|tsx|jsx|py|java|go)$/,
    /main\.(ts|js|py|java|go|c|cpp)$/,
    /app\.(ts|js|tsx|jsx|py)$/,
    /server\.(ts|js|py|go)$/,
    /cli\.(ts|js|py|go)$/,
    /entry\.(ts|js)$/,
    /bootstrap\.(ts|js|py)$/,
    /wrangler\.toml$/,
    /package\.json$/,
    /Cargo\.toml$/,
    /go\.mod$/,
    /requirements\.txt$/,
    /Dockerfile$/,
  ];

  return files
    .filter(f => entryPatterns.some(p => p.test(f.name)))
    .map(f => f.path);
}

function findCriticalPaths(files: RepositoryFile[], edges: DependencyEdge[]): string[][] {
  const criticalPaths: string[][] = [];
  const entryPoints = findEntryPoints(files);
  const fileMap = new Map<number, RepositoryFile>();
  files.forEach(f => fileMap.set(f.id, f));

  // Build adjacency list
  const adjacency = new Map<number, number[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.sourceFileId)) adjacency.set(edge.sourceFileId, []);
    adjacency.get(edge.sourceFileId)!.push(edge.targetFileId);
  }

  for (const entry of entryPoints) {
    const entryFile = files.find(f => f.path === entry);
    if (!entryFile) continue;

    // Find all paths from entry to critical files
    const criticalFiles = files.filter(f => f.importanceScore > 70);
    for (const critical of criticalFiles) {
      const path = findPath(entryFile.id, critical.id, adjacency, fileMap);
      if (path.length > 0) {
        criticalPaths.push(path);
      }
    }
  }

  // Sort by length (shorter = more critical)
  return criticalPaths.sort((a, b) => a.length - b.length).slice(0, 10);
}

function findPath(
  start: number,
  end: number,
  adjacency: Map<number, number[]>,
  fileMap: Map<number, RepositoryFile>
): string[] {
  const visited = new Set<number>();
  const queue: Array<{ id: number; path: string[] }> = [{ id: start, path: [] }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    const file = fileMap.get(current.id);
    if (!file) continue;

    const newPath = [...current.path, file.path];
    if (current.id === end) return newPath;

    const neighbors = adjacency.get(current.id) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push({ id: neighbor, path: newPath });
      }
    }
  }

  return [];
}

function extractModulePath(filePath: string): string {
  const parts = filePath.split('/');

  // Common module indicators
  const moduleIndicators = ['src', 'lib', 'app', 'packages', 'modules', 'components', 'services'];
  for (let i = 0; i < parts.length - 1; i++) {
    if (moduleIndicators.includes(parts[i])) {
      return parts.slice(0, i + 2).join('/');
    }
  }

  return parts.slice(0, 2).join('/');
}

function groupByTopLevelFolder(files: RepositoryFile[]): Map<string, RepositoryFile[]> {
  const groups = new Map<string, RepositoryFile[]>();
  for (const file of files) {
    const topLevel = file.path.split('/')[0] || 'root';
    if (!groups.has(topLevel)) groups.set(topLevel, []);
    groups.get(topLevel)!.push(file);
  }
  return groups;
}

export function detectArchitectureDrift(
  currentMap: ArchitectureMap,
  previousMap?: ArchitectureMap
): Array<{
  type: 'layer_violation' | 'new_dependency' | 'removed_layer' | 'module_split' | 'pattern_change';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}> {
  const drift: Array<{ type: 'layer_violation' | 'new_dependency' | 'removed_layer' | 'module_split' | 'pattern_change'; description: string; severity: 'low' | 'medium' | 'high' | 'critical' }> = [];

  if (!previousMap) return drift;

  // Check for pattern change
  if (currentMap.detectedPattern !== previousMap.detectedPattern) {
    drift.push({
      type: 'pattern_change',
      description: `Architecture pattern changed from ${previousMap.detectedPattern} to ${currentMap.detectedPattern}`,
      severity: 'critical',
    });
  }

  // Check for removed layers
  const currentLayerNames = new Set(currentMap.layers.map(l => l.name));
  for (const prevLayer of previousMap.layers) {
    if (!currentLayerNames.has(prevLayer.name)) {
      drift.push({
        type: 'removed_layer',
        description: `Layer removed: ${prevLayer.name}`,
        severity: 'high',
      });
    }
  }

  // Check for layer violations (dependencies going the wrong way)
  for (let i = 0; i < currentMap.layers.length; i++) {
    for (let j = i + 1; j < currentMap.layers.length; j++) {
      const upperLayer = currentMap.layers[i];
      const lowerLayer = currentMap.layers[j];

      // Upper layer should not depend on lower layer in clean architectures
      if (upperLayer.dependencies.includes(lowerLayer.name)) {
        drift.push({
          type: 'layer_violation',
          description: `Layer violation: ${upperLayer.name} depends on ${lowerLayer.name}`,
          severity: 'high',
        });
      }
    }
  }

  return drift;
}
