/**
 * Memory Inspector - Cloudflare Workers Edition
 * Hades Army v0.9.2 — Memory System
 *
 * Priority 2: Memory Inspector + Health Score
 *
 * The Manager can inspect:
 *   - What is stored (per layer: KV / D1 / Repository)
 *   - Last sync time
 *   - Context size (estimated bytes)
 *   - Coverage score (how complete is the memory)
 *   - Missing knowledge items
 *
 * Also computes a Memory Health Score:
 *   - Project Memory: Healthy / Stale / Missing
 *   - Context Coverage: 0-100%
 *   - Sync Status: OK / Stale / Failed
 *   - Missing Knowledge: count
 */

import { logger } from "../utils/logger";
import type { HadesBindings } from "../types";
import { RepositoryMemory, HADES_PATHS } from "./repository-memory";
import { getMemorySyncEngine, type MemoryHealthReport } from "./memory-sync.service";

// ============================================
// Types
// ============================================

export type MemoryLayerStatus = "healthy" | "stale" | "missing" | "failed";

export interface LayerInspection {
  layer: "repository" | "d1" | "kv";
  status: MemoryLayerStatus;
  itemCount: number;
  estimatedBytes: number;
  lastSyncAt?: string;
  details: string[];
}

export interface MemoryInspection {
  projectId: string;
  layers: LayerInspection[];
  totalBytes: number;
  totalItems: number;
  checkedAt: string;
  /** paths in .hades/ that exist */
  existingPaths: string[];
  /** paths in .hades/ that should exist but don't */
  missingPaths: string[];
  /** knowledge notes count */
  knowledgeCount: number;
  /** past failures count */
  failureCount: number;
}

export interface MemoryHealthScore {
  overall: "healthy" | "degraded" | "unhealthy";
  projectMemory: MemoryLayerStatus;
  contextCoverage: number;       // 0-100
  syncStatus: MemoryLayerStatus;
  missingKnowledge: number;
  lastSyncAt?: string;
  warnings: string[];
  recommendations: string[];
}

// ============================================
// Required .hades/ paths
// ============================================

const REQUIRED_PATHS: string[] = [
  HADES_PATHS.projectJson,
  `${".hades"}/architecture.json`,
  `${".hades"}/roadmap.json`,
  `${".hades"}/decisions.json`,
  HADES_PATHS.metricsJson,
];

const OPTIONAL_PATHS: string[] = [
  `${".hades"}/tasks/open.json`,
  `${".hades"}/tasks/closed.json`,
  `${".hades"}/reviews.json`,
  `${".hades"}/failures.json`,
  `${".hades"}/knowledge.json`,
];

// ============================================
// Inspector
// ============================================

export class MemoryInspector {
  private env: HadesBindings;
  private repoMemory: RepositoryMemory;
  private syncEngine: ReturnType<typeof getMemorySyncEngine>;

  constructor(env: HadesBindings) {
    this.env = env;
    this.repoMemory = new RepositoryMemory(env);
    this.syncEngine = getMemorySyncEngine(env);
  }

  // ============================================
  // Inspect a project's memory across all layers
  // ============================================

