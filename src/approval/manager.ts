
/**
 * Approval Manager - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Approval workflow management:
 * - Create approval requests
 * - Approve/reject with notes
 * - Escalation policies
 * - Expiration handling
 * - Notification integration
 */

import { eq, desc, and, gte } from "drizzle-orm";
import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import { HadesError, ValidationError, NotFoundError, ConflictError } from "../utils/errors";
import { approvalRequests } from "../database/schema";
import { createDb } from "../database/client";
import type { HadesBindings, ApprovalType, ApprovalStatus, ApprovalRequest } from "../types";

// ============================================
// Types
// ============================================

export interface CreateApprovalParams {
  type: ApprovalType;
  title: string;
  description: string;
  metadata?: Record<string, unknown>;
  requestedBy: string;
  expiresAt?: string;
  escalationLevel?: number;
}

export interface ApprovalResult {
  success: boolean;
  request: ApprovalRequest;
  message: string;
}

export interface EscalationPolicy {
  level: number;
  approvers: string[];
  timeoutMinutes: number;
  notifyChannels: string[];
}

// ============================================
// Approval Manager
// ============================================

export class ApprovalManager {
  private escalationPolicies: Map<number, EscalationPolicy> = new Map();

  constructor() {
    this.initializeEscalationPolicies();
  }

  private initializeEscalationPolicies(): void {
    this.escalationPolicies.set(0, {
      level: 0,
      approvers: ["team_lead"],
      timeoutMinutes: 60,
      notifyChannels: ["telegram"],
    });

    this.escalationPolicies.set(1, {
      level: 1,
      approvers: ["tech_lead", "team_lead"],
      timeoutMinutes: 30,
      notifyChannels: ["telegram", "email"],
    });

    this.escalationPolicies.set(2, {
      level: 2,
      approvers: ["cto", "tech_lead"],
      timeoutMinutes: 15,
      notifyChannels: ["telegram", "email", "slack"],
    });
  }

  // ============================================
  // CRUD Operations
  // ============================================

  async createRequest(env: HadesBindings, params: CreateApprovalParams): Promise<ApprovalRequest> {
    const db = createDb(env.HADES_DB);

    // Validate expiration
    const expiresAt = params.expiresAt || this.getDefaultExpiration();
    if (new Date(expiresAt) <= new Date()) {
      throw new ValidationError("Expiration date must be in the future");
    }

    const id = generateId("apr");
    const now = new Date().toISOString();

    const request: ApprovalRequest = {
      id,
      type: params.type,
      title: params.title,
      description: params.description,
      metadata: params.metadata || {},
      requestedBy: params.requestedBy,
      status: "pending",
      createdAt: now,
      expiresAt,
    };

    await db.insert(approvalRequests).values({
      id: request.id,
      type: request.type,
      title: request.title,
      description: request.description,
      metadata: JSON.stringify(request.metadata),
      requestedBy: request.requestedBy,
      status: request.status,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      escalationLevel: params.escalationLevel || 0,
    });

    logger.info(`Approval request created: ${request.id} - ${request.title}`);

    // Trigger notification
    await this.notifyNewRequest(env, request);

    return request;
  }

  async getRequest(env: HadesBindings, id: string): Promise<ApprovalRequest | null> {
    const db = createDb(env.HADES_DB);

    const result = await db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    return this.rowToRequest(row);
  }

  async getAllRequests(env: HadesBindings, status?: ApprovalStatus): Promise<ApprovalRequest[]> {
    const db = createDb(env.HADES_DB);

    let query = db
      .select()
      .from(approvalRequests)
      .orderBy(desc(approvalRequests.createdAt));

    if (status) {
      query = query.where(eq(approvalRequests.status, status));
    }

    const results = await query;
    return results.map((row) => this.rowToRequest(row));
  }

  async getPendingRequests(env: HadesBindings): Promise<ApprovalRequest[]> {
    return this.getAllRequests(env, "pending");
  }

  // ============================================
  // Approval Actions
  // ============================================

