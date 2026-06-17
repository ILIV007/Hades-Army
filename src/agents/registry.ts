/**
 * Hades Army v0.2.1 — Agent Registry Service
 * Dynamic agent configuration with validation and persistence.
 * Pure ESM.
 */

import type { AgentRole, AgentConfig, AgentRegistry } from "../types";
import type { HadesEnv } from "../config/env";
import { KVClient } from "../memory/kv.client";
import { createAgentRegistry, getAgentConfig, validateRegistry } from "../config/agents.config";

const KV_REGISTRY_KEY = "agent_registry:overrides";

export class AgentRegistryService {
  private registry: AgentRegistry;
  private kv: KVClient;

  constructor(env: HadesEnv) {
    this.kv = new KVClient(env);
    this.registry = createAgentRegistry(env);

    // Boot-time validation
    const audit = validateRegistry(this.registry);
    if (!audit.ok) {
      const failures = audit.checks.filter(c => c.status === "fail");
      throw new Error(
        `Registry validation failed:\n${failures.map(f => `  - ${f.name}: ${f.message}`).join("\n")}`
      );
    }
  }

  async init(): Promise<void> {
    // FIX MEDIUM #3: Load persisted overrides from KV on init
    const overridesJson = await this.kv.kv.get(KV_REGISTRY_KEY);
    if (overridesJson) {
      try {
        const overrides = JSON.parse(overridesJson) as Partial<AgentRegistry>;
        for (const [role, config] of Object.entries(overrides)) {
          if (config && this.isValidRole(role)) {
            this.registry = {
              ...this.registry,
              [role]: { ...this.registry[role as AgentRole], ...config },
            };
          }
        }
      } catch {
        // Invalid overrides, ignore
      }
    }
  }

  getConfig(role: AgentRole): AgentConfig {
    return getAgentConfig(this.registry, role);
  }

  getRegistry(): AgentRegistry {
    return { ...this.registry };
  }

  // FIX MEDIUM #3: Persist model changes to KV
  async updateModel(role: AgentRole, model: string, provider: "openrouter" | "google" = "openrouter"): Promise<void> {
    this.registry = { ...this.registry, [role]: { ...this.registry[role], model, provider } };

    // Persist to KV
    const overrides: Partial<AgentRegistry> = {};
    for (const [r, cfg] of Object.entries(this.registry)) {
      if (this.isValidRole(r)) {
        overrides[r as AgentRole] = cfg;
      }
    }
    await this.kv.kv.put(KV_REGISTRY_KEY, JSON.stringify(overrides), { expirationTtl: 2592000 }); // 30 days
  }

  hasCapability(role: AgentRole, capability: string): boolean {
    return this.getConfig(role).capabilities.includes(capability);
  }

  isRestricted(role: AgentRole, action: string): boolean {
    return this.getConfig(role).restrictions.includes(action);
  }

  private isValidRole(role: string): role is AgentRole {
    return ["manager", "builder", "reviewer"].includes(role);
  }
}
