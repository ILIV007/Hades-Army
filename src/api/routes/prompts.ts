
/**
 * Prompts API Routes - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { generateId } from "../../utils/helpers";
import { ValidationError, NotFoundError } from "../../utils/errors";
import { promptManager } from "../../prompts/manager";
import { promptTemplates } from "../../database/schema";
import { createDb } from "../../database/client";
import type { HadesContext, PromptCategory } from "../../types";

// ============================================
// Validation Schemas
// ============================================

const createPromptSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.enum(["system", "agent", "review", "build", "analysis", "custom"]),
  content: z.string().min(1).max(10000),
  variables: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updatePromptSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(10000).optional(),
  variables: z.array(z.string()).optional(),
  status: z.enum(["draft", "active", "deprecated", "archived"]).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ============================================
// Router
// ============================================

export const promptsRouter = new Hono<HadesContext>();

// GET /api/v1/prompts - List all prompt templates
promptsRouter.get("/", async (c) => {
  const db = createDb(c.env.HADES_DB);
  const category = c.req.query("category");
  const status = c.req.query("status");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  let query = db
    .select()
    .from(promptTemplates)
    .orderBy(desc(promptTemplates.updatedAt))
    .limit(limit)
    .offset(offset);

  const prompts = await query;

  return c.json({
    success: true,
    data: prompts.map((p) => ({
      ...p,
      variables: JSON.parse(p.variables),
      tags: JSON.parse(p.tags),
      metadata: JSON.parse(p.metadata),
    })),
    pagination: { limit, offset, total: prompts.length },
  });
});

// POST /api/v1/prompts - Create a new prompt template
promptsRouter.post("/", async (c) => {
  const body = await c.req.json();
  const validated = createPromptSchema.safeParse(body);

  if (!validated.success) {
    throw new ValidationError("Invalid prompt data", validated.error.format());
  }

  const prompt = await promptManager.createTemplate({
    name: validated.data.name,
    category: validated.data.category as PromptCategory,
    content: validated.data.content,
    variables: validated.data.variables || [],
    tags: validated.data.tags || [],
    metadata: validated.data.metadata || {},
  });

  logger.info(`Prompt template created via API: ${prompt.id}`);

  return c.json(
    {
      success: true,
      data: prompt,
      message: `Prompt template "${prompt.name}" created`,
    },
    201
  );
});

// GET /api/v1/prompts/:id - Get prompt by ID
promptsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const prompt = await promptManager.getTemplate(id);

  if (!prompt) {
    throw new NotFoundError(`Prompt template with ID "${id}" not found`);
  }

  return c.json({
    success: true,
    data: prompt,
  });
});

// PATCH /api/v1/prompts/:id - Update prompt template
promptsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const validated = updatePromptSchema.safeParse(body);

  if (!validated.success) {
    throw new ValidationError("Invalid update data", validated.error.format());
  }

  const prompt = await promptManager.updateTemplate(id, {
    name: validated.data.name,
    content: validated.data.content,
    variables: validated.data.variables,
    status: validated.data.status,
    tags: validated.data.tags,
    metadata: validated.data.metadata,
  });

  if (!prompt) {
    throw new NotFoundError(`Prompt template with ID "${id}" not found`);
  }

  logger.info(`Prompt template updated via API: ${id}`);

  return c.json({
    success: true,
    data: prompt,
    message: `Prompt template "${prompt.name}" updated`,
  });
});

// DELETE /api/v1/prompts/:id - Delete prompt template
promptsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await promptManager.deleteTemplate(id);

  if (!deleted) {
    throw new NotFoundError(`Prompt template with ID "${id}" not found`);
  }

  logger.info(`Prompt template deleted via API: ${id}`);

  return c.json({
    success: true,
    message: "Prompt template deleted successfully",
  });
});

// POST /api/v1/prompts/:id/render - Render prompt with variables
promptsRouter.post("/:id/render", async (c) => {
  const id = c.req.param("id");
  const variables = await c.req.json();

  const rendered = await promptManager.renderTemplate(id, variables);

  if (!rendered) {
    throw new NotFoundError(`Prompt template with ID "${id}" not found`);
  }

  return c.json({
    success: true,
    data: { rendered },
  });
});

// POST /api/v1/prompts/:id/activate - Activate prompt template
promptsRouter.post("/:id/activate", async (c) => {
  const id = c.req.param("id");
  const prompt = await promptManager.activateTemplate(id);

  if (!prompt) {
    throw new NotFoundError(`Prompt template with ID "${id}" not found`);
  }

  logger.info(`Prompt template activated via API: ${id}`);

  return c.json({
    success: true,
    data: prompt,
    message: `Prompt template "${prompt.name}" activated`,
  });
});

// POST /api/v1/prompts/:id/deprecate - Deprecate prompt template
promptsRouter.post("/:id/deprecate", async (c) => {
  const id = c.req.param("id");
  const prompt = await promptManager.deprecateTemplate(id);

  if (!prompt) {
    throw new NotFoundError(`Prompt template with ID "${id}" not found`);
  }

  logger.info(`Prompt template deprecated via API: ${id}`);

  return c.json({
    success: true,
    data: prompt,
    message: `Prompt template "${prompt.name}" deprecated`,
  });
});

// GET /api/v1/prompts/stats/overview - Get prompt statistics
promptsRouter.get("/stats/overview", async (c) => {
  const stats = await promptManager.getStats();

  return c.json({
    success: true,
    data: stats,
  });
});
