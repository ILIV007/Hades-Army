
/**
 * Permission Service - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Role-based access control (RBAC):
 * - Role definitions
 * - Permission assignments
 * - Resource access control
 * - Hierarchical permissions
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";

// ============================================
// Types
// ============================================

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  parentRole?: string;
  createdAt: string;
}

export interface Permission {
  id: string;
  resource: string;
  action: string;
  description: string;
}

export interface UserRole {
  userId: string;
  roleId: string;
  assignedAt: string;
  assignedBy: string;
}

// ============================================
// Default Permissions
// ============================================

const DEFAULT_PERMISSIONS: Permission[] = [
  { id: "perm_agents_read", resource: "agents", action: "read", description: "View agents" },
  { id: "perm_agents_write", resource: "agents", action: "write", description: "Create/update agents" },
  { id: "perm_agents_delete", resource: "agents", action: "delete", description: "Delete agents" },
  { id: "perm_agents_execute", resource: "agents", action: "execute", description: "Execute agent tasks" },
  { id: "perm_reviews_read", resource: "reviews", action: "read", description: "View reviews" },
  { id: "perm_reviews_write", resource: "reviews", action: "write", description: "Create reviews" },
  { id: "perm_reviews_approve", resource: "reviews", action: "approve", description: "Approve/reject reviews" },
  { id: "perm_approvals_read", resource: "approvals", action: "read", description: "View approval requests" },
  { id: "perm_approvals_write", resource: "approvals", action: "write", description: "Create approval requests" },
  { id: "perm_approvals_approve", resource: "approvals", action: "approve", description: "Approve/reject requests" },
  { id: "perm_memory_read", resource: "memory", action: "read", description: "View memory entries" },
  { id: "perm_memory_write", resource: "memory", action: "write", description: "Create/update memory entries" },
  { id: "perm_memory_delete", resource: "memory", action: "delete", description: "Delete memory entries" },
  { id: "perm_rollback_read", resource: "rollback", action: "read", description: "View snapshots" },
  { id: "perm_rollback_write", resource: "rollback", action: "write", description: "Create snapshots" },
  { id: "perm_rollback_execute", resource: "rollback", action: "execute", description: "Execute rollback" },
  { id: "perm_prompts_read", resource: "prompts", action: "read", description: "View prompt templates" },
  { id: "perm_prompts_write", resource: "prompts", action: "write", description: "Create/update prompts" },
  { id: "perm_prompts_delete", resource: "prompts", action: "delete", description: "Delete prompts" },
  { id: "perm_config_read", resource: "config", action: "read", description: "View configuration" },
  { id: "perm_config_write", resource: "config", action: "write", description: "Update configuration" },
  { id: "perm_deploy", resource: "deploy", action: "execute", description: "Deploy application" },
  { id: "perm_logs_read", resource: "logs", action: "read", description: "View logs" },
  { id: "perm_health_read", resource: "health", action: "read", description: "View health status" },
  { id: "perm_metrics_read", resource: "metrics", action: "read", description: "View metrics" },
  { id: "perm_alerts_read", resource: "alerts", action: "read", description: "View alerts" },
  { id: "perm_alerts_write", resource: "alerts", action: "write", description: "Manage alerts" },
  { id: "perm_security_read", resource: "security", action: "read", description: "View security reports" },
  { id: "perm_security_write", resource: "security", action: "write", description: "Manage security policies" },
  { id: "perm_audit_read", resource: "audit", action: "read", description: "View audit logs" },
  { id: "perm_users_read", resource: "users", action: "read", description: "View users" },
  { id: "perm_users_write", resource: "users", action: "write", description: "Manage users" },
  { id: "perm_admin", resource: "*", action: "*", description: "Full admin access" },
];

// ============================================
// Default Roles
// ============================================

const DEFAULT_ROLES: Omit<Role, "id" | "createdAt">[] = [
  {
    name: "admin",
    description: "Full system access",
    permissions: ["perm_admin"],
  },
  {
    name: "operator",
    description: "Can manage agents, reviews, and deployments",
    permissions: [
      "perm_agents_read", "perm_agents_write", "perm_agents_execute",
      "perm_reviews_read", "perm_reviews_write", "perm_reviews_approve",
      "perm_approvals_read", "perm_approvals_write", "perm_approvals_approve",
      "perm_memory_read", "perm_memory_write",
      "perm_rollback_read", "perm_rollback_write", "perm_rollback_execute",
      "perm_prompts_read", "perm_prompts_write",
      "perm_deploy",
      "perm_logs_read", "perm_health_read", "perm_metrics_read",
      "perm_alerts_read", "perm_alerts_write",
      "perm_security_read",
      "perm_audit_read",
    ],
  },
  {
    name: "developer",
    description: "Can create reviews and manage memory",
    permissions: [
      "perm_agents_read",
      "perm_reviews_read", "perm_reviews_write",
      "perm_approvals_read",
      "perm_memory_read", "perm_memory_write",
      "perm_prompts_read", "perm_prompts_write",
      "perm_health_read", "perm_metrics_read",
      "perm_alerts_read",
    ],
  },
  {
    name: "viewer",
    description: "Read-only access",
    permissions: [
      "perm_agents_read",
      "perm_reviews_read",
      "perm_approvals_read",
      "perm_memory_read",
      "perm_rollback_read",
      "perm_prompts_read",
      "perm_health_read", "perm_metrics_read",
      "perm_alerts_read",
    ],
  },
  {
    name: "api",
    description: "API access with limited permissions",
    permissions: [
      "perm_agents_read", "perm_agents_execute",
      "perm_reviews_read", "perm_reviews_write",
      "perm_memory_read", "perm_memory_write",
      "perm_health_read",
    ],
  },
];

// ============================================
// Permission Service
// ============================================

export class PermissionService {
  private roles: Map<string, Role> = new Map();
  private permissions: Map<string, Permission> = new Map();
  private userRoles: Map<string, string[]> = new Map(); // userId -> roleIds

  constructor() {
    this.initializeDefaults();
  }

  private initializeDefaults(): void {
    // Register default permissions
    for (const perm of DEFAULT_PERMISSIONS) {
      this.permissions.set(perm.id, perm);
    }

    // Register default roles
    for (const roleDef of DEFAULT_ROLES) {
      const role: Role = {
        ...roleDef,
        id: generateId("role"),
        createdAt: new Date().toISOString(),
      };
      this.roles.set(role.id, role);
      // Also index by name for easy lookup
      this.roles.set(role.name, role);
    }
  }

  // ============================================
  // Role Management
  // ============================================

  createRole(role: Omit<Role, "id" | "createdAt">): Role {
    const newRole: Role = {
      ...role,
      id: generateId("role"),
      createdAt: new Date().toISOString(),
    };

    this.roles.set(newRole.id, newRole);
    this.roles.set(newRole.name, newRole);

    logger.info(`Role created: ${newRole.name} (${newRole.id})`);
    return newRole;
  }

  getRole(idOrName: string): Role | undefined {
    return this.roles.get(idOrName);
  }

  getAllRoles(): Role[] {
    const seen = new Set<string>();
    const roles: Role[] = [];

    for (const role of this.roles.values()) {
      if (!seen.has(role.id)) {
        seen.add(role.id);
        roles.push(role);
      }
    }

    return roles;
  }

  updateRole(roleId: string, updates: Partial<Omit<Role, "id" | "createdAt">>): Role | undefined {
    const role = this.roles.get(roleId);
    if (!role) return undefined;

    const updated = { ...role, ...updates, updatedAt: new Date().toISOString() };
    this.roles.set(roleId, updated);
    this.roles.set(updated.name, updated);

    logger.info(`Role updated: ${updated.name}`);
    return updated;
  }

  deleteRole(roleId: string): boolean {
    const role = this.roles.get(roleId);
    if (!role) return false;

    this.roles.delete(roleId);
    this.roles.delete(role.name);

    // Remove role from all users
    for (const [userId, roleIds] of this.userRoles) {
      const index = roleIds.indexOf(roleId);
      if (index >= 0) {
        roleIds.splice(index, 1);
        if (roleIds.length === 0) {
          this.userRoles.delete(userId);
        }
      }
    }

    logger.info(`Role deleted: ${role.name}`);
    return true;
  }

  // ============================================
  // User Role Assignment
  // ============================================

  assignRole(userId: string, roleIdOrName: string): boolean {
    const role = this.roles.get(roleIdOrName);
    if (!role) {
      logger.warn(`Role not found: ${roleIdOrName}`);
      return false;
    }

    const userRoleIds = this.userRoles.get(userId) || [];
    if (!userRoleIds.includes(role.id)) {
      userRoleIds.push(role.id);
      this.userRoles.set(userId, userRoleIds);
      logger.info(`Role "${role.name}" assigned to user ${userId}`);
    }

    return true;
  }

  removeRole(userId: string, roleIdOrName: string): boolean {
    const role = this.roles.get(roleIdOrName);
    if (!role) return false;

    const userRoleIds = this.userRoles.get(userId);
    if (!userRoleIds) return false;

    const index = userRoleIds.indexOf(role.id);
    if (index >= 0) {
      userRoleIds.splice(index, 1);
      if (userRoleIds.length === 0) {
        this.userRoles.delete(userId);
      }
      logger.info(`Role "${role.name}" removed from user ${userId}`);
      return true;
    }

    return false;
  }

  getUserRoles(userId: string): Role[] {
    const roleIds = this.userRoles.get(userId) || [];
    return roleIds.map((id) => this.roles.get(id)).filter((r): r is Role => r !== undefined);
  }

  // ============================================
  // Permission Checking
  // ============================================

  async checkPermission(userId: string, resource: string, action: string): Promise<boolean> {
    const userRoles = this.getUserRoles(userId);

    for (const role of userRoles) {
      // Check for admin permission
      if (role.permissions.includes("perm_admin")) {
        return true;
      }

      // Check for wildcard resource permission
      const wildcardPerm = `perm_${resource}_*`;
      if (role.permissions.includes(wildcardPerm)) {
        return true;
      }

      // Check specific permission
      const specificPerm = `perm_${resource}_${action}`;
      if (role.permissions.includes(specificPerm)) {
        return true;
      }
    }

    return false;
  }

  async checkPermissions(userId: string, checks: Array<{ resource: string; action: string }>): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const check of checks) {
      const key = `${check.resource}:${check.action}`;
      results[key] = await this.checkPermission(userId, check.resource, check.action);
    }

    return results;
  }

  getUserPermissions(userId: string): string[] {
    const userRoles = this.getUserRoles(userId);
    const permissions = new Set<string>();

    for (const role of userRoles) {
      for (const permId of role.permissions) {
        const perm = this.permissions.get(permId);
        if (perm) {
          permissions.add(`${perm.resource}:${perm.action}`);
        }
      }
    }

    return Array.from(permissions);
  }

  // ============================================
  // Statistics
  // ============================================

  getStats(): {
    totalRoles: number;
    totalPermissions: number;
    totalUserAssignments: number;
  } {
    return {
      totalRoles: this.getAllRoles().length,
      totalPermissions: this.permissions.size,
      totalUserAssignments: this.userRoles.size,
    };
  }
}

export const permissionService = new PermissionService();
