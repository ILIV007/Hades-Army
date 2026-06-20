/**
 * Hades Army v0.6 - Architecture Memory System
 * Architecture Decision Records (ADR) Management
 */

import type { ADR, ADRStatus } from '../core/types';
import type { DBContext } from '../db';
import { createADR, getADRs, getADR } from '../db';

export interface ADRTemplate {
  adrNumber: string;
  title: string;
  decision: string;
  reason: string;
  alternatives?: string;
  consequences?: string;
  status: ADRStatus;
  author?: string;
  date: string;
  tags?: string[];
}

export async function createArchitectureDecision(
  ctx: DBContext,
  projectId: number,
  template: Omit<ADRTemplate, 'adrNumber' | 'date'>
): Promise<ADR> {
  // Generate ADR number
  const existingADRs = await getADRs(ctx, projectId);
  const nextNumber = existingADRs.length + 1;
  const adrNumber = `ADR-${String(nextNumber).padStart(3, '0')}`;

  const adr = await createADR(ctx, {
    projectId,
    adrNumber,
    title: template.title,
    decision: template.decision,
    reason: template.reason,
    alternatives: template.alternatives,
    consequences: template.consequences,
    status: template.status || 'proposed',
    author: template.author,
    date: new Date().toISOString().split('T')[0],
    tags: template.tags,
  });

  return adr;
}

export async function getArchitectureDecisions(
  ctx: DBContext,
  projectId: number,
  status?: ADRStatus
): Promise<ADR[]> {
  const adrs = await getADRs(ctx, projectId);
  if (status) {
    return adrs.filter(adr => adr.status === status);
  }
  return adrs;
}

export async function acceptADR(ctx: DBContext, adrId: number): Promise<ADR> {
  // Update would need to be implemented in DB layer
  // For now, we return the ADR (full implementation would update DB)
  return getADR(ctx, adrId);
}

export async function deprecateADR(
  ctx: DBContext,
  adrId: number,
  reason: string
): Promise<ADR> {
  // Mark as deprecated with reason
  return getADR(ctx, adrId);
}

export function formatADR(adr: ADR): string {
  return `# ${adr.adrNumber}: ${adr.title}

## Status
${adr.status}

## Decision
${adr.decision}

## Reason
${adr.reason}

${adr.alternatives ? `## Alternatives Considered
${adr.alternatives}
` : ''}

${adr.consequences ? `## Consequences
${adr.consequences}
` : ''}

## Metadata
- **Author:** ${adr.author || 'Unknown'}
- **Date:** ${adr.date}
${adr.tags ? `- **Tags:** ${adr.tags.join(', ')}` : ''}
`;
}

export function searchADRs(adrs: ADR[], query: string): ADR[] {
  const lowerQuery = query.toLowerCase();
  return adrs.filter(adr =>
    adr.title.toLowerCase().includes(lowerQuery) ||
    adr.decision.toLowerCase().includes(lowerQuery) ||
    adr.reason.toLowerCase().includes(lowerQuery) ||
    (adr.tags && adr.tags.some(t => t.toLowerCase().includes(lowerQuery)))
  );
}

export function getADRsByTag(adrs: ADR[], tag: string): ADR[] {
  return adrs.filter(adr => adr.tags?.includes(tag));
}

export function getRelatedADRs(adrs: ADR[], adr: ADR): ADR[] {
  return adrs.filter(other => {
    if (other.id === adr.id) return false;
    // Related if they share tags or mention each other
    const sharedTags = other.tags?.filter(t => adr.tags?.includes(t)) || [];
    const mentionsOther = adr.decision.includes(other.adrNumber) || other.decision.includes(adr.adrNumber);
    return sharedTags.length > 0 || mentionsOther;
  });
}

// Pre-defined ADR templates for common decisions
export const ADR_TEMPLATES: Record<string, Partial<ADRTemplate>> = {
  database: {
    title: 'Database Selection',
    decision: 'We will use [DATABASE] for [PURPOSE].',
    reason: '[REASON FOR CHOICE]',
    alternatives: 'We considered [ALTERNATIVE_1] and [ALTERNATIVE_2].',
    consequences: '[IMPACT ON PERFORMANCE, SCALABILITY, MAINTENANCE]',
    tags: ['database', 'infrastructure'],
  },
  authentication: {
    title: 'Authentication Strategy',
    decision: 'We will use [METHOD] for authentication.',
    reason: '[REASON FOR CHOICE]',
    alternatives: 'We considered [ALTERNATIVE_1] and [ALTERNATIVE_2].',
    consequences: '[SECURITY IMPLICATIONS, USER EXPERIENCE IMPACT]',
    tags: ['security', 'authentication'],
  },
  architecture: {
    title: 'System Architecture',
    decision: 'We will adopt [ARCHITECTURE_PATTERN].',
    reason: '[REASON FOR CHOICE]',
    alternatives: 'We considered [ALTERNATIVE_1] and [ALTERNATIVE_2].',
    consequences: '[IMPACT ON SCALABILITY, COMPLEXITY, TEAM STRUCTURE]',
    tags: ['architecture', 'design'],
  },
  api: {
    title: 'API Design',
    decision: 'We will use [REST/GraphQL/gRPC] for our API.',
    reason: '[REASON FOR CHOICE]',
    alternatives: 'We considered [ALTERNATIVE_1] and [ALTERNATIVE_2].',
    consequences: '[IMPACT ON CLIENT DEVELOPMENT, PERFORMANCE]',
    tags: ['api', 'design'],
  },
};
