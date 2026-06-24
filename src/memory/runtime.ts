
/**
 * Runtime Memory - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * In-memory runtime cache for fast access:
 * - Per-request caching
 * - Agent state caching
 * - Session management
 * - Temporary data storage
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";

// ============================================
// Types
// ============================================

export interface RuntimeEntry<T = unknown> {
  key: string;
  value: T;
  createdAt: number;
  expiresAt?: number;
  tags: string[];
  accessCount: number;
}

export interface RuntimeStats {
  totalEntries: number;
  totalSize: number;
  oldestEntry: number;
  newestEntry: number;
  byTag: Record<string, number>;
}

// ============================================
// Runtime Memory
// ============================================

export class RuntimeMemory {
  private cache: Map<string, RuntimeEntry> = new Map();
  private maxSize: number = 1000;
  private defaultTtl: number = 5 * 60 * 1000; // 5 minutes

  constructor(options?: { maxSize?: number; defaultTtl?: number }) {
    if (options?.maxSize) this.maxSize = options.maxSize;
    if (options?.defaultTtl) this.defaultTtl = options.defaultTtl;
  }

  // ============================================
  // CRUD Operations
  // ============================================

  set<T>(key: string, value: T, options?: { ttl?: number; tags?: string[] }): void {
    const now = Date.now();
    const entry: RuntimeEntry<T> = {
      key,
      value,
      createdAt: now,
      expiresAt: options?.ttl ? now + options.ttl : now + this.defaultTtl,
      tags: options?.tags || [],
      accessCount: 0,
    };

    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    this.cache.set(key, entry as RuntimeEntry);
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Update access count
    entry.accessCount++;

    return entry.value as T;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    logger.info("Runtime memory cleared");
  }

  // ============================================
  // Batch Operations
  // ============================================

  mget<T>(keys: string[]): Record<string, T | null> {
    const result: Record<string, T | null> = {};
    for (const key of keys) {
      result[key] = this.get<T>(key);
    }
    return result;
  }

  mset<T>(entries: Record<string, T>, options?: { ttl?: number; tags?: string[] }): void {
    for (const [key, value] of Object.entries(entries)) {
      this.set(key, value, options);
    }
  }

  mdelete(keys: string[]): number {
    let deleted = 0;
    for (const key of keys) {
      if (this.delete(key)) deleted++;
    }
    return deleted;
  }

  // ============================================
  // Tag Operations
  // ============================================

  getByTag<T>(tag: string): Array<{ key: string; value: T }> {
    const results: Array<{ key: string; value: T }> = [];

    for (const [key, entry] of this.cache) {
      if (entry.tags.includes(tag) && (!entry.expiresAt || Date.now() <= entry.expiresAt)) {
        results.push({ key, value: entry.value as T });
      }
    }

    return results;
  }

  deleteByTag(tag: string): number {
    let deleted = 0;

    for (const [key, entry] of this.cache) {
      if (entry.tags.includes(tag)) {
        this.cache.delete(key);
        deleted++;
      }
    }

    return deleted;
  }

  // ============================================
  // Pattern Matching
  // ============================================

  keys(pattern?: string): string[] {
    const keys = Array.from(this.cache.keys());

    if (!pattern) {
      return keys;
    }

    // Simple glob matching
    const regex = new RegExp(pattern.replace(/\*/g, ".*").replace(/\?/g, "."));
    return keys.filter((k) => regex.test(k));
  }

  find<T>(predicate: (entry: RuntimeEntry<T>) => boolean): Array<{ key: string; value: T }> {
    const results: Array<{ key: string; value: T }> = [];

    for (const [key, entry] of this.cache) {
      if (predicate(entry as RuntimeEntry<T>)) {
        results.push({ key, value: entry.value as T });
      }
    }

    return results;
  }

  // ============================================
  // Expiration
  // ============================================

  ttl(key: string): number {
    const entry = this.cache.get(key);
    if (!entry || !entry.expiresAt) return -1;

    const remaining = entry.expiresAt - Date.now();
    return remaining > 0 ? remaining : -2; // -2 means expired
  }

  expire(key: string, ttl: number): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    entry.expiresAt = Date.now() + ttl;
    return true;
  }

  persist(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    entry.expiresAt = undefined;
    return true;
  }

  // ============================================
  // Cleanup
  // ============================================

  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug(`Runtime memory cleanup: ${removed} expired entries removed`);
    }

    return removed;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      logger.debug(`Evicted oldest entry: ${oldestKey}`);
    }
  }

  // ============================================
  // Statistics
  // ============================================

  getStats(): RuntimeStats {
    let totalSize = 0;
    let oldestEntry = Infinity;
    let newestEntry = 0;
    const byTag: Record<string, number> = {};

    for (const entry of this.cache.values()) {
      totalSize += JSON.stringify(entry.value).length;
      oldestEntry = Math.min(oldestEntry, entry.createdAt);
      newestEntry = Math.max(newestEntry, entry.createdAt);

      for (const tag of entry.tags) {
        byTag[tag] = (byTag[tag] || 0) + 1;
      }
    }

    return {
      totalEntries: this.cache.size,
      totalSize,
      oldestEntry: oldestEntry === Infinity ? 0 : oldestEntry,
      newestEntry,
      byTag,
    };
  }

  // ============================================
  // Serialization
  // ============================================

  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of this.cache) {
      result[key] = {
        value: entry.value,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        tags: entry.tags,
        accessCount: entry.accessCount,
      };
    }
    return result;
  }

  fromJSON(data: Record<string, unknown>): void {
    this.cache.clear();
    for (const [key, entry] of Object.entries(data)) {
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        this.cache.set(key, {
          key,
          value: e.value,
          createdAt: (e.createdAt as number) || Date.now(),
          expiresAt: e.expiresAt as number | undefined,
          tags: (e.tags as string[]) || [],
          accessCount: (e.accessCount as number) || 0,
        });
      }
    }
  }
}

// Global runtime memory instance
export const runtimeMemory = new RuntimeMemory();
