/**
 * Agent Registry - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { logger } from "../utils/logger";

export interface AgentRegistration {
  id: string;
  name: string;
  type: string;
  capabilities: string[];
  status: string;
  registeredAt: string;
}

export class AgentRegistry {
  private agents: Map<string, AgentRegistration> = new Map();

  register(agent: Omit<AgentRegistration, "registeredAt">): AgentRegistration {
    const registration: AgentRegistration = {
      ...agent,
      registeredAt: new Date().toISOString(),
    };
    this.agents.set(agent.id, registration);
    logger.info(`Agent registered: ${agent.name} (${agent.id})`);
    return registration;
  }

  unregister(id: string): boolean {
    const removed = this.agents.delete(id);
    if (removed) logger.info(`Agent unregistered: ${id}`);
    return removed;
  }

  get(id: string): AgentRegistration | undefined {
    return this.agents.get(id);
  }

  getAll(): AgentRegistration[] {
    return Array.from(this.agents.values());
  }

  getByType(type: string): AgentRegistration[] {
    return this.getAll().filter((a) => a.type === type);
  }
}

export const agentRegistry = new AgentRegistry();
