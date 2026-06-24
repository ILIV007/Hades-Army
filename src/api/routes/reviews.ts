
/**
 * Reviews API Routes - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { generateId } from "../../utils/helpers";
import { ValidationError, NotFoundError } from "../../utils/errors";
import { reviewManager } from "../../agents/reviewer";
import { reviews } from "../../database/schema";
import { createDb } from "../../database/client";
import type { HadesContext, ReviewType } from "../../types";

// ============================================
// Validation Schemas
// ============================================

const createReviewSchema = z.object({
  target: z.string().min(1).max(500),
  code: z.string().min(1),
  type: z.enum(["code", "architecture", "security", "performance", "documentation"]),
  context: z.string().optional(),
});

const updateReviewSchema = z.object({
  status: z.enum(["pending", "in_progress", "completed", "approved", "rejected"]).optional(),
  overallScore: z.number().min(0).max(100).optional(),
  summary: z.string().optional(),
});

// ============================================
// Router
// ============================================

export const reviewsRouter = new Hono<HadesContext>();

// GET /api/v1/reviews - List all reviews
reviewsRouter.get("/", async (c) => {
  const db = createDb(c.env.HADES_DB);
  const status = c.req.query("status");
  const type = c.req.query("type");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  let query = db.select().from(reviews).orderBy(desc(reviews.createdAt)).limit(limit).offset(offset);

  // Note: In production, add filtering by status and type
  const reviewsList = await query;

  return c.json({
    success: true,
    data: reviewsList,
    pagination: { limit, offset, total: reviewsList.length },
  });
});

// POST /api/v1/reviews - Create a new review
reviewsRouter.post("/", async (c) => {
  const body = await c.req.json();
  const validated = createReviewSchema.safeParse(body);

  if (!validated.success) {
    throw new ValidationError("Invalid review data", validated.error.format());
  }

  const review = await reviewManager.review({
    id: generateId("review"),
    target: validated.data.target,
    code: validated.data.code,
    type: validated.data.type as ReviewType,
    context: validated.data.context,
  });

  // Store in database
  const db = createDb(c.env.HADES_DB);
  await db.insert(reviews).values({
    id: review.id,
    target: review.target,
    type: review.type,
    status: review.status,
    overallScore: review.overallScore,
    findings: JSON.stringify(review.findings),
    summary: review.summary,
    createdAt: review.createdAt,
    completedAt: review.completedAt,
  });

  logger.info(`Review created via API: ${review.id} for ${review.target}`);

  return c.json(
    {
      success: true,
      data: review,
      message: `Review created for "${review.target}"`,
    },
    201
  );
});

// GET /api/v1/reviews/:id - Get review by ID
reviewsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.HADES_DB);

  const result = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);

  if (result.length === 0) {
    throw new NotFoundError(`Review with ID "${id}" not found`);
  }

  const review = result[0];

  return c.json({
    success: true,
    data: {
      ...review,
      findings: JSON.parse(review.findings),
    },
  });
});

// PATCH /api/v1/reviews/:id - Update review
reviewsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const validated = updateReviewSchema.safeParse(body);

  if (!validated.success) {
    throw new ValidationError("Invalid update data", validated.error.format());
  }

  const db = createDb(c.env.HADES_DB);

  const result = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
  if (result.length === 0) {
    throw new NotFoundError(`Review with ID "${id}" not found`);
  }

  await db
    .update(reviews)
    .set({
      status: validated.data.status || result[0].status,
      overallScore: validated.data.overallScore ?? result[0].overallScore,
      summary: validated.data.summary || result[0].summary,
    })
    .where(eq(reviews.id, id));

  logger.info(`Review updated via API: ${id}`);

  return c.json({
    success: true,
    message: "Review updated successfully",
  });
});

// POST /api/v1/reviews/:id/approve - Approve review
reviewsRouter.post("/:id/approve", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const notes = body.notes;

  await reviewManager.approveReview(id, notes);

  const db = createDb(c.env.HADES_DB);
  await db
    .update(reviews)
    .set({ status: "approved" })
    .where(eq(reviews.id, id));

  logger.info(`Review approved via API: ${id}`);

  return c.json({
    success: true,
    message: "Review approved successfully",
  });
});

// POST /api/v1/reviews/:id/reject - Reject review
reviewsRouter.post("/:id/reject", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const reason = body.reason;

  if (!reason) {
    throw new ValidationError("Rejection reason is required");
  }

  await reviewManager.rejectReview(id, reason);

  const db = createDb(c.env.HADES_DB);
  await db
    .update(reviews)
    .set({ status: "rejected" })
    .where(eq(reviews.id, id));

  logger.info(`Review rejected via API: ${id}`);

  return c.json({
    success: true,
    message: "Review rejected successfully",
  });
});

// GET /api/v1/reviews/stats - Get review statistics
reviewsRouter.get("/stats/overview", async (c) => {
  const stats = reviewManager.getStats();

  return c.json({
    success: true,
    data: stats,
  });
});
