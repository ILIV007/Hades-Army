
/**
 * Memory API Routes - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, like } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { ValidationError, NotFoundError } from "../../utils/errors";
import { memoryManager } from "../../memory/manager";
import { memoryEntries, memoryVersions } from "../../database/schema";
import { createDb } from "../../database/client";
import type { HadesContext } from "../../types";

// ============================================
// Validation Schemas
// ============================================

const createMemorySchema = z.object({
  key: z.string().min(1).max(200),
  value: z.unknown(),
  category: z.string().min(1).max(100).optional(),
  tags: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
});

const updateMemorySchema = z.object({
  value: z.unknown().optional(),
  category: z.string().min(1).max(100).optional(),
  tags: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
});

// ============================================
// Router
// ============================================

export const memoryRouter = new Hono<HadesContext>();

// GET /api/v1/memory - List all memory entries
memoryRouter.get("/", async (c) => {
  const db = createDb(c.env.HADES_DB);
  const category = c.req.query("category");
  const search = c.req.query("search");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  let query = db
    .select()
    .from(memoryEntries)
    .orderBy(desc(memoryEntries.updatedAt))
    .limit(limit)
    .offset(offset);

  const entries = await query;

  return c.json({
    success: true,
    data: entries.map((e) => ({
      ...e,
      tags: JSON.parse(e.tags),
      value: JSON.parse(e.value),
    })),
    pagination: { limit, offset, total: entries.length },
  });
});

// POST /api/v1/memory - Create a new memory entry
memoryRouter.post("/", async (c) => {
  const body = await c.req.json();
  const validated = createMemorySchema.safeParse(body);

  if (!validated.success) {
    throw new ValidationError("Invalid memory data", validated.error.format());
  }

  const entry = await memoryManager.createEntry({
    key: validated.data.key,
    value: validated.data.value,
    category: validated.data.category || "general",
    tags: validated.data.tags || [],
    expiresAt: validated.data.expiresAt,
  });

  logger.info(`Memory entry created via API: ${entry.key}`);

  return c.json(
    {
      success: true,
      data: entry,
      message: `Memory entry "${entry.key}" created`,
    },
    201
  );
});

// GET /api/v1/memory/:key - Get memory entry by key
memoryRouter.get("/:key", async (c) => {
  const key = c.req.param("key");
  const entry = await memoryManager.getEntry(key);

  if (!entry) {
    throw new NotFoundError(`Memory entry with key "${key}" not found`);
  }

  return c.json({
    success: true,
    data: entry,
  });
});

// PATCH /api/v1/memory/:key - Update memory entry
memoryRouter.patch("/:key", async (c) => {
  const key = c.req.param("key");
  const body = await c.req.json();
  const validated = updateMemorySchema.safeParse(body);

  if (!validated.success) {
    throw new ValidationError("Invalid update data", validated.error.format());
  }

  const entry = await memoryManager.updateEntry(key, {
    value: validated.data.value,
    category: validated.data.category,
    tags: validated.data.tags,
    expiresAt: validated.data.expiresAt,
  });

  if (!entry) {
    throw new NotFoundError(`Memory entry with key "${key}" not found`);
  }

  logger.info(`Memory entry updated via API: ${key}`);

  return c.json({
    success: true,
    data: entry,
    message: `Memory entry "${key}" updated`,
  });
});

// DELETE /api/v1/memory/:key - Delete memory entry
memoryRouter.delete("/:key", async (c) => {
  const key = c.req.param("key");
  const deleted = await memoryManager.deleteEntry(key);

  if (!deleted) {
    throw new NotFoundError(`Memory entry with key "${key}" not found`);
  }

  logger.info(`Memory entry deleted via API: ${key}`);

  return c.json({
    success: true,
    message: `Memory entry "${key}" deleted`,
  });
});

// GET /api/v1/memory/:key/versions - Get versions of a memory entry
memoryRouter.get("/:key/versions", async (c) => {
  const key = c.req.param("key");
  const versions = await memoryManager.getVersions(key);

  return c.json({
    success: true,
    data: versions,
    count: versions.length,
  });
});

// POST /api/v1/memory/:key/restore - Restore memory entry to a version
memoryRouter.post("/:key/restore", async (c) => {
  const key = c.req.param("key");
  const body = await c.req.json();
  const version = body.version;

  if (typeof version !== "number") {
    throw new ValidationError("Version number is required");
  }

  const entry = await memoryManager.restoreVersion(key, version);

  if (!entry) {
    throw new NotFoundError(`Memory entry or version not found`);
  }

  logger.info(`Memory entry restored via API: ${key} to version ${version}`);

  return c.json({
    success: true,
    data: entry,
    message: `Memory entry "${key}" restored to version ${version}`,
  });
});

// GET /api/v1/memory/stats/overview - Get memory statistics
memoryRouter.get("/stats/overview", async (c) => {
  const stats = await memoryManager.getStats();

  return c.json({
    success: true,
    data: stats,
  });
});
