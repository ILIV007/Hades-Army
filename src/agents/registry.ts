/**
 * Hades Army v0.2 — Agent Registry
 * Dynamic agent configuration. Pure ESM.
 */

import type { AgentRole, AgentConfig, AgentRegistry } from "../types";
import type { HadesEnv } from "../config/env";
import { createAgentRegistry, getAgentConfig, updateAgentModel } from "../config/agents.config";

export class AgentRegistryService {
  private registry: AgentRegistry;

  constructor(env: HadesEnv) {
    this.registry = createAgentRegistry(env);
  }

  getConfig(role: AgentRole): AgentConfig {
    return getAgentConfig(this.registry, role);
  }

  getRegistry(): AgentRegistry {
    return { ...this.registry };
  }

  updateModel(role: AgentRole, model: string, provider: "openrouter" | "google" = "openrouter"): void {
    this.registry = updateAgentModel(this.registry, role, model, provider);
  }

  hasCapability(role: AgentRole, capability: string): boolean {
    return this.getConfig(role).capabilities.includes(capability);
  }

  isRestricted(role: AgentRole, action: string): boolean {
    return this.getConfig(role).restrictions.includes(action);
  }
}
