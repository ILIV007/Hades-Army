/**
 * Integration Tests: Memory Sync - Cloudflare Workers Edition
 * Hades Army v0.9.2
 *
 * Priority 10: Testing — Memory Tests (KV ↔ D1 ↔ .hades)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemorySyncEngine } from "../../src/memory/memory-sync.service";
import { MemoryInspector } from "../../src/memory/memory-inspector";
import type { HadesBindings } from "../../src/types";

function makeMockEnv(): HadesBindings {
  const kvStore = new Map<string, string>();
  const kvNamespace: KVNamespace = {
    get(key: string) { return Promise.resolve(kvStore.get(key) ?? null); },
    getWithMetadata(key: string) {
      return Promise.resolve({ value: kvStore.get(key) ?? null, metadata: null });
    },
    list(opts?: { prefix?: string; limit?: number; cursor?: string }) {
      const prefix = opts?.prefix ?? "";
      const keys = Array.from(kvStore.keys())
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name, metadata: null }));
      return Promise.resolve({ keys, list_complete: true, cursor: "" });
    },
    put(key: string, value: string) { kvStore.set(key, value); return Promise.resolve(undefined); },
    delete(key: string) { kvStore.delete(key); return Promise.resolve(undefined); },
  } as unknown as KVNamespace;

  // Mock D1
  const tables: Record<string, Array<Record<string, unknown>>> = {
    cost_records: [],
    agent_metrics_daily: [],
    agent_messages: [],
    audit_log: [],
    workflows: [],
    github_audit_log: [],
    connected_repositories: [],
    conversation_states: [],
  };
  const d1: D1Database = {
    prepare(sql: string) {
      const trimmed = sql.trim().toUpperCase();
      return {
        bind(...values: unknown[]) {
          return {
            run: async () => {
              if (trimmed.startsWith("INSERT OR REPLACE INTO COST_RECORDS")) {
                tables.cost_records.push({
                  id: values[0] as string,
                  workflow_id: values[1],
                  agent_role: values[2],
                  provider: values[3],
                  model: values[4],
                  input_tokens: values[5],
                  output_tokens: values[6],
                  cost_usd: values[7],
                  recorded_at: values[8],
                });
              } else if (trimmed.startsWith("INSERT OR REPLACE INTO AGENT_METRICS_DAILY")) {
                tables.agent_metrics_daily.push({
                  day: values[0],
                  agent_role: values[1],
                  counter_name: values[2],
                  counter_value: values[3],
                });
              } else if (trimmed.startsWith("INSERT OR REPLACE INTO REPOSITORY_MEMORY_SNAPSHOTS")) {
                // OK
              }
              return { success: true, meta: { changes: 1 } };
            },
            first: async <T = unknown>(): Promise<T | null> => {
              if (trimmed.startsWith("SELECT COUNT(*)")) {
                if (trimmed.includes("FROM AGENT_MESSAGES")) return { count: tables.agent_messages.length } as unknown as T;
                if (trimmed.includes("FROM AUDIT_LOG")) return { count: tables.audit_log.length } as unknown as T;
                return { count: 0 } as unknown as T;
              }
              return null;
            },
            all: async () => {
              if (trimmed.startsWith("SELECT * FROM AGENT_MESSAGES")) {
                return { results: tables.agent_messages, success: true, meta: { changes: 0 } };
              }
              if (trimmed.startsWith("SELECT * FROM AUDIT_LOG")) {
                return { results: tables.audit_log, success: true, meta: { changes: 0 } };
              }
              if (trimmed.startsWith("SELECT * FROM COST_RECORDS")) {
                return { results: tables.cost_records, success: true, meta: { changes: 0 } };
              }
              if (trimmed.startsWith("SELECT NAME FROM SQLITE_MASTER")) {
                return { results: [{ name: "agent_messages" }, { name: "audit_log" }], success: true, meta: { changes: 0 } };
              }
              return { results: [], success: true, meta: { changes: 0 } };
            },
          };
        },
        run: async () => ({ success: true, meta: { changes: 0 } }),
        first: async <T = unknown>(): Promise<T | null> => null,
        all: async () => ({ results: [], success: true, meta: { changes: 0 } }),
      };
    },
    batch: async (statements: D1PreparedStatement[]) => {
      for (const s of statements) {
        await s.run();
      }
      return [];
    },
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database;

  return {
    HADES_DB: d1,
    HADES_KV: kvNamespace,
    AI: {} as unknown as Ai,
    GOOGLE_AI_API_KEY: "test-google",
    OPENROUTER_API_KEY: "test-or",
    GITHUB_TOKEN: "test-gh",
    TELEGRAM_BOT_TOKEN: "test-tg",
    ADMIN_API_TOKEN: "test-admin",
    JWT_SECRET: "test-jwt-secret-with-32-characters-min",
    ENCRYPTION_KEY: "test-encryption-key-with-32-characters",
  } as HadesBindings;
}

describe("Memory Sync Integration", () => {
  let env: HadesBindings;
  let sync: MemorySyncEngine;

  beforeEach(() => {
    env = makeMockEnv();
    sync = new MemorySyncEngine(env);
  });

  describe("KV → D1 sync", () => {
    it("should flush cost records from KV to D1", async () => {
      // Seed KV with cost records
      await env.HADES_KV!.put("cost-tracker:log", JSON.stringify([
        {
          id: "cost-1",
          workflowId: "wf-1",
          agentRole: "manager",
          provider: "google",
          model: "gemini-3-flash",
          inputTokens: 1000,
          outputTokens: 500,
          costUsd: 0,
          recordedAt: new Date().toISOString(),
        },
      ]));

      const result = await sync.syncKvToD1();
      expect(result.ok).toBe(true);
      expect(result.processed).toBeGreaterThan(0);
    });

    it("should handle empty KV gracefully", async () => {
      const result = await sync.syncKvToD1();
      expect(result.ok).toBe(true);
      expect(result.processed).toBe(0);
    });
  });

  describe("Health report", () => {
    it("should report KV, D1, and repo memory availability", async () => {
      const health = await sync.getHealth();
      expect(health).toHaveProperty("kvAvailable");
      expect(health).toHaveProperty("d1Available");
      expect(health).toHaveProperty("repoMemoryAvailable");
    });
  });
});

describe("Memory Inspector Integration", () => {
  let env: HadesBindings;
  let inspector: MemoryInspector;

  beforeEach(() => {
    env = makeMockEnv();
    inspector = new MemoryInspector(env);
  });

  describe("inspect", () => {
    it("should inspect all three memory layers", async () => {
      const result = await inspector.inspect("test-project");
      expect(result.layers).toHaveLength(3);
      expect(result.layers.map((l) => l.layer)).toEqual(["repository", "d1", "kv"]);
    });

    it("should report missing required .hades/ paths", async () => {
      const result = await inspector.inspect("empty-project");
      expect(result.missingPaths.length).toBeGreaterThan(0);
      expect(result.existingPaths.length).toBe(0);
    });

    it("should report existing .hades/ paths", async () => {
      // Seed KV with project.json
      await env.HADES_KV!.put(
        "repo-memory:test-project:.hades/project.json",
        JSON.stringify({ projectId: "test-project", status: "active" }),
      );

      const result = await inspector.inspect("test-project");
      expect(result.existingPaths).toContain(".hades/project.json");
      expect(result.missingPaths).not.toContain(".hades/project.json");
    });

    it("should compute total bytes across all layers", async () => {
      const result = await inspector.inspect("test-project");
      expect(result.totalBytes).toBeGreaterThanOrEqual(0);
      expect(result.totalItems).toBeGreaterThanOrEqual(0);
    });
  });

  describe("computeHealthScore", () => {
    it("should return unhealthy when repo memory is missing", async () => {
      const score = await inspector.computeHealthScore("empty-project");
      expect(score.projectMemory).toBe("missing");
      expect(score.overall).toBe("unhealthy");
    });

    it("should return healthy when all required paths exist", async () => {
      // Seed all required paths
      const requiredPaths = [
        ".hades/project.json",
        ".hades/architecture.json",
        ".hades/roadmap.json",
        ".hades/decisions.json",
        ".hades/metrics/metrics.json",
      ];
      for (const path of requiredPaths) {
        await env.HADES_KV!.put(
          `repo-memory:healthy-project:${path}`,
          JSON.stringify({ items: [], updatedAt: new Date().toISOString() }),
        );
      }

      const score = await inspector.computeHealthScore("healthy-project");
      expect(score.projectMemory).toBe("healthy");
      expect(score.contextCoverage).toBeGreaterThan(50);
    });
  });
});
