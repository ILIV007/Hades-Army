
/**
 * Security Manager - Cloudflare Workers Edition
 * Hades Army v0.8.0
 *
 * Central security management:
 * - Secret scanning
 * - Permission enforcement
 * - Audit logging
 * - Security policies
 * - Threat detection
 */

import { logger } from "../utils/logger";
import { generateId, sha256 } from "../utils/helpers";
import { secretScanner } from "./secret-scanner";
import { auditService } from "./audit";
import { permissionService } from "./permissions";
import type { HadesBindings } from "../types";

// ============================================
// Types
// ============================================

export interface SecurityPolicy {
  id: string;
  name: string;
  type: "secret_scanning" | "permission" | "audit" | "rate_limit" | "ip_filter";
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SecurityScanResult {
  passed: boolean;
  findings: SecurityFinding[];
  scannedAt: string;
  duration: number;
}

export interface SecurityFinding {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  message: string;
  file?: string;
  line?: number;
  remediation?: string;
}

export interface SecurityReport {
  timestamp: string;
  overallStatus: "secure" | "warning" | "critical";
  findings: SecurityFinding[];
  policies: SecurityPolicy[];
  recommendations: string[];
}

// ============================================
// Security Manager
// ============================================

export class SecurityManager {
  private policies: Map<string, SecurityPolicy> = new Map();
  private scanHistory: SecurityScanResult[] = [];

  constructor() {
    this.registerDefaultPolicies();
  }

  // ============================================
  // Policy Management
  // ============================================

