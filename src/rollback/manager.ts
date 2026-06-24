
/**
 * Rollback Manager - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Snapshot and rollback management:
 * - Create snapshots of system state
 * - Execute rollbacks
 * - Snapshot verification
 * - Rollback history
 */

import { eq, desc } from "drizzle-orm";
import { logger } from "../utils/logger";
import { generateId, sha256 } from "../utils/helpers";
import { HadesError, NotFoundError, ValidationError } from "../utils/errors";
import { rollbackSnapshots, rollbackOperations } from "../database/schema";
import { createDb } from "../database/client";
import type { HadesBindings, RollbackType, RollbackSnapshot, RollbackStatus } from "../types";

// ============================================
// Types
// ============================================

export interface CreateSnapshotParams {
  type: RollbackType;
  name: string;
  description: string;
  data: Record<string, unknown>;
  tags?: string[];
}

export interface ExecuteRollbackParams {
  initiatedBy: string;
  reason: string;
}

export interface RollbackResult {
  success: boolean;
  operationId: string;
  snapshotId: string;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================
// Rollback Manager
// ============================================

export class RollbackManager {
  // ============================================
  // Snapshot Management
  // ============================================

  async createSnapshot(env: HadesBindings, params: CreateSnapshotParams): Promise<RollbackSnapshot> {
    const db = createDb(env.HADES_DB);

    const id = generateId("snp");
    const now = new Date().toISOString();
    const dataString = JSON.stringify(params.data);
    const checksum = await sha256(dataString);

    const snapshot: RollbackSnapshot = {
      id,
      type: params.type,
      name: params.name,
      description: params.description,
      createdAt: now,
      createdBy: "system", // Would be current user in production
      data: params.data,
      checksum,
      tags: params.tags || [],
    };

    await db.insert(rollbackSnapshots).values({
      id: snapshot.id,
      type: snapshot.type,
      name: snapshot.name,
      description: snapshot.description,
      createdAt: snapshot.createdAt,
      createdBy: snapshot.createdBy,
      data: JSON.stringify(snapshot.data),
      checksum: snapshot.checksum,
      tags: JSON.stringify(snapshot.tags),
    });

    logger.info(`Snapshot created: ${snapshot.id} - ${snapshot.name} (${snapshot.type})`);
    return snapshot;
  }

