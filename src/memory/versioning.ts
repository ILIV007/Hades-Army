
/**
 * Memory Versioning - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Version control for memory entries:
 * - Automatic versioning on updates
 * - Version history tracking
 * - Rollback to previous versions
 * - Diff generation
 */

import { eq, desc } from "drizzle-orm";
import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import { memoryEntries, memoryVersions } from "../database/schema";
import { createDb } from "../database/client";
import type { HadesBindings, MemoryEntry, MemoryVersion } from "../types";

// ============================================
// Types
// ============================================

export interface VersionDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface VersionComparison {
  version1: number;
  version2: number;
  diffs: VersionDiff[];
}

// ============================================
// Memory Versioning Service
// ============================================

export class MemoryVersioningService {
  private maxVersions: number = 50; // Max versions per entry

  // ============================================
  // Version Creation
  // ============================================

  async createVersion(
    env: HadesBindings,
    entryId: string,
    value: unknown,
    createdBy: string = "system",
    changeDescription?: string
  ): Promise<MemoryVersion> {
    const db = createDb(env.HADES_DB);

    // Get current entry to determine version number
    const entryResult = await db
      .select()
      .from(memoryEntries)
      .where(eq(memoryEntries.id, entryId))
      .limit(1);

    if (entryResult.length === 0) {
      throw new Error(`Memory entry not found: ${entryId}`);
    }

    const entry = entryResult[0];
    const versionNumber = entry.version;

    const version: MemoryVersion = {
      id: generateId("ver"),
      entryId,
      version: versionNumber,
      value,
      createdAt: new Date().toISOString(),
      createdBy,
      changeDescription,
    };

    await db.insert(memoryVersions).values({
      id: version.id,
      entryId: version.entryId,
      version: version.version,
      value: JSON.stringify(version.value),
      createdAt: version.createdAt,
      createdBy: version.createdBy,
      changeDescription: version.changeDescription,
    });

    // Cleanup old versions
    await this.cleanupOldVersions(env, entryId);

    logger.info(`Version created: ${entry.key} v${versionNumber}`);
    return version;
  }

  // ============================================
  // Version Retrieval
  // ============================================

  async getVersions(env: HadesBindings, entryId: string): Promise<MemoryVersion[]> {
    const db = createDb(env.HADES_DB);

    const results = await db
      .select()
      .from(memoryVersions)
      .where(eq(memoryVersions.entryId, entryId))
      .orderBy(desc(memoryVersions.version));

    return results.map((row) => ({
      id: row.id,
      entryId: row.entryId,
      version: row.version,
      value: JSON.parse(row.value),
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      changeDescription: row.changeDescription || undefined,
    }));
  }

  async getVersion(env: HadesBindings, versionId: string): Promise<MemoryVersion | null> {
    const db = createDb(env.HADES_DB);

    const results = await db
      .select()
      .from(memoryVersions)
      .where(eq(memoryVersions.id, versionId))
      .limit(1);

    if (results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      id: row.id,
      entryId: row.entryId,
      version: row.version,
      value: JSON.parse(row.value),
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      changeDescription: row.changeDescription || undefined,
    };
  }

  async getVersionByNumber(env: HadesBindings, entryId: string, version: number): Promise<MemoryVersion | null> {
    const db = createDb(env.HADES_DB);

    const results = await db
      .select()
      .from(memoryVersions)
      .where(eq(memoryVersions.entryId, entryId))
      .orderBy(desc(memoryVersions.version));

    const match = results.find((r) => r.version === version);
    if (!match) return null;

    return {
      id: match.id,
      entryId: match.entryId,
      version: match.version,
      value: JSON.parse(match.value),
      createdAt: match.createdAt,
      createdBy: match.createdBy,
      changeDescription: match.changeDescription || undefined,
    };
  }

  // ============================================
  // Rollback
  // ============================================

