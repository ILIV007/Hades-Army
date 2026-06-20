/**
 * Hades Army v0.6 - Agent Registry
 * Manages agent registration, capabilities, and routing
 */

import type { Agent, AgentType, Task } from '../core/types';

interface AgentRegistry {
  agents: Map<string, Agent>;
  capabilities: Map<string, string[]>;
}

const registry: AgentRegistry = {
  agents: new Map(),
  capabilities: new Map([
    ['manager', ['planning', 'analysis', 'architecture', 'risk_assessment', 'task_creation']],
    ['builder', ['coding', 'testing', 'refactoring', 'documentation']],
    ['reviewer', ['code_review', 'security_audit', 'performance_review', 'architecture_compliance']],
  ]),
};

export function registerAgent(agent: Agent): void {
  registry.agents.set(agent.id, agent);
}

export function getAgent(id: string): Agent | undefined {
  return registry.agents.get(id);
}

export function getAgentsByType(type: AgentType): Agent[] {
  return Array.from(registry.agents.values()).filter(a => a.type === type);
}

export function getAvailableAgent(type: AgentType): Agent | null {
  const agents = getAgentsByType(type);
  const available = agents.find(a => a.status === 'idle');
  return available || null;
}

export function assignTask(agentId: string, taskId: number): void {
  const agent = registry.agents.get(agentId);
  if (agent) {
    agent.status = 'working';
    agent.currentTaskId = taskId;
    agent.lastActiveAt = new Date().toISOString();
  }
}

export function completeTask(agentId: string): void {
  const agent = registry.agents.get(agentId);
  if (agent) {
    agent.status = 'idle';
    agent.currentTaskId = undefined;
    agent.efficiency = calculateEfficiency(agent);
  }
}

export function getAgentCapabilities(type: AgentType): string[] {
  return registry.capabilities.get(type) || [];
}

export function canHandleTask(agent: Agent, task: Task): boolean {
  const capabilities = getAgentCapabilities(agent.type);

  switch (task.priority) {
    case 'critical':
      return capabilities.includes('planning') || capabilities.includes('code_review');
    case 'high':
      return agent.efficiency > 70;
    default:
      return true;
  }
}

function calculateEfficiency(agent: Agent): number {
  // Simplified efficiency calculation
  const baseEfficiency = 85;
  const taskBonus = agent.currentTaskId ? 5 : 0;
  return Math.min(baseEfficiency + taskBonus, 100);
}

export function getSystemStatus(): {
  totalAgents: number;
  activeAgents: number;
  idleAgents: number;
  agentTypes: Record<string, number>;
} {
  const agents = Array.from(registry.agents.values());
  return {
    totalAgents: agents.length,
    activeAgents: agents.filter(a => a.status === 'working').length,
    idleAgents: agents.filter(a => a.status === 'idle').length,
    agentTypes: {
      manager: agents.filter(a => a.type === 'manager').length,
      builder: agents.filter(a => a.type === 'builder').length,
      reviewer: agents.filter(a => a.type === 'reviewer').length,
    },
  };
}

// Initialize default agents
registerAgent({
  id: 'manager-1',
  type: 'manager',
  name: 'Technical Architect',
  status: 'idle',
  capabilities: ['planning', 'analysis', 'architecture', 'risk_assessment', 'task_creation'],
  efficiency: 95,
});

registerAgent({
  id: 'builder-1',
  type: 'builder',
  name: 'Senior Builder',
  status: 'idle',
  capabilities: ['coding', 'testing', 'refactoring', 'documentation'],
  efficiency: 90,
});

registerAgent({
  id: 'reviewer-1',
  type: 'reviewer',
  name: 'Code Reviewer',
  status: 'idle',
  capabilities: ['code_review', 'security_audit', 'performance_review', 'architecture_compliance'],
  efficiency: 92,
});
