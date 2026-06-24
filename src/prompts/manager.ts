
/**
 * Prompt Manager - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Prompt template management:
 * - Template CRUD
 * - Variable substitution
 * - Version control
 * - Category organization
 * - Template rendering
 */

import { eq, desc } from "drizzle-orm";
import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import { NotFoundError, ValidationError } from "../utils/errors";
import { promptTemplates } from "../database/schema";
import { createDb } from "../database/client";
import type { HadesBindings, PromptTemplate, PromptCategory, PromptStatus } from "../types";

// ============================================
// Types
// ============================================

export interface CreatePromptParams {
  name: string;
  category: PromptCategory;
  content: string;
  variables?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdatePromptParams {
  name?: string;
  content?: string;
  variables?: string[];
  status?: PromptStatus;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface RenderPromptParams {
  [key: string]: string | number | boolean | undefined;
}

export interface PromptStats {
  total: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  totalVariables: number;
}

// ============================================
// Default Prompts
// ============================================

const DEFAULT_PROMPTS: CreatePromptParams[] = [
  {
    name: "System Builder",
    category: "system",
    content: `You are an expert software developer. Your task is to generate clean, well-documented code based on the following specification.

Specification: {{specification}}
Language: {{language}}
Framework: {{framework}}

Requirements:
{{requirements}}

Please generate the code following best practices for {{language}}. Include:
- Proper error handling
- Type safety
- Documentation comments
- Unit test examples`,
    variables: ["specification", "language", "framework", "requirements"],
    tags: ["builder", "code-generation"],
  },
  {
    name: "Code Reviewer",
    category: "review",
    content: `You are a senior code reviewer. Review the following code for quality, security, and best practices.

Code to review:
\`\`\`{{language}}
{{code}}
\`\`\`

Focus areas: {{focus_areas}}

Please provide:
1. Overall score (0-100)
2. Critical issues
3. Security concerns
4. Performance optimizations
5. Style improvements
6. Suggested refactors`,
    variables: ["language", "code", "focus_areas"],
    tags: ["reviewer", "code-review"],
  },
  {
    name: "Security Analyzer",
    category: "analysis",
    content: `You are a security expert. Analyze the following code for security vulnerabilities.

Code:
\`\`\`{{language}}
{{code}}
\`\`\`

Check for:
- SQL injection
- XSS vulnerabilities
- Insecure dependencies
- Hardcoded secrets
- Input validation issues
- Authentication flaws

Provide a detailed security report with severity ratings and remediation steps.`,
    variables: ["language", "code"],
    tags: ["security", "analysis"],
  },
  {
    name: "Deployment Validator",
    category: "system",
    content: `Validate the following deployment configuration for correctness and security.

Configuration:
\`\`\`yaml
{{config}}
\`\`\`

Environment: {{environment}}

Check:
1. Required variables are set
2. No hardcoded secrets
3. Proper resource limits
4. Health checks configured
5. Security headers present
6. Logging configured`,
    variables: ["config", "environment"],
    tags: ["deploy", "validation"],
  },
  {
    name: "Bug Analyzer",
    category: "analysis",
    content: `Analyze the following error and provide a detailed diagnosis.

Error:
\`\`\`
{{error}}
\`\`\`

Context:
{{context}}

Provide:
1. Root cause analysis
2. Severity assessment
3. Fix recommendation
4. Prevention strategy
5. Related issues to check`,
    variables: ["error", "context"],
    tags: ["debugging", "analysis"],
  },
];

// ============================================
// Prompt Manager
// ============================================

export class PromptManager {
  // ============================================
  // CRUD Operations
  // ============================================

  async createTemplate(env: HadesBindings, params: CreatePromptParams): Promise<PromptTemplate> {
    const db = createDb(env.HADES_DB);

    const id = generateId("prm");
    const now = new Date().toISOString();

    const template: PromptTemplate = {
      id,
      name: params.name,
      category: params.category,
      version: 1,
      content: params.content,
      variables: params.variables || this.extractVariables(params.content),
      status: "draft",
      createdBy: "system",
      createdAt: now,
      updatedAt: now,
      tags: params.tags || [],
      metadata: params.metadata || {},
    };

    await db.insert(promptTemplates).values({
      id: template.id,
      name: template.name,
      category: template.category,
      version: template.version,
      content: template.content,
      variables: JSON.stringify(template.variables),
      status: template.status,
      createdBy: template.createdBy,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      tags: JSON.stringify(template.tags),
      metadata: JSON.stringify(template.metadata),
    });

    logger.info(`Prompt template created: ${template.id} - ${template.name}`);
    return template;
  }

  async getTemplate(env: HadesBindings, id: string): Promise<PromptTemplate | null> {
    const db = createDb(env.HADES_DB);

    const result = await db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.rowToTemplate(result[0]);
  }

  async getTemplateByName(env: HadesBindings, name: string): Promise<PromptTemplate | null> {
    const db = createDb(env.HADES_DB);

    const result = await db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.name, name))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.rowToTemplate(result[0]);
  }

