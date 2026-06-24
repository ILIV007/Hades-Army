
/**
 * Memory Manager - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Persistent memory management:
 * - Key-value storage in D1
 * - Caching in KV
 * - TTL support
 * - Category-based organization
 * - Tag-based filtering
 */

import { eq, desc, like, and } from "drizzle-orm";
import { logger } from "../utils/logger";
import { generateId, deepClone } from "../utils/helpers";
import { memoryEntries } from "../database/schema";
import { createDb } from "../database/client";
import { KVCache } from "../database/kv";
import type { HadesBindings, MemoryEntry } from "../types";

// ============================================
// Types
// ============================================

export interface CreateMemoryEntry {
  key: string;
  value: unknown;
  category?: string;
  tags?: string[];
  expiresAt?: string;
}

export interface UpdateMemoryEntry {
  value?: unknown;
  category?: string;
  tags?: string[];
  expiresAt?: string;
}

export interface MemoryQuery {
  category?: string;
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryStats {
  totalEntries: number;
  totalCategories: number;
  totalTags: number;
  expiredEntries: number;
  byCategory: Record<string, number>;
  byTag: Record<string, number>;
}

// ============================================
// Memory Manager
// ============================================

export class MemoryManager {
  private cacheTtl: number = 300; // 5 minutes

  // ============================================
  // CRUD Operations
  // ============================================

  async createEntry(env: HadesBindings, params: CreateMemoryEntry): Promise<MemoryEntry> {
    const db = createDb(env.HADES_DB);
    const id = generateId("mem");
    const now = new Date().toISOString();

    // Check if key already exists
    const existing = await db
      .select()
      .from(memoryEntries)
      .where(eq(memoryEntries.key, params.key))
      .limit(1);

    if (existing.length > 0) {
      throw new Error(`Memory entry with key "${params.key}" already exists`);
    }

    const entry: MemoryEntry = {
      id,
      key: params.key,
      value: params.value,
      category: params.category || "general",
      tags: params.tags || [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      expiresAt: params.expiresAt,
      accessCount: 0,
    };

    await db.insert(memoryEntries).values({
      id: entry.id,
      key: entry.key,
      value: JSON.stringify(entry.value),
      category: entry.category,
      tags: JSON.stringify(entry.tags),
      version: entry.version,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      expiresAt: entry.expiresAt,
      accessCount: entry.accessCount,
    });

    // Cache in KV
    await this.cacheEntry(env, entry);

    logger.info(`Memory entry created: ${entry.key} (${entry.category})`);
    return entry;
  }

  async getEntry(env: HadesBindings, key: string): Promise<MemoryEntry | null> {
    // Try cache first
    const cached = await this.getCachedEntry(env, key);
    if (cached) {
      // Update access count in background
      this.incrementAccessCount(env, key).catch(() => {});
      return cached;
    }

    // Fetch from database
    const db = createDb(env.HADES_DB);
    const result = await db
      .select()
      .from(memoryEntries)
      .where(eq(memoryEntries.key, key))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const row = result[0];

    // Check expiration
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      logger.info(`Memory entry expired: ${key}`);
      return null;
    }

    const entry: MemoryEntry = {
      id: row.id,
      key: row.key,
      value: JSON.parse(row.value),
      category: row.category,
      tags: JSON.parse(row.tags),
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt || undefined,
      accessCount: row.accessCount + 1,
    };

    // Update access count
    await db
      .update(memoryEntries)
      .set({ accessCount: entry.accessCount })
      .where(eq(memoryEntries.id, row.id));

    // Cache the result
    await this.cacheEntry(env, entry);

    return entry;
  }

  async updateEntry(
    env: HadesBindings,
    key: string,
    updates: UpdateMemoryEntry
  ): Promise<MemoryEntry | null> {
    const db = createDb(env.HADES_DB);

    const result = await db
      .select()
      .from(memoryEntries)
      .where(eq(memoryEntries.key, key))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    const now = new Date().toISOString();

    // Create version record before updating
    // (Versioning is handled by the versioning service)

    const updatedEntry: MemoryEntry = {
      id: row.id,
      key: row.key,
      value: updates.value !== undefined ? updates.value : JSON.parse(row.value),
      category: updates.category || row.category,
      tags: updates.tags ? updates.tags : JSON.parse(row.tags),
      version: row.version + 1,
      createdAt: row.createdAt,
      updatedAt: now,
      expiresAt: updates.expiresAt || row.expiresAt || undefined,
      accessCount: row.accessCount,
    };

    await db
      .update(memoryEntries)
      .set({
        value: JSON.stringify(updatedEntry.value),
        category: updatedEntry.category,
        tags: JSON.stringify(updatedEntry.tags),
        version: updatedEntry.version,
        updatedAt: updatedEntry.updatedAt,
        expiresAt: updatedEntry.expiresAt,
      })
      .where(eq(memoryEntries.id, row.id));

    // Update cache
    await this.cacheEntry(env, updatedEntry);

    logger.info(`Memory entry updated: ${key} (v${updatedEntry.version})`);
    return updatedEntry;
  }

  async deleteEntry(env: HadesBindings, key: string): Promise<boolean> {
    const db = createDb(env.HADES_DB);

    const result = await db
      .select()
      .from(memoryEntries)
      .where(eq(memoryEntries.key, key))
      .limit(1);

    if (result.length === 0) {
      return false;
    }

    await db.delete(memoryEntries).where(eq(memoryEntries.id, result[0].id));

    // Remove from cache
    await this.removeCachedEntry(env, key);

    logger.info(`Memory entry deleted: ${key}`);
    return true;
  }