  async inspect(projectId: string): Promise<MemoryInspection> {
    this.repoMemory.setProjectContext(projectId);

    const layers: LayerInspection[] = [];
    let totalBytes = 0;
    let totalItems = 0;
    const existingPaths: string[] = [];
    const missingPaths: string[] = [];

    // --- Repository Memory layer ---
    const repoItems: string[] = [];
    let repoBytes = 0;
    let knowledgeCount = 0;
    let failureCount = 0;

    for (const path of [...REQUIRED_PATHS, ...OPTIONAL_PATHS]) {
      const raw = await this.readRepoPath(projectId, path);
      if (raw) {
        existingPaths.push(path);
        repoItems.push(path);
        const bytes = new TextEncoder().encode(raw).length;
        repoBytes += bytes;

        // Count items in arrays
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed?.items)) {
            totalItems += parsed.items.length;
            if (path.endsWith("/knowledge.json")) knowledgeCount = parsed.items.length;
            if (path.endsWith("/failures.json")) failureCount = parsed.items.length;
          } else if (path.endsWith("project.json")) {
            totalItems += 1;
          } else if (path.endsWith("metrics.json")) {
            totalItems += 1;
          }
        } catch {
          // not JSON — skip
        }
      } else if (REQUIRED_PATHS.includes(path)) {
        missingPaths.push(path);
      }
    }

    const repoStatus: MemoryLayerStatus = missingPaths.length === 0
      ? "healthy"
      : missingPaths.length === REQUIRED_PATHS.length
        ? "missing"
        : "stale";

    layers.push({
      layer: "repository",
      status: repoStatus,
      itemCount: repoItems.length,
      estimatedBytes: repoBytes,
      details: repoItems.length > 0 ? repoItems : ["(no .hades/ files found)"],
    });
    totalBytes += repoBytes;

    // --- D1 layer ---
    let d1Items = 0;
    let d1Bytes = 0;
    let d1Status: MemoryLayerStatus = "healthy";
    const d1Details: string[] = [];

    try {
      const tables = ["agent_messages", "workflows", "audit_log", "cost_records", "github_audit_log", "connected_repositories", "conversation_states"];
      for (const table of tables) {
        try {
          const result = await this.env.HADES_DB
            .prepare(`SELECT COUNT(*) as count FROM ${table}`)
            .first<{ count: number }>();
          const count = result?.count ?? 0;
          if (count > 0) {
            d1Items += count;
            d1Bytes += count * 200; // rough estimate: 200 bytes per row
            d1Details.push(`${table}: ${count}`);
          }
        } catch {
          // table doesn't exist — skip
        }
      }
      if (d1Items === 0) d1Status = "stale";
    } catch (err) {
      d1Status = "failed";
      d1Details.push(`D1 access failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    layers.push({
      layer: "d1",
      status: d1Status,
      itemCount: d1Items,
      estimatedBytes: d1Bytes,
      details: d1Details.length > 0 ? d1Details : ["(empty)"],
    });
    totalBytes += d1Bytes;
    totalItems += d1Items;

    // --- KV layer ---
    let kvItems = 0;
    let kvBytes = 0;
    let kvStatus: MemoryLayerStatus = "healthy";
    const kvDetails: string[] = [];

    try {
      if (!this.env.HADES_KV) {
        kvStatus = "missing";
        kvDetails.push("KV binding not configured");
      } else {
        const list = await this.env.HADES_KV.list();
        kvItems = list.keys.length;
        // Estimate bytes — we can't read all values efficiently
        kvBytes = kvItems * 500; // rough estimate: 500 bytes per key

        // Group by prefix for the report
        const prefixes = new Map<string, number>();
        for (const key of list.keys) {
          const prefix = key.name.split(":").slice(0, 2).join(":");
          prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
        }
        for (const [prefix, count] of prefixes) {
          kvDetails.push(`${prefix}: ${count}`);
        }

        if (kvItems === 0) kvStatus = "stale";
      }
    } catch (err) {
      kvStatus = "failed";
      kvDetails.push(`KV access failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    layers.push({
      layer: "kv",
      status: kvStatus,
      itemCount: kvItems,
      estimatedBytes: kvBytes,
      details: kvDetails.length > 0 ? kvDetails : ["(empty)"],
    });
    totalBytes += kvBytes;

    return {
      projectId,
      layers,
      totalBytes,
      totalItems,
      checkedAt: new Date().toISOString(),
      existingPaths,
      missingPaths,
      knowledgeCount,
      failureCount,
    };
  }

  // ============================================
  // Compute health score
  // ============================================

  async computeHealthScore(projectId: string): Promise<MemoryHealthScore> {
    const inspection = await this.inspect(projectId);
    const syncHealth: MemoryHealthReport = await this.syncEngine.getHealth();

    // Project memory status
    const repoLayer = inspection.layers.find((l) => l.layer === "repository")!;
    const projectMemory: MemoryLayerStatus = repoLayer.status;

    // Sync status
    let syncStatus: MemoryLayerStatus = "healthy";
    if (!syncHealth.repoMemoryAvailable && !syncHealth.d1Available && !syncHealth.kvAvailable) {
      syncStatus = "failed";
    } else if (syncHealth.warnings.length > 0) {
      syncStatus = "stale";
    }

    // Context coverage: how many required paths exist + how much knowledge
    const totalRequired = REQUIRED_PATHS.length;
    const existingRequired = REQUIRED_PATHS.filter((p) => inspection.existingPaths.includes(p)).length;
    const pathCoverage = (existingRequired / totalRequired) * 60; // 60% weight
    const knowledgeCoverage = Math.min(40, inspection.knowledgeCount * 5); // 40% weight, 8 notes = full
    const contextCoverage = Math.round(pathCoverage + knowledgeCoverage);

    // Missing knowledge
    const missingKnowledge = REQUIRED_PATHS.filter((p) => !inspection.existingPaths.includes(p)).length;

    // Overall
    let overall: MemoryHealthScore["overall"] = "healthy";
    const warnings: string[] = [];
    const recommendations: string[] = [];

    if (projectMemory === "missing") {
      overall = "unhealthy";
      warnings.push("Repository memory (.hades/) is missing — onboarding incomplete");
      recommendations.push("Run the Repository Wizard to complete onboarding");
    } else if (projectMemory === "stale") {
      overall = "degraded";
      warnings.push(`Repository memory is missing ${inspection.missingPaths.length} required file(s)`);
      recommendations.push(`Re-run onboarding or manually create: ${inspection.missingPaths.join(", ")}`);
    }

    if (syncStatus === "failed") {
      overall = "unhealthy";
      warnings.push("Memory sync is not operational");
      recommendations.push("Check D1/KV bindings in wrangler.toml");
    } else if (syncStatus === "stale") {
      if (overall === "healthy") overall = "degraded";
      warnings.push(`Memory sync warnings: ${syncHealth.warnings.join(", ")}`);
    }

    if (contextCoverage < 50) {
      if (overall === "healthy") overall = "degraded";
      warnings.push(`Context coverage is low (${contextCoverage}%)`);
      recommendations.push("Add more knowledge notes via the Manager");
    }

    if (inspection.failureCount > 10) {
      warnings.push(`${inspection.failureCount} recorded failures — Manager should review lessons learned`);
    }

    if (warnings.length === 0 && recommendations.length === 0) {
      recommendations.push("Memory is healthy — no action needed");
    }

    return {
      overall,
      projectMemory,
      contextCoverage,
      syncStatus,
      missingKnowledge,
      lastSyncAt: syncHealth.lastSyncAt,
      warnings,
      recommendations,
    };
  }

  // ============================================
  // Render for Telegram
  // ============================================

  renderInspection(inspection: MemoryInspection): string {
    const lines: string[] = [
      `🔍 *Memory Inspector* — \`${inspection.projectId}\``,
      ``,
      `*Total:* ${inspection.totalItems} items · ${this.formatBytes(inspection.totalBytes)}`,
      ``,
    ];

    for (const layer of inspection.layers) {
      const icon = layer.status === "healthy" ? "✅" :
                   layer.status === "stale" ? "⚠️" :
                   layer.status === "missing" ? "⚫" :
                   "❌";
      lines.push(`${icon} *${layer.layer.toUpperCase()}* — ${layer.status} · ${layer.itemCount} items · ${this.formatBytes(layer.estimatedBytes)}`);
      for (const d of layer.details.slice(0, 5)) {
        lines.push(`   • ${d}`);
      }
      if (layer.details.length > 5) lines.push(`   • ... and ${layer.details.length - 5} more`);
      lines.push(``);
    }

    if (inspection.missingPaths.length > 0) {
      lines.push(`*Missing required paths:*`);
      for (const p of inspection.missingPaths) lines.push(`   • \`${p}\``);
    }

    return lines.join("\n");
  }

  renderHealthScore(score: MemoryHealthScore): string {
    const icon = score.overall === "healthy" ? "✅" :
                 score.overall === "degraded" ? "⚠️" :
                 "❌";
    const lines: string[] = [
      `🩺 *Memory Health Score* ${icon}`,
      ``,
      `*Overall:* ${score.overall.toUpperCase()}`,
      `*Project Memory:* ${score.projectMemory}`,
      `*Context Coverage:* ${score.contextCoverage}%`,
      `*Sync Status:* ${score.syncStatus}`,
      `*Missing Knowledge:* ${score.missingKnowledge} item(s)`,
    ];
    if (score.lastSyncAt) {
      lines.push(`*Last Sync:* ${new Date(score.lastSyncAt).toLocaleString()}`);
    }
    if (score.warnings.length > 0) {
      lines.push(``);
      lines.push(`*Warnings:*`);
      for (const w of score.warnings) lines.push(`   ⚠️ ${w}`);
    }
    if (score.recommendations.length > 0) {
      lines.push(``);
      lines.push(`*Recommendations:*`);
      for (const r of score.recommendations) lines.push(`   → ${r}`);
    }
    return lines.join("\n");
  }

  // ============================================
  // Private helpers
  // ============================================

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  private async readRepoPath(projectId: string, path: string): Promise<string | undefined> {
    if (!this.env.HADES_KV) return undefined;
    return this.env.HADES_KV.get(`repo-memory:${projectId}:${path}`);
  }
}

// ============================================
// Factory
// ============================================

let _instance: MemoryInspector | null = null;

export function getMemoryInspector(env: HadesBindings): MemoryInspector {
  if (!_instance) _instance = new MemoryInspector(env);
  return _instance;
}
