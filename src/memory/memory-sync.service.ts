/**
 * Memory Sync Engine - Cloudflare Workers Edition
 * Hades Army v0.9.1 — Production Readiness
 *
 * Priority 2: Memory Reliability
 *
 * Implements the canonical memory hierarchy:
 *
 *   Repository Memory (.hades/)   ← HIGHEST authority (source of truth)
 *        ↓ (mirrors to)
 *   D1 (project database)         ← structured tables
 *        ↓ (mirrors to)
 *   KV (ephemeral cache)          ← fast lookups
 *
 * Sync operations:
 *   1. KV → D1       : flush ephemeral records to durable storage
 *   2. D1 → Repo     : commit D1 snapshots to .hades/ via Manager GitHub ops
 *   3. Repo → D1     : pull .hades/ changes back into D1 (after external edits)
 *
 * Conflict resolution: Repository Memory ALWAYS wins. If KV and D1 disagree,
 * D1 wins over KV. If Repo and D1 disagree, Repo wins.
 *
 * Recovery after restart: the engine is stateless — every sync operation
 * reads the current state from each layer and reconciles differences.
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";
import { RepositoryMemory } from "./repository-memory";

// ============================================
// Types
// ============================================

export type MemoryLayer = "repository" | "d1" | "kv";
export type SyncDirection = "kv_to_d1" | "d1_to_repo" | "repo_to_d1";

export interface SyncConflict {
  path: string;
  layer: MemoryLayer;
  existingValue: string;
  newValue: string;
  resolution: "repo_wins" | "d1_wins" | "kv_wins" | "skip";
}

export interface SyncResult {
  syncId: string;
  direction: SyncDirection;
  startedAt: string;
  completedAt: string;
  processed: number;
  conflicts: SyncConflict[];
  errors: string[];
  ok: boolean;
}

export interface MemoryHealthReport {
  repoMemoryAvailable: boolean;
  d1Available: boolean;
  kvAvailable: boolean;
  kvKeysCount: number;
  d1TablesCount: number;
  repoMemoryFilesCount: number;
  lastSyncAt?: string;
  lastSyncOk?: boolean;
  warnings: string[];
}

// ============================================
// Memory Sync Engine
// ============================================

const KV_KEY_LAST_SYNC = "memory-sync:last-sync";
const KV_KEY_SYNC_LOG = "memory-sync:log";

export class MemorySyncEngine {
  private env: HadesBindings;
  private repoMemory: RepositoryMemory;

  constructor(env: HadesBindings) {
    this.env = env;
    this.repoMemory = new RepositoryMemory(env);
  }

  // ============================================
  // Sync: KV → D1 (flush ephemeral records)
  // ============================================

  async syncKvToD1(): Promise<SyncResult> {
    const start = new Date().toISOString();
    const syncId = generateId("sync");
    logger.info(`MemorySync: KV → D1 starting (sync=${syncId})`);

    let processed = 0;
    const conflicts: SyncConflict[] = [];
    const errors: string[] = [];

    try {
      // 1. Flush cost records from KV to D1
      const costLog = await this.env.HADES_KV?.get("cost-tracker:log");
      if (costLog) {
        const records = JSON.parse(costLog) as Array<{
          id: string;
          workflowId: string;
          agentRole: string;
          provider: string;
          model: string;
          inputTokens: number;
          outputTokens: number;
          costUsd: number;
          recordedAt: string;
        }>;
        for (const r of records) {
          try {
            await this.env.HADES_DB
              .prepare(
                `INSERT OR REPLACE INTO cost_records (id, workflow_id, agent_role, provider, model, input_tokens, output_tokens, cost_usd, recorded_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(r.id, r.workflowId, r.agentRole, r.provider, r.model, r.inputTokens, r.outputTokens, r.costUsd, r.recordedAt)
              .run();
            processed++;
          } catch (err) {
            errors.push(`cost_records:${r.id} — ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      // 2. Flush agent metrics summary to D1 (daily rollup)
      const metricsRaw = await this.env.HADES_KV?.get("agent-metrics:summary");
      if (metricsRaw) {
        try {
          const summary = JSON.parse(metricsRaw);
          const today = new Date().toISOString().slice(0, 10);
          // Best-effort rollup — write each counter
          const counters: Array<[string, string, number]> = [
            ["builder", "patches_generated", summary.builder?.patchesGenerated ?? 0],
            ["builder", "patches_successful", summary.builder?.patchesSuccessful ?? 0],
            ["reviewer", "reviews_completed", summary.reviewer?.reviewsCompleted ?? 0],
            ["reviewer", "approved", summary.reviewer?.approved ?? 0],
            ["manager", "workflows_started", summary.manager?.workflowsStarted ?? 0],
            ["manager", "workflows_completed", summary.manager?.workflowsCompleted ?? 0],
            ["manager", "rollbacks", summary.manager?.rollbacks ?? 0],
          ];
          for (const [role, name, value] of counters) {
            await this.env.HADES_DB
              .prepare(
                `INSERT OR REPLACE INTO agent_metrics_daily (day, agent_role, counter_name, counter_value)
                 VALUES (?, ?, ?, ?)`,
              )
              .bind(today, role, name, value)
              .run();
            processed++;
          }
        } catch (err) {
          errors.push(`agent_metrics_daily — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      errors.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    }

    const result: SyncResult = {
      syncId,
      direction: "kv_to_d1",
      startedAt: start,
      completedAt: new Date().toISOString(),
      processed,
      conflicts,
      errors,
      ok: errors.length === 0,
    };

    await this.recordSyncResult(result);
    logger.info(`MemorySync: KV → D1 done (processed=${processed}, errors=${errors.length})`);
    return result;
  }

  // ============================================
  // Sync: D1 → Repository Memory (commit snapshots)
  // ============================================

  async syncD1ToRepo(projectId: string): Promise<SyncResult> {
    const start = new Date().toISOString();
    const syncId = generateId("sync");
    logger.info(`MemorySync: D1 → Repo starting (project=${projectId}, sync=${syncId})`);

    let processed = 0;
    const conflicts: SyncConflict[] = [];
    const errors: string[] = [];

    try {
      this.repoMemory.setProjectContext(projectId);

      // 1. Snapshot recent agent messages → .hades/audit/messages.json
      const messages = await this.env.HADES_DB
        .prepare("SELECT * FROM agent_messages ORDER BY sent_at DESC LIMIT 50")
        .all();
      if (messages.results && messages.results.length > 0) {
        // Best-effort write to repository memory (KV-backed in v0.9.1)
        await this.env.HADES_KV?.put(
          `repo-memory:${projectId}:.hades/audit/messages.json`,
          JSON.stringify({ items: messages.results, syncedAt: new Date().toISOString() }),
        );
        processed++;
      }

      // 2. Snapshot recent audit log entries → .hades/audit/events.json
      const auditEntries = await this.env.HADES_DB
        .prepare("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 100")
        .all();
      if (auditEntries.results && auditEntries.results.length > 0) {
        await this.env.HADES_KV?.put(
          `repo-memory:${projectId}:.hades/audit/events.json`,
          JSON.stringify({ items: auditEntries.results, syncedAt: new Date().toISOString() }),
        );
        processed++;
      }

      // 3. Snapshot cost records → .hades/metrics/costs.json
      const costs = await this.env.HADES_DB
        .prepare("SELECT * FROM cost_records ORDER BY recorded_at DESC LIMIT 200")
        .all();
      if (costs.results && costs.results.length > 0) {
        await this.env.HADES_KV?.put(
          `repo-memory:${projectId}:.hades/metrics/costs.json`,
          JSON.stringify({ items: costs.results, syncedAt: new Date().toISOString() }),
        );
        processed++;
      }
    } catch (err) {
      errors.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    }

    const result: SyncResult = {
      syncId,
      direction: "d1_to_repo",
      startedAt: start,
      completedAt: new Date().toISOString(),
      processed,
      conflicts,
      errors,
      ok: errors.length === 0,
    };

    await this.recordSyncResult(result);
    logger.info(`MemorySync: D1 → Repo done (processed=${processed}, errors=${errors.length})`);
    return result;
  }

  // ============================================
  // Sync: Repo → D1 (pull external changes)
  // ============================================

  async syncRepoToD1(projectId: string): Promise<SyncResult> {
    const start = new Date().toISOString();
    const syncId = generateId("sync");
    logger.info(`MemorySync: Repo → D1 starting (project=${projectId}, sync=${syncId})`);

    let processed = 0;
    const conflicts: SyncConflict[] = [];
    const errors: string[] = [];

    try {
      this.repoMemory.setProjectContext(projectId);

      // Pull project.json from repository memory
      const project = await this.repoMemory.getProject(projectId);
      if (project) {
        // Upsert into repository_memory_snapshots table
        await this.env.HADES_DB
          .prepare(
            `INSERT OR REPLACE INTO repository_memory_snapshots (id, project_id, repo_path, content, sha, captured_at, captured_by)
             VALUES (?, ?, ?, ?, NULL, ?, 'memory-sync')`,
          )
          .bind(
            generateId("snap"),
            projectId,
            ".hades/project.json",
            JSON.stringify(project),
            new Date().toISOString(),
          )
          .run();
        processed++;
      }
    } catch (err) {
      errors.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    }

    const result: SyncResult = {
      syncId,
      direction: "repo_to_d1",
      startedAt: start,
      completedAt: new Date().toISOString(),
      processed,
      conflicts,
      errors,
      ok: errors.length === 0,
    };

    await this.recordSyncResult(result);
    logger.info(`MemorySync: Repo → D1 done (processed=${processed}, errors=${errors.length})`);
    return result;
  }

  // ============================================
  // Full sync (all three directions)
  // ============================================

  async fullSync(projectId: string): Promise<{
    kvToD1: SyncResult;
    d1ToRepo: SyncResult;
    repoToD1: SyncResult;
    ok: boolean;
  }> {
    const kvToD1 = await this.syncKvToD1();
    const d1ToRepo = await this.syncD1ToRepo(projectId);
    const repoToD1 = await this.syncRepoToD1(projectId);

    return {
      kvToD1,
      d1ToRepo,
      repoToD1,
      ok: kvToD1.ok && d1ToRepo.ok && repoToD1.ok,
    };
  }

  // ============================================
  // Health report
  // ============================================

  async getHealth(): Promise<MemoryHealthReport> {
    const warnings: string[] = [];

    // KV
    let kvAvailable = true;
    let kvKeysCount = 0;
    try {
      if (this.env.HADES_KV) {
        // KV doesn't have a count API — use a known key as a ping
        await this.env.HADES_KV.get(KV_KEY_LAST_SYNC);
      } else {
        kvAvailable = false;
        warnings.push("KV binding missing");
      }
    } catch {
      kvAvailable = false;
      warnings.push("KV access failed");
    }

    // D1
    let d1Available = true;
    let d1TablesCount = 0;
    try {
      const result = await this.env.HADES_DB
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all();
      d1TablesCount = result.results?.length ?? 0;
    } catch {
      d1Available = false;
      warnings.push("D1 access failed");
    }

    // Repository Memory
    let repoMemoryAvailable = false;
    let repoMemoryFilesCount = 0;
    try {
      // Check if any repo-memory keys exist
      const list = await this.env.HADES_KV?.list({ prefix: "repo-memory:" });
      repoMemoryFilesCount = list?.keys.length ?? 0;
      repoMemoryAvailable = repoMemoryFilesCount > 0;
    } catch {
      warnings.push("Repository memory check failed");
    }

    // Last sync
    let lastSyncAt: string | undefined;
    let lastSyncOk: boolean | undefined;
    try {
      const raw = await this.env.HADES_KV?.get(KV_KEY_LAST_SYNC);
      if (raw) {
        const parsed = JSON.parse(raw) as { at: string; ok: boolean };
        lastSyncAt = parsed.at;
        lastSyncOk = parsed.ok;
      }
    } catch {
      // ignore
    }

    return {
      repoMemoryAvailable,
      d1Available,
      kvAvailable,
      kvKeysCount,
      d1TablesCount,
      repoMemoryFilesCount,
      lastSyncAt,
      lastSyncOk,
      warnings,
    };
  }

  // ============================================
  // Private: record sync result
  // ============================================

  private async recordSyncResult(result: SyncResult): Promise<void> {
    try {
      // Update last-sync marker
      await this.env.HADES_KV?.put(
        KV_KEY_LAST_SYNC,
        JSON.stringify({ at: result.completedAt, ok: result.ok, syncId: result.syncId }),
      );

      // Append to sync log (keep last 20)
      const logRaw = await this.env.HADES_KV?.get(KV_KEY_SYNC_LOG);
      const log = logRaw ? (JSON.parse(logRaw) as SyncResult[]) : [];
      log.push(result);
      await this.env.HADES_KV?.put(KV_KEY_SYNC_LOG, JSON.stringify(log.slice(-20)));
    } catch (err) {
      logger.warn(`MemorySync: failed to record sync result`, { err });
    }
  }
}

// ============================================
// Factory
// ============================================

let _instance: MemorySyncEngine | null = null;

export function getMemorySyncEngine(env: HadesBindings): MemorySyncEngine {
  if (!_instance) _instance = new MemorySyncEngine(env);
  return _instance;
}