  async approveRequest(
    env: HadesBindings,
    id: string,
    approvedBy: string,
    notes?: string
  ): Promise<ApprovalRequest> {
    const db = createDb(env.HADES_DB);

    const request = await this.getRequest(env, id);
    if (!request) {
      throw new NotFoundError(`Approval request with ID "${id}" not found`);
    }

    if (request.status !== "pending") {
      throw new ConflictError(`Request is already ${request.status}`);
    }

    if (new Date(request.expiresAt) < new Date()) {
      await this.expireRequest(env, id);
      throw new ConflictError("Request has expired");
    }

    const now = new Date().toISOString();

    await db
      .update(approvalRequests)
      .set({
        status: "approved",
        approvedBy,
        approvedAt: now,
      })
      .where(eq(approvalRequests.id, id));

    const updated = await this.getRequest(env, id);
    if (!updated) {
      throw new HadesError("Failed to retrieve updated request", "UPDATE_ERROR", 500);
    }

    logger.info(`Approval request approved: ${id} by ${approvedBy}`);

    // Notify requester
    await this.notifyApproved(env, updated, notes);

    return updated;
  }

  async rejectRequest(
    env: HadesBindings,
    id: string,
    rejectedBy: string,
    reason: string
  ): Promise<ApprovalRequest> {
    const db = createDb(env.HADES_DB);

    const request = await this.getRequest(env, id);
    if (!request) {
      throw new NotFoundError(`Approval request with ID "${id}" not found`);
    }

    if (request.status !== "pending") {
      throw new ConflictError(`Request is already ${request.status}`);
    }

    const now = new Date().toISOString();

    await db
      .update(approvalRequests)
      .set({
        status: "rejected",
        rejectedBy,
        rejectedAt: now,
        rejectionReason: reason,
      })
      .where(eq(approvalRequests.id, id));

    const updated = await this.getRequest(env, id);
    if (!updated) {
      throw new HadesError("Failed to retrieve updated request", "UPDATE_ERROR", 500);
    }

    logger.info(`Approval request rejected: ${id} by ${rejectedBy}`);

    // Notify requester
    await this.notifyRejected(env, updated, reason);

    return updated;
  }

  async cancelRequest(env: HadesBindings, id: string): Promise<ApprovalRequest> {
    const db = createDb(env.HADES_DB);

    const request = await this.getRequest(env, id);
    if (!request) {
      throw new NotFoundError(`Approval request with ID "${id}" not found`);
    }

    if (request.status !== "pending") {
      throw new ConflictError(`Cannot cancel a ${request.status} request`);
    }

    await db
      .update(approvalRequests)
      .set({ status: "cancelled" })
      .where(eq(approvalRequests.id, id));

    const updated = await this.getRequest(env, id);
    if (!updated) {
      throw new HadesError("Failed to retrieve updated request", "UPDATE_ERROR", 500);
    }

    logger.info(`Approval request cancelled: ${id}`);
    return updated;
  }

  async expireRequest(env: HadesBindings, id: string): Promise<ApprovalRequest> {
    const db = createDb(env.HADES_DB);

    await db
      .update(approvalRequests)
      .set({ status: "expired" })
      .where(eq(approvalRequests.id, id));

    const updated = await this.getRequest(env, id);
    if (!updated) {
      throw new HadesError("Failed to retrieve updated request", "UPDATE_ERROR", 500);
    }

    logger.info(`Approval request expired: ${id}`);
    return updated;
  }

  // ============================================
  // Escalation
  // ============================================

  async escalateRequest(env: HadesBindings, id: string): Promise<ApprovalRequest> {
    const db = createDb(env.HADES_DB);

    const request = await this.getRequest(env, id);
    if (!request) {
      throw new NotFoundError(`Approval request with ID "${id}" not found`);
    }

    if (request.status !== "pending") {
      throw new ConflictError(`Cannot escalate a ${request.status} request`);
    }

    const currentLevel = 0; // Would be fetched from DB
    const nextLevel = currentLevel + 1;
    const policy = this.escalationPolicies.get(nextLevel);

    if (!policy) {
      logger.warn(`No escalation policy for level ${nextLevel}`);
      return request;
    }

    await db
      .update(approvalRequests)
      .set({ escalationLevel: nextLevel })
      .where(eq(approvalRequests.id, id));

    logger.info(`Approval request escalated: ${id} to level ${nextLevel}`);

    // Notify escalated approvers
    await this.notifyEscalation(env, request, policy);

    const updated = await this.getRequest(env, id);
    if (!updated) {
      throw new HadesError("Failed to retrieve updated request", "UPDATE_ERROR", 500);
    }

    return updated;
  }

