/**
 * Agent Manager - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import { agents, agentTasks } from "../database/schema";
import type { AgentType, AgentStatus } from "../types";

export interface CreateAgentParams {
  name: string;
  type: AgentType;
  priority?: number;
  capabilities?: string[];
  config?: Record<string, unknown>;
}

export class AgentManager {
  async createAgent(db: any, params: CreateAgentParams): Promise<any> {
    const id = generateId("agent");
    const now = new Date().toISOString();

    const agent = {
      id,
      name: params.name,
      type: params.type,
      status: "active" as AgentStatus,
      priority: params.priority || 5,
      capabilities: JSON.stringify(params.capabilities || []),
      config: JSON.stringify(params.config || {}),
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(agents).values(agent);
    logger.info(`Agent created: ${params.name} (${id})`);
    return agent;
  }

  async getAgent(db: any, id: string): Promise<any | undefined> {
    const result = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    return result[0];
  }

  async getAllAgents(db: any): Promise<any[]> {
    return db.select().from(agents);
  }

  async updateAgent(db: any, id: string, updates: Partial<any>): Promise<any | undefined> {
    await db.update(agents).set({ ...updates, updatedAt: new Date().toISOString() }).where(eq(agents.id, id));
    return this.getAgent(db, id);
  }

  async removeAgent(db: any, id: string): Promise<void> {
    await db.delete(agents).where(eq(agents.id, id));
    logger.info(`Agent removed: ${id}`);
  }

  async pauseAgent(db: any, id: string): Promise<void> {
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, id));
    logger.info(`Agent paused: ${id}`);
  }

  async resumeAgent(db: any, id: string): Promise<void> {
    await db.update(agents).set({ status: "active" }).where(eq(agents.id, id));
    logger.info(`Agent resumed: ${id}`);
  }

  async executeTask(db: any, agentId: string, taskType: string, context: Record<string, unknown>): Promise<any> {
    const agent = await this.getAgent(db, agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    if (agent.status !== "active") throw new Error("Agent is not active");

    const taskId = generateId("task");
    await db.insert(agentTasks).values({
      id: taskId,
      agentId,
      type: taskType,
      status: "running",
      context: JSON.stringify(context),
      createdAt: new Date().toISOString(),
    });

    logger.info(`Task executed: ${taskId} on agent ${agentId}`);
    return { success: true, taskId, agentId };
  }

  async getAgentStats(db: any, agentId: string): Promise<any> {
    const tasks = await db.select().from(agentTasks).where(eq(agentTasks.agentId, agentId));
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t: any) => t.status === "completed").length;
    const successRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    return { totalTasks, completedTasks, failedTasks: totalTasks - completedTasks, successRate };
  }
}

export const agentManager = new AgentManager();
