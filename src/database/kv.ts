/**
 * KV Cache Wrapper - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { logger } from "../utils/logger";

export class KVCache {
  constructor(private kv: KVNamespace) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.kv.get(key, "json");
      return value as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      await this.kv.put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
    } catch (err) {
      logger.warn(`KV set failed: ${key}`, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  async list(prefix?: string): Promise<string[]> {
    const result = await this.kv.list(prefix ? { prefix } : undefined);
    return result.keys.map((k) => k.name);
  }
}