  // ============================================
  // Batch Operations
  // ============================================

  async processExpiredRequests(env: HadesBindings): Promise<number> {
    const db = createDb(env.HADES_DB);
    const now = new Date().toISOString();

    const expired = await db
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.status, "pending"), gte(approvalRequests.expiresAt, now)));

    // Note: This is a simplified version. In production, use proper date comparison
    let processed = 0;
    for (const row of expired) {
      if (new Date(row.expiresAt) < new Date()) {
        await this.expireRequest(env, row.id);
        processed++;
      }
    }

    if (processed > 0) {
      logger.info(`Processed ${processed} expired approval requests`);
    }

    return processed;
  }

  // ============================================
  // Notifications
  // ============================================

  private async notifyNewRequest(env: HadesBindings, request: ApprovalRequest): Promise<void> {
    logger.info(`Notification: New approval request ${request.id}`, {
      title: request.title,
      type: request.type,
      requestedBy: request.requestedBy,
    });
  }

  private async notifyApproved(env: HadesBindings, request: ApprovalRequest, notes?: string): Promise<void> {
    logger.info(`Notification: Approval request ${request.id} approved`, {
      title: request.title,
      approvedBy: request.approvedBy,
      notes,
    });
  }

  private async notifyRejected(env: HadesBindings, request: ApprovalRequest, reason: string): Promise<void> {
    logger.info(`Notification: Approval request ${request.id} rejected`, {
      title: request.title,
      rejectedBy: request.rejectedBy,
      reason,
    });
  }

  private async notifyEscalation(
    env: HadesBindings,
    request: ApprovalRequest,
    policy: EscalationPolicy
  ): Promise<void> {
    logger.info(`Notification: Approval request ${request.id} escalated to level ${policy.level}`, {
      title: request.title,
      approvers: policy.approvers,
      channels: policy.notifyChannels,
    });
  }

  // ============================================
  // Statistics
  // ============================================

  async getStats(env: HadesBindings): Promise<{
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
    cancelled: number;
    averageApprovalTime: number;
    byType: Record<string, number>;
  }> {
    const db = createDb(env.HADES_DB);
    const all = await db.select().from(approvalRequests);

    const byType: Record<string, number> = {};
    let totalApprovalTime = 0;
    let approvedCount = 0;

    for (const row of all) {
      byType[row.type] = (byType[row.type] || 0) + 1;

      if (row.approvedAt && row.createdAt) {
        const approvalTime = new Date(row.approvedAt).getTime() - new Date(row.createdAt).getTime();
        totalApprovalTime += approvalTime;
        approvedCount++;
      }
    }

    return {
      total: all.length,
      pending: all.filter((r) => r.status === "pending").length,
      approved: all.filter((r) => r.status === "approved").length,
      rejected: all.filter((r) => r.status === "rejected").length,
      expired: all.filter((r) => r.status === "expired").length,
      cancelled: all.filter((r) => r.status === "cancelled").length,
      averageApprovalTime: approvedCount > 0 ? totalApprovalTime / approvedCount : 0,
      byType,
    };
  }

  // ============================================
  // Helpers
  // ============================================

  private rowToRequest(row: Record<string, unknown>): ApprovalRequest {
    return {
      id: row.id as string,
      type: row.type as ApprovalType,
      title: row.title as string,
      description: row.description as string,
      metadata: JSON.parse((row.metadata as string) || "{}"),
      requestedBy: row.requestedBy as string,
      status: row.status as ApprovalStatus,
      createdAt: row.createdAt as string,
      expiresAt: row.expiresAt as string,
      approvedBy: (row.approvedBy as string) || undefined,
      approvedAt: (row.approvedAt as string) || undefined,
      rejectedBy: (row.rejectedBy as string) || undefined,
      rejectedAt: (row.rejectedAt as string) || undefined,
      rejectionReason: (row.rejectionReason as string) || undefined,
    };
  }

  private getDefaultExpiration(): string {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }
}

export const approvalManager = new ApprovalManager();