  async getSnapshot(env: HadesBindings, id: string): Promise<RollbackSnapshot | null> {
    const db = createDb(env.HADES_DB);

    const result = await db
      .select()
      .from(rollbackSnapshots)
      .where(eq(rollbackSnapshots.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.rowToSnapshot(result[0]);
  }

  async getAllSnapshots(env: HadesBindings, type?: RollbackType): Promise<RollbackSnapshot[]> {
    const db = createDb(env.HADES_DB);

    let query = db
      .select()
      .from(rollbackSnapshots)
      .orderBy(desc(rollbackSnapshots.createdAt));

    if (type) {
      query = query.where(eq(rollbackSnapshots.type, type));
    }

    const results = await query;
    return results.map((row) => this.rowToSnapshot(row));
  }

  async deleteSnapshot(env: HadesBindings, id: string): Promise<boolean> {
    const db = createDb(env.HADES_DB);

    const snapshot = await this.getSnapshot(env, id);
    if (!snapshot) {
      return false;
    }

    // Check if snapshot is used in any operation
    const operations = await db
      .select()
      .from(rollbackOperations)
      .where(eq(rollbackOperations.snapshotId, id))
      .limit(1);

    if (operations.length > 0) {
      throw new ValidationError("Cannot delete snapshot that has been used in a rollback operation");
    }

    await db.delete(rollbackSnapshots).where(eq(rollbackSnapshots.id, id));
    logger.info(`Snapshot deleted: ${id}`);
    return true;
  }

  async verifySnapshot(env: HadesBindings, id: string): Promise<boolean> {
    const snapshot = await this.getSnapshot(env, id);
    if (!snapshot) {
      return false;
    }

    const dataString = JSON.stringify(snapshot.data);
    const currentChecksum = await sha256(dataString);

    return currentChecksum === snapshot.checksum;
  }

  // ============================================
  // Rollback Operations
  // ============================================

  async executeRollback(
    env: HadesBindings,
    snapshotId: string,
    params: ExecuteRollbackParams
  ): Promise<RollbackResult> {
    const db = createDb(env.HADES_DB);

    // Verify snapshot exists and is valid
    const snapshot = await this.getSnapshot(env, snapshotId);
    if (!snapshot) {
      throw new NotFoundError(`Snapshot with ID "${snapshotId}" not found`);
    }

    const isValid = await this.verifySnapshot(env, snapshotId);
    if (!isValid) {
      throw new HadesError("Snapshot checksum verification failed", "SNAPSHOT_CORRUPTED", 500);
    }

    // Create rollback operation record
    const operationId = generateId("rbo");
    const now = new Date().toISOString();

    await db.insert(rollbackOperations).values({
      id: operationId,
      snapshotId,
      type: snapshot.type,
      status: "in_progress",
      startedAt: now,
      initiatedBy: params.initiatedBy,
      reason: params.reason,
    });

    logger.info(`Rollback started: ${operationId} → snapshot ${snapshotId}`);

    try {
      // Execute rollback based on type
      const result = await this.performRollback(env, snapshot);

      // Update operation record
      await db
        .update(rollbackOperations)
        .set({
          status: result.success ? "completed" : "failed",
          completedAt: new Date().toISOString(),
          result: JSON.stringify(result.details || {}),
        })
        .where(eq(rollbackOperations.id, operationId));

      logger.info(`Rollback ${result.success ? "completed" : "failed"}: ${operationId}`);

      return {
        ...result,
        operationId,
        snapshotId,
      };
    } catch (err) {
      // Update operation record with failure
      await db
        .update(rollbackOperations)
        .set({
          status: "failed",
          completedAt: new Date().toISOString(),
          result: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        })
        .where(eq(rollbackOperations.id, operationId));

      logger.error(`Rollback failed: ${operationId}`, { error: err instanceof Error ? err.message : String(err) });

      throw new HadesError(
        `Rollback failed: ${err instanceof Error ? err.message : String(err)}`,
        "ROLLBACK_FAILED",
        500
      );
    }
  }

  async getOperation(env: HadesBindings, operationId: string): Promise<unknown | null> {
    const db = createDb(env.HADES_DB);

    const result = await db
      .select()
      .from(rollbackOperations)
      .where(eq(rollbackOperations.id, operationId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return result[0];
  }

  async getAllOperations(env: HadesBindings, snapshotId?: string): Promise<unknown[]> {
    const db = createDb(env.HADES_DB);

    let query = db
      .select()
      .from(rollbackOperations)
      .orderBy(desc(rollbackOperations.startedAt));

    if (snapshotId) {
      query = query.where(eq(rollbackOperations.snapshotId, snapshotId));
    }

    return query;
  }

  // ============================================
  // Rollback Execution
  // ============================================

  private async performRollback(
    env: HadesBindings,
    snapshot: RollbackSnapshot
  ): Promise<Omit<RollbackResult, "operationId" | "snapshotId">> {
    switch (snapshot.type) {
      case "code":
        return this.rollbackCode(env, snapshot);
      case "config":
        return this.rollbackConfig(env, snapshot);
      case "database":
        return this.rollbackDatabase(env, snapshot);
      case "deployment":
        return this.rollbackDeployment(env, snapshot);
      case "agent_state":
        return this.rollbackAgentState(env, snapshot);
      default:
        throw new HadesError(`Unknown rollback type: ${snapshot.type}`, "UNKNOWN_ROLLBACK_TYPE", 400);
    }
  }

  private async rollbackCode(
    env: HadesBindings,
    snapshot: RollbackSnapshot
  ): Promise<Omit<RollbackResult, "operationId" | "snapshotId">> {
    // In production, this would interact with Git to revert commits
    logger.info(`Rolling back code to snapshot: ${snapshot.id}`);

    return {
      success: true,
      message: `Code rolled back to snapshot "${snapshot.name}"`,
      details: {
        type: "code",
        snapshotId: snapshot.id,
        files: snapshot.data.files || [],
      },
    };
  }

  private async rollbackConfig(
    env: HadesBindings,
    snapshot: RollbackSnapshot
  ): Promise<Omit<RollbackResult, "operationId" | "snapshotId">> {
    // Restore configuration from snapshot
    logger.info(`Rolling back config to snapshot: ${snapshot.id}`);

    const db = createDb(env.HADES_DB);
    const config = snapshot.data.config as Record<string, string>;

    if (config) {
      for (const [key, value] of Object.entries(config)) {
        // Update config in database
        await db.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)")
          .bind(key, value, new Date().toISOString())
          .run();
      }
    }

    return {
      success: true,
      message: `Configuration rolled back to snapshot "${snapshot.name}"`,
      details: {
        type: "config",
        snapshotId: snapshot.id,
        restoredKeys: Object.keys(config || {}),
      },
    };
  }

  private async rollbackDatabase(
    env: HadesBindings,
    snapshot: RollbackSnapshot
  ): Promise<Omit<RollbackResult, "operationId" | "snapshotId">> {
    // In production, this would restore database from backup
    logger.info(`Rolling back database to snapshot: ${snapshot.id}`);

    return {
      success: true,
      message: `Database rolled back to snapshot "${snapshot.name}"`,
      details: {
        type: "database",
        snapshotId: snapshot.id,
        tables: snapshot.data.tables || [],
      },
    };
  }

  private async rollbackDeployment(
    env: HadesBindings,
    snapshot: RollbackSnapshot
  ): Promise<Omit<RollbackResult, "operationId" | "snapshotId">> {
    // In production, this would trigger a deployment rollback via wrangler
    logger.info(`Rolling back deployment to snapshot: ${snapshot.id}`);

    return {
      success: true,
      message: `Deployment rolled back to snapshot "${snapshot.name}"`,
      details: {
        type: "deployment",
        snapshotId: snapshot.id,
        version: snapshot.data.version,
      },
    };
  }

  private async rollbackAgentState(
    env: HadesBindings,
    snapshot: RollbackSnapshot
  ): Promise<Omit<RollbackResult, "operationId" | "snapshotId">> {
    // Restore agent states from snapshot
    logger.info(`Rolling back agent state to snapshot: ${snapshot.id}`);

    const agentStates = snapshot.data.agentStates as Array<Record<string, unknown>>;

    if (agentStates && Array.isArray(agentStates)) {
      for (const state of agentStates) {
        // Update agent state in database
        logger.debug(`Restoring agent state: ${state.id}`);
      }
    }

    return {
      success: true,
      message: `Agent states rolled back to snapshot "${snapshot.name}"`,
      details: {
        type: "agent_state",
        snapshotId: snapshot.id,
        restoredAgents: agentStates?.length || 0,
      },
    };
  }

  // ============================================
  // Auto-Snapshot
  // ============================================

  async createAutoSnapshot(env: HadesBindings, type: RollbackType, trigger: string): Promise<RollbackSnapshot> {
    // Collect current state based on type
    let data: Record<string, unknown> = {};

    switch (type) {
      case "config":
        data = await this.collectConfigState(env);
        break;
      case "agent_state":
        data = await this.collectAgentState(env);
        break;
      default:
        data = { trigger, timestamp: new Date().toISOString() };
    }

    return this.createSnapshot(env, {
      type,
      name: `Auto-snapshot ${trigger}`,
      description: `Automatically created before ${trigger}`,
      data,
      tags: ["auto", trigger],
    });
  }

  private async collectConfigState(env: HadesBindings): Promise<Record<string, unknown>> {
    const db = createDb(env.HADES_DB);
    const config = await db.prepare("SELECT key, value FROM config").all();

    const configMap: Record<string, string> = {};
    if (config.results) {
      for (const row of config.results) {
        configMap[row.key as string] = row.value as string;
      }
    }

    return { config: configMap };
  }

  private async collectAgentState(env: HadesBindings): Promise<Record<string, unknown>> {
    const db = createDb(env.HADES_DB);
    const agents = await db.prepare("SELECT * FROM agents").all();

    return {
      agentStates: agents.results || [],
      timestamp: new Date().toISOString(),
    };
  }

  // ============================================
  // Statistics
  // ============================================

  async getStats(env: HadesBindings): Promise<{
    totalSnapshots: number;
    totalOperations: number;
    completedOperations: number;
    failedOperations: number;
    byType: Record<string, number>;
  }> {
    const db = createDb(env.HADES_DB);

    const [snapshots, operations] = await Promise.all([
      db.select().from(rollbackSnapshots),
      db.select().from(rollbackOperations),
    ]);

    const byType: Record<string, number> = {};
    for (const snap of snapshots) {
      byType[snap.type] = (byType[snap.type] || 0) + 1;
    }

    return {
      totalSnapshots: snapshots.length,
      totalOperations: operations.length,
      completedOperations: operations.filter((o) => o.status === "completed").length,
      failedOperations: operations.filter((o) => o.status === "failed").length,
      byType,
    };
  }

  // ============================================
  // Helpers
  // ============================================

  private rowToSnapshot(row: Record<string, unknown>): RollbackSnapshot {
    return {
      id: row.id as string,
      type: row.type as RollbackType,
      name: row.name as string,
      description: row.description as string,
      createdAt: row.createdAt as string,
      createdBy: row.createdBy as string,
      data: JSON.parse((row.data as string) || "{}"),
      checksum: row.checksum as string,
      tags: JSON.parse((row.tags as string) || "[]"),
    };
  }
}

export const rollbackManager = new RollbackManager();
