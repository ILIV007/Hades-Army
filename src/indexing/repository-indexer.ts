/**
 * Hades Army v0.4 — Repository Indexer
 * Scans repository, builds index, selects relevant files.
 * Manager never loads entire repository.
 */

import type { HadesEnv } from "../config/env";
import type { Project, ProjectIndex, ProjectIndexFile, ProjectIndexModule } from "../types";
import { GitHubRepoClient } from "../github/clients/repo.client";
import { Logger } from "../utils/logger";
import { KVClient } from "../memory/kv.client";

export class RepositoryIndexer {
  private repo: GitHubRepoClient;
  private logger: Logger;
  private kv: KVClient;

  constructor(env: HadesEnv, project: Project) {
    this.repo = new GitHubRepoClient(env, project);
    this.logger = new Logger(env, project.id);
    this.kv = new KVClient(env);
  }

  async buildIndex(): Promise<ProjectIndex> {
    await this.logger.info("indexing", "Starting repository scan");

    const tree = await this.repo.getTree();
    const readme = await this.repo.getReadme();

    const files: ProjectIndexFile[] = [];
    const modules: ProjectIndexModule[] = [];
    const moduleMap = new Map<string, string[]>();

    for (const item of tree) {
      if (item.type !== "blob") continue;

      const fileType = this.classifyFile(item.path);
      const moduleName = this.extractModule(item.path);

      files.push({
        path: item.path,
        type: fileType,
        size: item.size ?? 0,
        lastModified: new Date().toISOString(), // GitHub doesn't provide this in tree
        module: moduleName,
        features: [], // Populated by LLM analysis later
      });

      if (!moduleMap.has(moduleName)) {
        moduleMap.set(moduleName, []);
      }
      moduleMap.get(moduleName)!.push(item.path);
    }

    for (const [name, fileList] of moduleMap) {
      modules.push({
        name,
        files: fileList,
        dependencies: [],
      });
    }

    const index: ProjectIndex = {
      version: "1.0",
      generatedAt: new Date().toISOString(),
      files,
      modules,
      dependencies: [],
    };

    // Store in KV for fast access
    await this.kv.setRepoIndex(project.id, JSON.stringify(index));

    await this.logger.info("indexing", `Index complete: ${files.length} files, ${modules.length} modules`);

    return index;
  }

  async getIndex(): Promise<ProjectIndex | null> {
    const cached = await this.kv.getRepoIndex(project.id);
    if (cached) {
      return JSON.parse(cached);
    }
    return null;
  }

  /**
   * Select files relevant to a task
   */
  async selectRelevantFiles(taskDescription: string, maxFiles: number = 10): Promise<string[]> {
    const index = await this.getIndex();
    if (!index) return [];

    const desc = taskDescription.toLowerCase();
    const scored = index.files.map(file => {
      let score = 0;
      const path = file.path.toLowerCase();

      // Exact match
      if (desc.includes(path) || path.includes(desc.split(" ")[0])) score += 10;

      // Module match
      if (desc.includes(file.module.toLowerCase())) score += 5;

      // File type relevance
      if (file.type === "source" && desc.includes("implement")) score += 3;
      if (file.type === "test" && desc.includes("test")) score += 5;
      if (file.type === "config" && desc.includes("config")) score += 5;

      // Size penalty (prefer smaller files for context)
      if (file.size > 50000) score -= 2;

      return { path: file.path, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxFiles).map(s => s.path);
  }

  private classifyFile(path: string): "source" | "config" | "doc" | "test" | "asset" {
    if (path.includes("test") || path.includes("spec")) return "test";
    if (path.includes("config") || path.endsWith(".json") || path.endsWith(".toml") || path.endsWith(".yaml") || path.endsWith(".yml")) return "config";
    if (path.includes("doc") || path.endsWith(".md") || path.endsWith(".txt")) return "doc";
    if (path.endsWith(".png") || path.endsWith(".jpg") || path.endsWith(".svg") || path.endsWith(".ico")) return "asset";
    return "source";
  }

  private extractModule(path: string): string {
    const parts = path.split("/");
    if (parts.length > 1) {
      return parts[0] === "src" ? parts[1] ?? "root" : parts[0];
    }
    return "root";
  }
}