  // ============================================
  // Querying
  // ============================================

  async listEntries(env: HadesBindings, query: MemoryQuery = {}): Promise<MemoryEntry[]> {
    const db = createDb(env.HADES_DB);
    const limit = query.limit || 50;
    const offset = query.offset || 0;

    let dbQuery = db
      .select()
      .from(memoryEntries)
      .orderBy(desc(memoryEntries.updatedAt))
      .limit(limit)
      .offset(offset);

    // Note: In production, add filtering by category and tags
    const results = await dbQuery;

    return results.map((row) => ({
      id: row.id,
      key: row.key,
      value: JSON.parse(row.value),
      category: row.category,
      tags: JSON.parse(row.tags),
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt || undefined,
      accessCount: row.accessCount,
    }));
  }

  async searchEntries(env: HadesBindings, search: string): Promise<MemoryEntry[]> {
    const db = createDb(env.HADES_DB);

    const results = await db
      .select()
      .from(memoryEntries)
      .where(like(memoryEntries.key, `%${search}%`))
      .limit(50);

    return results.map((row) => ({
      id: row.id,
      key: row.key,
      value: JSON.parse(row.value),
      category: row.category,
      tags: JSON.parse(row.tags),
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt || undefined,
      accessCount: row.accessCount,
    }));
  }

  async getEntriesByCategory(env: HadesBindings, category: string): Promise<MemoryEntry[]> {
    const db = createDb(env.HADES_DB);

    const results = await db
      .select()
      .from(memoryEntries)
      .where(eq(memoryEntries.category, category))
      .orderBy(desc(memoryEntries.updatedAt));

    return results.map((row) => ({
      id: row.id,
      key: row.key,
      value: JSON.parse(row.value),
      category: row.category,
      tags: JSON.parse(row.tags),
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt || undefined,
      accessCount: row.accessCount,
    }));
  }

  // ============================================
  // Caching
  // ============================================

  private async cacheEntry(env: HadesBindings, entry: MemoryEntry): Promise<void> {
    try {
      const kv = new KVCache(env.HADES_KV);
      await kv.set(`memory:${entry.key}`, entry, this.cacheTtl);
    } catch (err) {
      logger.warn(`Failed to cache memory entry: ${entry.key}`);
    }
  }

  private async getCachedEntry(env: HadesBindings, key: string): Promise<MemoryEntry | null> {
    try {
      const kv = new KVCache(env.HADES_KV);
      return await kv.get<MemoryEntry>(`memory:${key}`);
    } catch {
      return null;
    }
  }

  private async removeCachedEntry(env: HadesBindings, key: string): Promise<void> {
    try {
      const kv = new KVCache(env.HADES_KV);
      await kv.delete(`memory:${key}`);
    } catch {
      // Ignore cache removal errors
    }
  }

  private async incrementAccessCount(env: HadesBindings, key: string): Promise<void> {
    try {
      const db = createDb(env.HADES_DB);
      const entry = await db
        .select()
        .from(memoryEntries)
        .where(eq(memoryEntries.key, key))
        .limit(1);

      if (entry.length > 0) {
        await db
          .update(memoryEntries)
          .set({ accessCount: entry[0].accessCount + 1 })
          .where(eq(memoryEntries.id, entry[0].id));
      }
    } catch {
      // Ignore access count update errors
    }
  }

  // ============================================
  // Statistics
  // ============================================

  async getStats(env: HadesBindings): Promise<MemoryStats> {
    const db = createDb(env.HADES_DB);
    const allEntries = await db.select().from(memoryEntries);

    const categories = new Set<string>();
    const tags = new Set<string>();
    const byCategory: Record<string, number> = {};
    const byTag: Record<string, number> = {};
    let expiredEntries = 0;

    const now = new Date();

    for (const entry of allEntries) {
      categories.add(entry.category);
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;

      const entryTags = JSON.parse(entry.tags);
      for (const tag of entryTags) {
        tags.add(tag);
        byTag[tag] = (byTag[tag] || 0) + 1;
      }

      if (entry.expiresAt && new Date(entry.expiresAt) < now) {
        expiredEntries++;
      }
    }

    return {
      totalEntries: allEntries.length,
      totalCategories: categories.size,
      totalTags: tags.size,
      expiredEntries,
      byCategory,
      byTag,
    };
  }

  // ============================================
  // Maintenance
  // ============================================

  async cleanupExpired(env: HadesBindings): Promise<number> {
    const db = createDb(env.HADES_DB);
    const now = new Date().toISOString();

    // In production, use a proper DELETE query
    // For now, just count and log
    const expired = await db
      .select()
      .from(memoryEntries)
      .where(and(eq(memoryEntries.expiresAt, now)));

    logger.info(`Found ${expired.length} expired memory entries`);
    return expired.length;
  }

  async clearCache(env: HadesBindings): Promise<void> {
    try {
      const kv = new KVCache(env.HADES_KV);
      const keys = await kv.list("memory:");
      for (const key of keys) {
        await kv.delete(key);
      }
      logger.info(`Memory cache cleared: ${keys.length} entries removed`);
    } catch (err) {
      logger.error("Failed to clear memory cache", { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

export const memoryManager = new MemoryManager();