  async rollbackToVersion(
    env: HadesBindings,
    entryId: string,
    targetVersion: number,
    initiatedBy: string = "system"
  ): Promise<MemoryEntry | null> {
    const db = createDb(env.HADES_DB);

    // Get the target version
    const version = await this.getVersionByNumber(env, entryId, targetVersion);
    if (!version) {
      throw new Error(`Version ${targetVersion} not found for entry ${entryId}`);
    }

    // Get current entry
    const entryResult = await db
      .select()
      .from(memoryEntries)
      .where(eq(memoryEntries.id, entryId))
      .limit(1);

    if (entryResult.length === 0) {
      return null;
    }

    const entry = entryResult[0];
    const now = new Date().toISOString();

    // Create a version of current state before rollback
    await this.createVersion(
      env,
      entryId,
      JSON.parse(entry.value),
      initiatedBy,
      `Pre-rollback backup before rolling back to v${targetVersion}`
    );

    // Update entry to target version
    const newVersion = entry.version + 1;
    await db
      .update(memoryEntries)
      .set({
        value: JSON.stringify(version.value),
        version: newVersion,
        updatedAt: now,
      })
      .where(eq(memoryEntries.id, entryId));

    // Create version record for the rollback
    await this.createVersion(
      env,
      entryId,
      version.value,
      initiatedBy,
      `Rolled back to version ${targetVersion}`
    );

    logger.info(`Rollback completed: ${entry.key} → v${targetVersion} (now v${newVersion})`);

    return {
      id: entry.id,
      key: entry.key,
      value: version.value,
      category: entry.category,
      tags: JSON.parse(entry.tags),
      version: newVersion,
      createdAt: entry.createdAt,
      updatedAt: now,
      expiresAt: entry.expiresAt || undefined,
      accessCount: entry.accessCount,
    };
  }

  // ============================================
  // Diff
  // ============================================

  async compareVersions(
    env: HadesBindings,
    entryId: string,
    version1: number,
    version2: number
  ): Promise<VersionComparison> {
    const [v1, v2] = await Promise.all([
      this.getVersionByNumber(env, entryId, version1),
      this.getVersionByNumber(env, entryId, version2),
    ]);

    if (!v1 || !v2) {
      throw new Error("One or both versions not found");
    }

    const diffs = this.computeDiff(v1.value, v2.value);

    return {
      version1,
      version2,
      diffs,
    };
  }

  private computeDiff(oldValue: unknown, newValue: unknown, path: string = ""): VersionDiff[] {
    const diffs: VersionDiff[] = [];

    if (typeof oldValue !== typeof newValue) {
      diffs.push({ field: path || "value", oldValue, newValue });
      return diffs;
    }

    if (typeof oldValue !== "object" || oldValue === null || newValue === null) {
      if (oldValue !== newValue) {
        diffs.push({ field: path || "value", oldValue, newValue });
      }
      return diffs;
    }

    const oldObj = oldValue as Record<string, unknown>;
    const newObj = newValue as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

    for (const key of allKeys) {
      const newPath = path ? `${path}.${key}` : key;

      if (!(key in oldObj)) {
        diffs.push({ field: newPath, oldValue: undefined, newValue: newObj[key] });
      } else if (!(key in newObj)) {
        diffs.push({ field: newPath, oldValue: oldObj[key], newValue: undefined });
      } else {
        const nestedDiffs = this.computeDiff(oldObj[key], newObj[key], newPath);
        diffs.push(...nestedDiffs);
      }
    }

    return diffs;
  }

  // ============================================
  // Cleanup
  // ============================================

  private async cleanupOldVersions(env: HadesBindings, entryId: string): Promise<void> {
    const db = createDb(env.HADES_DB);

    const versions = await db
      .select()
      .from(memoryVersions)
      .where(eq(memoryVersions.entryId, entryId))
      .orderBy(desc(memoryVersions.version));

    if (versions.length > this.maxVersions) {
      const toDelete = versions.slice(this.maxVersions);
      for (const version of toDelete) {
        await db.delete(memoryVersions).where(eq(memoryVersions.id, version.id));
      }
      logger.info(`Cleaned up ${toDelete.length} old versions for entry ${entryId}`);
    }
  }

  async deleteVersion(env: HadesBindings, versionId: string): Promise<boolean> {
    const db = createDb(env.HADES_DB);

    const version = await this.getVersion(env, versionId);
    if (!version) return false;

    await db.delete(memoryVersions).where(eq(memoryVersions.id, versionId));
    logger.info(`Version deleted: ${versionId}`);
    return true;
  }

  // ============================================
  // Statistics
  // ============================================

  async getStats(env: HadesBindings): Promise<{
    totalVersions: number;
    averageVersionsPerEntry: number;
    oldestVersion: string | null;
    newestVersion: string | null;
  }> {
    const db = createDb(env.HADES_DB);
    const allVersions = await db.select().from(memoryVersions);

    if (allVersions.length === 0) {
      return {
        totalVersions: 0,
        averageVersionsPerEntry: 0,
        oldestVersion: null,
        newestVersion: null,
      };
    }

    const sorted = allVersions.sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const uniqueEntries = new Set(allVersions.map((v) => v.entryId));

    return {
      totalVersions: allVersions.length,
      averageVersionsPerEntry: allVersions.length / uniqueEntries.size,
      oldestVersion: sorted[0].createdAt,
      newestVersion: sorted[sorted.length - 1].createdAt,
    };
  }
}

export const memoryVersioning = new MemoryVersioningService();