  registerPolicy(policy: Omit<SecurityPolicy, "id" | "createdAt" | "updatedAt">): SecurityPolicy {
    const fullPolicy: SecurityPolicy = {
      ...policy,
      id: generateId("policy"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.policies.set(fullPolicy.id, fullPolicy);
    logger.info(`Security policy registered: ${fullPolicy.name} (${fullPolicy.id})`);
    return fullPolicy;
  }

  updatePolicy(policyId: string, updates: Partial<Omit<SecurityPolicy, "id" | "createdAt">>): SecurityPolicy | undefined {
    const policy = this.policies.get(policyId);
    if (!policy) return undefined;

    const updated = {
      ...policy,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.policies.set(policyId, updated);
    logger.info(`Security policy updated: ${updated.name}`);
    return updated;
  }

  removePolicy(policyId: string): boolean {
    const removed = this.policies.delete(policyId);
    if (removed) {
      logger.info(`Security policy removed: ${policyId}`);
    }
    return removed;
  }

  getPolicy(policyId: string): SecurityPolicy | undefined {
    return this.policies.get(policyId);
  }

  getAllPolicies(): SecurityPolicy[] {
    return Array.from(this.policies.values());
  }

  getPoliciesByType(type: SecurityPolicy["type"]): SecurityPolicy[] {
    return this.getAllPolicies().filter((p) => p.type === type);
  }

  private registerDefaultPolicies(): void {
    this.registerPolicy({
      name: "Secret Scanning",
      type: "secret_scanning",
      enabled: true,
      config: {
        patterns: ["api_key", "password", "token", "secret", "private_key"],
        blockOnFind: true,
      },
    });

    this.registerPolicy({
      name: "Admin Permission Enforcement",
      type: "permission",
      enabled: true,
      config: {
        requireAuth: true,
        adminOnlyEndpoints: ["/api/v1/config", "/api/v1/deploy", "/api/v1/rollback"],
      },
    });

    this.registerPolicy({
      name: "Audit Logging",
      type: "audit",
      enabled: true,
      config: {
        logAllRequests: true,
        logAuthEvents: true,
        logDataChanges: true,
        retentionDays: 90,
      },
    });

    this.registerPolicy({
      name: "Rate Limiting",
      type: "rate_limit",
      enabled: true,
      config: {
        defaultLimit: 100,
        adminLimit: 1000,
        windowMs: 60000,
      },
    });

    this.registerPolicy({
      name: "IP Filtering",
      type: "ip_filter",
      enabled: false,
      config: {
        whitelist: [],
        blacklist: [],
      },
    });
  }

  // ============================================
  // Security Scanning
  // ============================================

  async scanCode(code: string, filename?: string): Promise<SecurityScanResult> {
    const startTime = Date.now();
    const findings: SecurityFinding[] = [];

    // Run secret scanner
    const secretFindings = await secretScanner.scan(code, filename);
    findings.push(...secretFindings);

    // Check for other security issues
    const additionalFindings = this.scanForSecurityIssues(code, filename);
    findings.push(...additionalFindings);

    const passed = findings.filter((f) => f.severity === "critical" || f.severity === "high").length === 0;
    const duration = Date.now() - startTime;

    const result: SecurityScanResult = {
      passed,
      findings,
      scannedAt: new Date().toISOString(),
      duration,
    };

    this.scanHistory.push(result);
    if (this.scanHistory.length > 100) {
      this.scanHistory.shift();
    }

    logger.info(`Security scan completed: ${passed ? "PASSED" : "FAILED"} (${findings.length} findings)`);
    return result;
  }

  async scanRepository(env: HadesBindings, owner: string, repo: string): Promise<SecurityScanResult> {
    // In production, this would fetch files from GitHub and scan them
    logger.info(`Repository scan initiated: ${owner}/${repo}`);

    return {
      passed: true,
      findings: [],
      scannedAt: new Date().toISOString(),
      duration: 0,
    };
  }

  private scanForSecurityIssues(code: string, filename?: string): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    // Check for eval usage
    if (/eval\s*\(/.test(code)) {
      findings.push({
        id: generateId("finding"),
        severity: "high",
        category: "code_injection",
        message: "eval() usage detected - potential code injection risk",
        file: filename,
        remediation: "Replace eval() with safer alternatives like JSON.parse() or Function constructor",
      });
    }

    // Check for innerHTML
    if (/innerHTML\s*=/.test(code)) {
      findings.push({
        id: generateId("finding"),
        severity: "high",
        category: "xss",
        message: "innerHTML assignment detected - potential XSS risk",
        file: filename,
        remediation: "Use textContent or createElement instead of innerHTML",
      });
    }

    // Check for hardcoded URLs with credentials
    if (/https?:\/\/[^:]+:[^@]+@/.test(code)) {
      findings.push({
        id: generateId("finding"),
        severity: "critical",
        category: "credential_exposure",
        message: "URL with embedded credentials detected",
        file: filename,
        remediation: "Use environment variables or secret management for credentials",
      });
    }

    // Check for SQL injection patterns
    if (/(SELECT|INSERT|UPDATE|DELETE).*\+.*req\./i.test(code)) {
      findings.push({
        id: generateId("finding"),
        severity: "critical",
        category: "sql_injection",
        message: "Potential SQL injection - string concatenation with user input",
        file: filename,
        remediation: "Use parameterized queries or ORM methods",
      });
    }

    // Check for insecure randomness
    if (/Math\.random\(\)/.test(code)) {
      findings.push({
        id: generateId("finding"),
        severity: "medium",
        category: "cryptography",
        message: "Math.random() used - not cryptographically secure",
        file: filename,
        remediation: "Use crypto.getRandomValues() for security-sensitive operations",
      });
    }

    return findings;
  }

  // ============================================
  // Permission Enforcement
  // ============================================

  async checkPermission(
    env: HadesBindings,
    userId: string,
    resource: string,
    action: string
  ): Promise<boolean> {
    const hasPermission = await permissionService.checkPermission(userId, resource, action);

    await auditService.log(env, {
      action: "PERMISSION_CHECK",
      userId,
      resource,
      details: { action, result: hasPermission },
    });

    return hasPermission;
  }

  async requirePermission(
    env: HadesBindings,
    userId: string,
    resource: string,
    action: string
  ): Promise<void> {
    const hasPermission = await this.checkPermission(env, userId, resource, action);
    if (!hasPermission) {
      throw new Error(`Permission denied: ${action} on ${resource}`);
    }
  }

  // ============================================
  // Audit
  // ============================================

  async logAuditEvent(
    env: HadesBindings,
    event: {
      action: string;
      userId: string;
      resource?: string;
      details?: Record<string, unknown>;
    }
  ): Promise<void> {
    await auditService.log(env, event);
  }

  async getAuditLog(env: HadesBindings, options?: { userId?: string; action?: string; limit?: number }): Promise<unknown[]> {
    return auditService.getLogs(env, options);
  }

  // ============================================
  // Reporting
  // ============================================

  async generateReport(env: HadesBindings): Promise<SecurityReport> {
    const policies = this.getAllPolicies();
    const findings: SecurityFinding[] = [];
    const recommendations: string[] = [];

    // Check policy status
    const disabledPolicies = policies.filter((p) => !p.enabled);
    if (disabledPolicies.length > 0) {
      recommendations.push(`${disabledPolicies.length} security policies are disabled`);
    }

    // Check for critical findings in recent scans
    const recentScans = this.scanHistory.slice(-10);
    for (const scan of recentScans) {
      findings.push(...scan.findings);
    }

    const criticalFindings = findings.filter((f) => f.severity === "critical").length;
    const highFindings = findings.filter((f) => f.severity === "high").length;

    let overallStatus: SecurityReport["overallStatus"] = "secure";
    if (criticalFindings > 0) {
      overallStatus = "critical";
    } else if (highFindings > 0) {
      overallStatus = "warning";
    }

    return {
      timestamp: new Date().toISOString(),
      overallStatus,
      findings,
      policies,
      recommendations,
    };
  }

  // ============================================
  // Statistics
  // ============================================

  getStats(): {
    totalPolicies: number;
    enabledPolicies: number;
    totalScans: number;
    passedScans: number;
    failedScans: number;
    totalFindings: number;
  } {
    return {
      totalPolicies: this.policies.size,
      enabledPolicies: this.getAllPolicies().filter((p) => p.enabled).length,
      totalScans: this.scanHistory.length,
      passedScans: this.scanHistory.filter((s) => s.passed).length,
      failedScans: this.scanHistory.filter((s) => !s.passed).length,
      totalFindings: this.scanHistory.reduce((sum, s) => sum + s.findings.length, 0),
    };
  }
}

export const securityManager = new SecurityManager();