  async getAllTemplates(env: HadesBindings, options?: { category?: string; status?: PromptStatus }): Promise<PromptTemplate[]> {
    const db = createDb(env.HADES_DB);

    let query = db
      .select()
      .from(promptTemplates)
      .orderBy(desc(promptTemplates.updatedAt));

    if (options?.category) {
      query = query.where(eq(promptTemplates.category, options.category));
    }
    if (options?.status) {
      query = query.where(eq(promptTemplates.status, options.status));
    }

    const results = await query;
    return results.map((row) => this.rowToTemplate(row));
  }

  async updateTemplate(
    env: HadesBindings,
    id: string,
    params: UpdatePromptParams
  ): Promise<PromptTemplate | null> {
    const db = createDb(env.HADES_DB);

    const existing = await this.getTemplate(env, id);
    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const newVersion = params.content ? existing.version + 1 : existing.version;

    await db
      .update(promptTemplates)
      .set({
        name: params.name ?? existing.name,
        content: params.content ?? existing.content,
        variables: params.variables ? JSON.stringify(params.variables) : JSON.stringify(existing.variables),
        status: params.status ?? existing.status,
        tags: params.tags ? JSON.stringify(params.tags) : JSON.stringify(existing.tags),
        metadata: params.metadata ? JSON.stringify(params.metadata) : JSON.stringify(existing.metadata),
        version: newVersion,
        updatedAt: now,
      })
      .where(eq(promptTemplates.id, id));

    logger.info(`Prompt template updated: ${id} (v${newVersion})`);

    return this.getTemplate(env, id);
  }

  async deleteTemplate(env: HadesBindings, id: string): Promise<boolean> {
    const db = createDb(env.HADES_DB);

    const existing = await this.getTemplate(env, id);
    if (!existing) {
      return false;
    }

    await db.delete(promptTemplates).where(eq(promptTemplates.id, id));
    logger.info(`Prompt template deleted: ${id}`);
    return true;
  }

  // ============================================
  // Template Rendering
  // ============================================

  async renderTemplate(env: HadesBindings, id: string, variables: RenderPromptParams): Promise<string | null> {
    const template = await this.getTemplate(env, id);
    if (!template) {
      return null;
    }

    return this.render(template.content, variables);
  }

  render(content: string, variables: RenderPromptParams): string {
    let rendered = content;

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      rendered = rendered.replace(placeholder, String(value ?? ""));
    }

    // Check for unreplaced variables
    const unreplaced = rendered.match(/{{\s*\w+\s*}}/g);
    if (unreplaced) {
      logger.warn(`Unreplaced variables in template: ${unreplaced.join(", ")}`);
    }

    return rendered;
  }

  // ============================================
  // Status Management
  // ============================================

  async activateTemplate(env: HadesBindings, id: string): Promise<PromptTemplate | null> {
    return this.updateTemplate(env, id, { status: "active" });
  }

  async deprecateTemplate(env: HadesBindings, id: string): Promise<PromptTemplate | null> {
    return this.updateTemplate(env, id, { status: "deprecated" });
  }

  async archiveTemplate(env: HadesBindings, id: string): Promise<PromptTemplate | null> {
    return this.updateTemplate(env, id, { status: "archived" });
  }

  // ============================================
  // Default Templates
  // ============================================

  async initializeDefaults(env: HadesBindings): Promise<void> {
    for (const prompt of DEFAULT_PROMPTS) {
      const existing = await this.getTemplateByName(env, prompt.name);
      if (!existing) {
        await this.createTemplate(env, prompt);
      }
    }
    logger.info("Default prompt templates initialized");
  }

  // ============================================
  // Statistics
  // ============================================

  async getStats(env: HadesBindings): Promise<PromptStats> {
    const templates = await this.getAllTemplates(env);

    const byCategory: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalVariables = 0;

    for (const template of templates) {
      byCategory[template.category] = (byCategory[template.category] || 0) + 1;
      byStatus[template.status] = (byStatus[template.status] || 0) + 1;
      totalVariables += template.variables.length;
    }

    return {
      total: templates.length,
      byCategory,
      byStatus,
      totalVariables,
    };
  }

  // ============================================
  // Helpers
  // ============================================

  private extractVariables(content: string): string[] {
    const matches = content.match(/{{\s*(\w+)\s*}}/g);
    if (!matches) return [];

    const variables = matches
      .map((m) => m.replace(/[{}\s]/g, ""))
      .filter((v, i, arr) => arr.indexOf(v) === i);

    return variables;
  }

  private rowToTemplate(row: Record<string, unknown>): PromptTemplate {
    return {
      id: row.id as string,
      name: row.name as string,
      category: row.category as PromptCategory,
      version: row.version as number,
      content: row.content as string,
      variables: JSON.parse((row.variables as string) || "[]"),
      status: row.status as PromptStatus,
      createdBy: row.createdBy as string,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
      tags: JSON.parse((row.tags as string) || "[]"),
      metadata: JSON.parse((row.metadata as string) || "{}"),
    };
  }
}

export const promptManager = new PromptManager();
