/**
 * Hades Army — Agent Registry
 * Dynamic agent configuration and model resolution.
 */

import type { AgentRole, AgentConfig, AgentRegistry } from '../types';
import type { HadesEnv } from '../config/env';
import { createAgentRegistry, getAgentConfig, updateAgentModel } from '../config/agents.config';

export class AgentRegistryService {
  private registry: AgentRegistry;

  constructor(env: HadesEnv) {
    this.registry = createAgentRegistry(env);
  }

  /**
   * Get configuration for a specific agent role.
   */
  getConfig(role: AgentRole): AgentConfig {
    return getAgentConfig(this.registry, role);
  }

  /**
   * Get the full registry.
   */
  getRegistry(): AgentRegistry {
    return { ...this.registry };
  }

  /**
   * Update the model for a specific role.
   */
  updateModel(role: AgentRole, model: string, provider: 'openrouter' | 'google' = 'openrouter'): void {
    this.registry = updateAgentModel(this.registry, role, model, provider);
  }

  /**
   * Check if an agent has a specific capability.
   */
  hasCapability(role: AgentRole, capability: string): boolean {
    const config = this.getConfig(role);
    return config.capabilities.includes(capability);
  }

  /**
   * Check if an action is restricted for an agent.
   */
  isRestricted(role: AgentRole, action: string): boolean {
    const config = this.getConfig(role);
    return config.restrictions.includes(action);
  }
}
