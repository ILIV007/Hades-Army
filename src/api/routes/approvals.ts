
/**
 * Approvals API Routes - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { generateId } from "../../utils/helpers";
import { ValidationError, NotFoundError, ConflictError } from "../../utils/errors";
import { approvalManager } from "../../approval/manager";
import { approvalRequests } from "../../database/schema";
import { createDb } from "../../database/client";
import type { HadesContext, ApprovalType } from "../../types";

// ============================================
// Validation Schemas
// ============================================

const createApprovalSchema = z.object({
  type: z.enum(["deployment", "code_change", "config_change", "pr_review", "agent_action", "rollback", "custom"]),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  metadata: z.record(z.unknown()).optional(),
  requestedBy: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
});

const approveSchema = z.object({
  approvedBy: z.string().min(1),
  notes: z.string().optional(),
});

const rejectSchema = z.object({
  rejectedBy: z.string().min(1),
  reason: z.string().min(1),
});

// ============================================
// Router
// ============================================

export const approvalsRouter = new Hono<HadesContext>();

// GET /api/v1/approvals - List all approval requests
approvalsRouter.get("/", async (c) => {
  const db = createDb(c.env.HADES_DB);
  const status = c.req.query("status");
  const type = c.req.query("type");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  let query = db
    .select()
    .from(approvalRequests)
    .orderBy(desc(approvalRequests.createdAt))
    .limit(limit)
    .offset(offset);

  const approvalsList = await query;

  return c.json({
    success: true,
    data: approvalsList,
    pagination: { limit, offset, total: approvalsList.length },
  });
});

// POST /api/v1/approvals - Create a new approval request
approvalsRouter.post("/", async (c) => {
  const body = await c.req.json();
  const validated = createApprovalSchema.safeParse(body);

  if (!validated.success) {
    throw new ValidationError("Invalid approval data", validated.error.format());
  }

  // Set default expiration to 24 hours if not provided
  const expiresAt =
    validated.data.expiresAt ||
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const approval = await approvalManager.createRequest({
    type: validated.data.type as ApprovalType,
    title: validated.data.title,
    description: validated.data.description,
    metadata: validated.data.metadata || {},
    requestedBy: validated.data.requestedBy,
    expiresAt,
  });

  logger.info(`Approval request created via API: ${approval.id}`);

  return c.json(
    {
      success: true,
      data: approval,
      message: `Approval request "${approval.title}" created`,
    },
    201
  );
});

// GET /api/v1/approvals/:id - Get approval by ID
approvalsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.HADES_DB);

  const result = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.id, id))
    .limit(1);

  if (result.length === 0) {
    throw new NotFoundError(`Approval request with ID "${id}" not found`);
  }

  return c.json({
    success: true,
    data: result[0],
  });
});

// POST /api/v1/approvals/:id/approve - Approve request
approvalsRouter.post("/:id/approve", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const validated = approveSchema.safeParse(body);

  if (!validated.success) {
    throw new ValidationError("Invalid approval data", validated.error.format());
  }

  const approval = await approvalManager.approveRequest(
    id,
    validated.data.approvedBy,
    validated.data.notes
  );

  logger.info(`Approval request approved via API: ${id} by ${validated.data.approvedBy}`);

  return c.json({
    success: true,
    data: approval,
    message: "Approval request approved successfully",
  });
});

// POST /api/v1/approvals/:id/reject - Reject request
approvalsRouter.post("/:id/reject", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const validated = rejectSchema.safeParse(body);

  if (!validated.success) {
    throw new ValidationError("Invalid rejection data", validated.error.format());
  }

  const approval = await approvalManager.rejectRequest(
    id,
    validated.data.rejectedBy,
    validated.data.reason
  );

  logger.info(`Approval request rejected via API: ${id} by ${validated.data.rejectedBy}`);

  return c.json({
    success: true,
    data: approval,
    message: "Approval request rejected successfully",
  });
});

// POST /api/v1/approvals/:id/cancel - Cancel request
approvalsRouter.post("/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const approval = await approvalManager.cancelRequest(id);

  logger.info(`Approval request cancelled via API: ${id}`);

  return c.json({
    success: true,
    data: approval,
    message: "Approval request cancelled successfully",
  });
});

// GET /api/v1/approvals/stats - Get approval statistics
approvalsRouter.get("/stats/overview", async (c) => {
  const stats = await approvalManager.getStats();

  return c.json({
    success: true,
    data: stats,
  });
});

// GET /api/v1/approvals/pending - Get pending approvals
approvalsRouter.get("/pending/list", async (c) => {
  const pending = await approvalManager.getPendingRequests();

  return c.json({
    success: true,
    data: pending,
    count: pending.length,
  });
});
