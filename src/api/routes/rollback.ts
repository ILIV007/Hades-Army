
/**
 * Rollback API Routes - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { generateId } from "../../utils/helpers";
import { ValidationError, NotFoundError } from "../../utils/errors";
import { rollbackManager } from "../../rollback/manager";
import { rollbackSnapshots, rollbackOperations } from "../../database/schema";
import { createDb } from "../../database/client";
import type { HadesContext, RollbackType } from "../../types";

// ============================================
// Validation Schemas
// ============================================

const createSnapshotSchema = z.object({
  type: z.enum(["code", "config", "database", "deployment", "agent_state"]),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  data: z.record(z.unknown()),
  tags: z.array(z.string()).optional(),
});

const rollbackSchema = z.object({
  initiatedBy: z.string().min(1),
  reason: z.string().min(1).max(1000),
});

// ============================================
// Router
// ============================================

export const rollbackRouter = new Hono<HadesContext>();

// GET /api/v1/rollback/snapshots - List all snapshots
rollbackRouter.get("/snapshots", async (c) => {
  const db = createDb(c.env.HADES_DB);
  const type = c.req.query("type");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  let query = db
    .select()
    .from(rollbackSnapshots)
    .orderBy(desc(rollbackSnapshots.createdAt))
    .limit(limit)
    .offset(offset);

  const snapshots = await query;

  return c.json({
    success: true,
    data: snapshots.map((s) => ({
      ...s,
      tags: JSON.parse(s.tags),
      data: JSON.parse(s.data),
    })),
    pagination: { limit, offset, total: snapshots.length },
  });
});

// POST /api/v1/rollback/snapshots - Create a new snapshot
rollbackRouter.post("/snapshots", async (c) => {
  const body = await c.req.json();
  const validated = createSnapshotSchema.safeParse(body);

  if (!validated.success) {
    throw new ValidationError("Invalid snapshot data", validated.error.format());
  }

  const snapshot = await rollbackManager.createSnapshot({
    type: validated.data.type as RollbackType,
    name: validated.data.name,
    description: validated.data.description,
    data: validated.data.data,
    tags: validated.data.tags || [],
  });

  logger.info(`Snapshot created via API: ${snapshot.id}`);

  return c.json(
    {
      success: true,
      data: snapshot,
      message: `Snapshot "${snapshot.name}" created`,
    },
    201
  );
});

// GET /api/v1/rollback/snapshots/:id - Get snapshot by ID
rollbackRouter.get("/snapshots/:id", async (c) => {
  const id = c.req.param("id");
  const snapshot = await rollbackManager.getSnapshot(id);

  if (!snapshot) {
    throw new NotFoundError(`Snapshot with ID "${id}" not found`);
  }

  return c.json({
    success: true,
    data: snapshot,
  });
});

// DELETE /api/v1/rollback/snapshots/:id - Delete snapshot
rollbackRouter.delete("/snapshots/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await rollbackManager.deleteSnapshot(id);

  if (!deleted) {
    throw new NotFoundError(`Snapshot with ID "${id}" not found`);
  }

  logger.info(`Snapshot deleted via API: ${id}`);

  return c.json({
    success: true,
    message: `Snapshot deleted successfully`,
  });
});

// POST /api/v1/rollback/snapshots/:id/rollback - Execute rollback
rollbackRouter.post("/snapshots/:id/rollback", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const validated = rollbackSchema.safeParse(body);

  if (!validated.success) {
    throw new ValidationError("Invalid rollback data", validated.error.format());
  }

  const operation = await rollbackManager.executeRollback(id, {
    initiatedBy: validated.data.initiatedBy,
    reason: validated.data.reason,
  });

  logger.info(`Rollback executed via API: ${id} by ${validated.data.initiatedBy}`);

  return c.json({
    success: true,
    data: operation,
    message: `Rollback to snapshot "${id}" executed`,
  });
});

// GET /api/v1/rollback/operations - List rollback operations
rollbackRouter.get("/operations", async (c) => {
  const db = createDb(c.env.HADES_DB);
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  const operations = await db
    .select()
    .from(rollbackOperations)
    .orderBy(desc(rollbackOperations.startedAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    success: true,
    data: operations,
    pagination: { limit, offset, total: operations.length },
  });
});

// GET /api/v1/rollback/operations/:id - Get operation by ID
rollbackRouter.get("/operations/:id", async (c) => {
  const id = c.req.param("id");
  const operation = await rollbackManager.getOperation(id);

  if (!operation) {
    throw new NotFoundError(`Rollback operation with ID "${id}" not found`);
  }

  return c.json({
    success: true,
    data: operation,
  });
});

// GET /api/v1/rollback/stats - Get rollback statistics
rollbackRouter.get("/stats", async (c) => {
  const stats = await rollbackManager.getStats();

  return c.json({
    success: true,
    data: stats,
  });
});
