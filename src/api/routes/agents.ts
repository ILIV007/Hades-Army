
/**
 * Agents API Routes - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { generateId } from "../../utils/helpers";
import { HadesError, ValidationError, NotFoundError } from "../../utils/errors";
import { agentManager } from "../../agents/manager";
import { agents, agentTasks } from "../../database/schema";
import { createDb } from "../../database/client";
import type { HadesContext, AgentType } from "../../types";

// ============================================
// Validation Schemas
// ============================================

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["builder", "reviewer", "analyzer", "tester", "deployer", "custom"]),
  priority: z.number().min(1).max(10).optional(),
  capabilities: z.array(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  priority: z.number().min(1).max(10).optional(),
  capabilities: z.array(z.string()).optional(),
  config: z.record(z.unknown()).optional(),
  status: z.enum(["active", "paused", "pending", "error"]).optional(),
});

const executeTaskSchema = z.object({
  type: z.string().min(1),
  context: z.record(z.unknown()).optional(),
});

// ============================================
// Router
// ============================================

export const agentsRouter = new Hono<HadesContext>();

// GET /api/v1/agents - List all agents
agentsRouter.get("/", async (c) => {
  const db = createDb(c.env.HADES_DB);
  const agentsList = await agentManager.getAllAgents(db);

  return c.json({
    success: true,
    data: agentsList,
    count: agentsList.length,
  });
});

// POST /api/v1/agents - Create a new agent
agentsRouter.post("/", async (c) => {
  const body = await c.req.json();
  const validated = createAgentSchema.safeParse(body);

  if (!validated.success) {
    throw new ValidationError("Invalid agent data", validated.error.format());
  }

  const db = createDb(c.env.HADES_DB);
  const agent = await agentManager.createAgent(db, {
    name: validated.data.name,
    type: validated.data.type as AgentType,
    priority: validated.data.priority,
    capabilities: validated.data.capabilities,
    config: validated.data.config,
  });

  logger.info(`Agent created via API: ${agent.name} (${agent.id})`);

  return c.json(
    {
      success: true,
      data: agent,
      message: `Agent "${agent.name}" created successfully`,
    },
    201
  );
});

// GET /api/v1/agents/:id - Get agent by ID
agentsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.HADES_DB);
  const agent = await agentManager.getAgent(db, id);

  if (!agent) {
    throw new NotFoundError(`Agent with ID "${id}" not found`);
  }

  return c.json({
    success: true,
    data: agent,
  });
});

// PATCH /api/v1/agents/:id - Update agent
agentsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const validated = updateAgentSchema.safeParse(body);

  if (!validated.success) {
    throw new ValidationError("Invalid update data", validated.error.format());
  }

  const db = createDb(c.env.HADES_DB);
  const agent = await agentManager.updateAgent(db, id, validated.data);

  if (!agent) {
    throw new NotFoundError(`Agent with ID "${id}" not found`);
  }

  logger.info(`Agent updated via API: ${agent.name} (${agent.id})`);

  return c.json({
    success: true,
    data: agent,
    message: `Agent "${agent.name}" updated successfully`,
  });
});

// DELETE /api/v1/agents/:id - Delete agent
agentsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.HADES_DB);

  const agent = await agentManager.getAgent(db, id);
  if (!agent) {
    throw new NotFoundError(`Agent with ID "${id}" not found`);
  }

  await agentManager.removeAgent(db, id);
  logger.info(`Agent deleted via API: ${id}`);

  return c.json({
    success: true,
    message: `Agent "${agent.name}" deleted successfully`,
  });
});

// POST /api/v1/agents/:id/execute - Execute task on agent
agentsRouter.post("/:id/execute", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const validated = executeTaskSchema.safeParse(body);

  if (!validated.success) {
    throw new ValidationError("Invalid task data", validated.error.format());
  }

  const db = createDb(c.env.HADES_DB);
  const result = await agentManager.executeTask(
    db,
    id,
    validated.data.type,
    validated.data.context || {}
  );

  return c.json({
    success: true,
    data: result,
    message: "Task executed successfully",
  });
});

// POST /api/v1/agents/:id/pause - Pause agent
agentsRouter.post("/:id/pause", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.HADES_DB);
  await agentManager.pauseAgent(db, id);

  return c.json({
    success: true,
    message: "Agent paused successfully",
  });
});

// POST /api/v1/agents/:id/resume - Resume agent
agentsRouter.post("/:id/resume", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.HADES_DB);
  await agentManager.resumeAgent(db, id);

  return c.json({
    success: true,
    message: "Agent resumed successfully",
  });
});

// GET /api/v1/agents/:id/stats - Get agent statistics
agentsRouter.get("/:id/stats", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.HADES_DB);
  const stats = await agentManager.getAgentStats(db, id);

  return c.json({
    success: true,
    data: stats,
  });
});

// GET /api/v1/agents/:id/tasks - Get agent tasks
agentsRouter.get("/:id/tasks", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.HADES_DB);

  const tasks = await db
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.agentId, id))
    .orderBy(agentTasks.createdAt);

  return c.json({
    success: true,
    data: tasks,
    count: tasks.length,
  });
});
