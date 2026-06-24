
/**
 * Test Setup - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Vitest configuration and test utilities
 * for Cloudflare Workers environment.
 */

import { vi } from "vitest";

// ============================================
// Mock Cloudflare Bindings
// ============================================

export interface MockBindings {
  HADES_KV: KVNamespace;
  HADES_DB: D1Database;
  AI: Ai;
  HADES_R2: R2Bucket;
  TELEGRAM_BOT_TOKEN?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GITHUB_TOKEN?: string;
  ADMIN_API_TOKEN?: string;
  API_KEYS?: string;
}

// ============================================
// Mock D1 Database
// ============================================

class MockD1Database implements D1Database {
  private data: Map<string, Array<Record<string, unknown>>> = new Map();

  async prepare(query: string): Promise<D1PreparedStatement> {
    return new MockD1PreparedStatement(query, this.data);
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return [];
  }

  async exec(query: string): Promise<D1ExecResult> {
    return { count: 0, duration: 0 };
  }
}

class MockD1PreparedStatement implements D1PreparedStatement {
  constructor(
    private query: string,
    private data: Map<string, Array<Record<string, unknown>>>
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return this;
  }

  first<T>(colName?: string): Promise<T | null> {
    return Promise.resolve(null);
  }

  run<T>(): Promise<D1Result<T>> {
    return Promise.resolve({ results: [], success: true, meta: { duration: 0 } });
  }

  all<T>(): Promise<D1Result<T>> {
    return Promise.resolve({ results: [], success: true, meta: { duration: 0 } });
  }

  raw<T>(): Promise<T[]> {
    return Promise.resolve([]);
  }
}

// ============================================
// Mock KV Namespace
// ============================================

class MockKVNamespace implements KVNamespace {
  private store: Map<string, { value: string; expiration?: number }> = new Map();

  async get(key: string, options?: { cacheTtl?: number; type?: "text" | "json" | "arrayBuffer" | "stream" }): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiration && Date.now() > entry.expiration) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async getWithMetadata<T>(key: string, options?: { cacheTtl?: number; type?: "text" | "json" | "arrayBuffer" | "stream" }): Promise<{ value: string | null; metadata: T | null; cacheStatus: string | null }> {
    const value = await this.get(key, options);
    return { value, metadata: null, cacheStatus: null };
  }

  async put(key: string, value: string | ReadableStream | ArrayBuffer, options?: { expiration?: number; expirationTtl?: number; metadata?: unknown }): Promise<void> {
    const expiration = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : undefined;
    this.store.set(key, { value: value as string, expiration });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: Array<{ name: string; expiration?: number; metadata?: unknown }>; list_complete: boolean; cursor: string }> {
    const keys: Array<{ name: string; expiration?: number; metadata?: unknown }> = [];
    for (const [key, entry] of this.store) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        keys.push({ name: key, expiration: entry.expiration });
      }
    }
    return { keys: keys.slice(0, options?.limit || 1000), list_complete: true, cursor: "" };
  }
}

// ============================================
// Mock R2 Bucket
// ============================================

class MockR2Bucket implements R2Bucket {
  private objects: Map<string, { value: ArrayBuffer; metadata?: Record<string, string> }> = new Map();

  async head(key: string): Promise<R2Object | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return {
      key,
      size: obj.value.byteLength,
      etag: "mock-etag",
      httpEtag: '"mock-etag"',
      httpMetadata: {},
      customMetadata: obj.metadata || {},
      range: undefined,
      checksums: {},
      uploaded: new Date(),
      version: "1",
    } as R2Object;
  }

  async get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return {
      key,
      size: obj.value.byteLength,
      etag: "mock-etag",
      httpEtag: '"mock-etag"',
      httpMetadata: {},
      customMetadata: obj.metadata || {},
      range: undefined,
      checksums: {},
      uploaded: new Date(),
      version: "1",
      body: new ReadableStream(),
      bodyUsed: false,
      arrayBuffer: () => Promise.resolve(obj.value),
      text: () => Promise.resolve(new TextDecoder().decode(obj.value)),
      json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(obj.value))),
      blob: () => Promise.resolve(new Blob([obj.value])),
      writeHttpMetadata: () => {},
    } as R2ObjectBody;
  }

  async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null, options?: R2PutOptions): Promise<R2Object> {
    let buffer: ArrayBuffer;
    if (typeof value === "string") {
      buffer = new TextEncoder().encode(value).buffer;
    } else if (value instanceof ArrayBuffer) {
      buffer = value;
    } else {
      buffer = new ArrayBuffer(0);
    }
    this.objects.set(key, { value: buffer, metadata: options?.customMetadata });
    return (await this.head(key))!;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const keys: R2Object[] = [];
    for (const [key, obj] of this.objects) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        keys.push((await this.head(key))!);
      }
    }
    return { objects: keys, truncated: false, cursor: "" };
  }
}

// ============================================
// Mock AI
// ============================================

class MockAI implements Ai {
  async run(model: string, inputs: Record<string, unknown>): Promise<unknown> {
    return { response: "Mock AI response" };
  }
}

// ============================================
// Test Environment Factory
// ============================================

export function createMockEnv(): MockBindings {
  return {
    HADES_KV: new MockKVNamespace(),
    HADES_DB: new MockD1Database(),
    AI: new MockAI(),
    HADES_R2: new MockR2Bucket(),
    TELEGRAM_BOT_TOKEN: "mock-telegram-token",
    OPENAI_API_KEY: "mock-openai-key",
    ANTHROPIC_API_KEY: "mock-anthropic-key",
    GITHUB_TOKEN: "mock-github-token",
    ADMIN_API_TOKEN: "mock-admin-token",
    API_KEYS: "mock-api-key-1,mock-api-key-2",
  };
}

// ============================================
// Test Helpers
// ============================================

export function createMockRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Request {
  const url = new URL(path, "https://hades-army.test");
  const init: RequestInit = {
    method: options.method || "GET",
    headers: options.headers || {},
  };

  if (options.body) {
    init.body = JSON.stringify(options.body);
    init.headers = {
      ...init.headers,
      "Content-Type": "application/json",
    };
  }

  return new Request(url.toString(), init);
}

export async function createMockExecutionContext(): Promise<ExecutionContext> {
  return {
    waitUntil: (promise: Promise<unknown>) => promise,
    passThroughOnException: () => {},
  };
}

// ============================================
// Global Test Setup
// ============================================

beforeAll(() => {
  // Setup global test environment
  vi.stubGlobal("crypto", {
    getRandomValues: (array: Uint8Array) => {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    },
    subtle: {
      digest: async (algorithm: string, data: ArrayBuffer) => {
        // Simple mock digest
        return new ArrayBuffer(32);
      },
    },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  // Reset state before each test
});

afterEach(() => {
  vi.clearAllMocks();
});

export { vi };
