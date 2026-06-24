/**
 * Security Tests - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createMockEnv } from "./setup";
import { securityManager } from "../src/security/manager";
import { secretScanner } from "../src/security/secret-scanner";
import { permissionService } from "../src/security/permissions";
import { auditService } from "../src/security/audit";

describe("Security Manager", () => {
  const env = createMockEnv();

  beforeEach(() => {
    // Reset security state
  });

  it("should scan code for secrets", async () => {
    const code = `
      const apiKey = "sk-abcdefghijklmnopqrstuvwxyz123456";
      const password = "super_secret_password_123";
    `;

    const result = await securityManager.scanCode(code, "test.ts");
    expect(result).toBeDefined();
    expect(result.findings).toBeDefined();
    expect(result.scannedAt).toBeDefined();
  });

  it("should detect AWS access keys", async () => {
    const code = `const key = "AKIAIOSFODNN7EXAMPLE";`;
    const result = await secretScanner.scan(code, "test.ts");
    const awsFindings = result.filter((f) => f.message.includes("AWS"));
    expect(awsFindings.length).toBeGreaterThan(0);
  });

  it("should detect GitHub tokens", async () => {
    const code = `const token = "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";`;
    const result = await secretScanner.scan(code, "test.ts");
    const githubFindings = result.filter((f) => f.message.includes("GitHub"));
    expect(githubFindings.length).toBeGreaterThan(0);
  });

  it("should detect private keys", async () => {
    const code = `const key = "-----BEGIN RSA PRIVATE KEY-----";`;
    const result = await secretScanner.scan(code, "test.ts");
    const keyFindings = result.filter((f) => f.message.includes("Private key"));
    expect(keyFindings.length).toBeGreaterThan(0);
  });

  it("should pass clean code", async () => {
    const code = `
      function hello() {
        return "world";
      }
    `;
    const result = await securityManager.scanCode(code, "clean.ts");
    expect(result.passed).toBe(true);
  });

  it("should register security policies", () => {
    const policies = securityManager.getAllPolicies();
    expect(policies.length).toBeGreaterThan(0);
    expect(policies.some((p) => p.name === "Secret Scanning")).toBe(true);
  });

  it("should generate security report", async () => {
    const report = await securityManager.generateReport(env);
    expect(report).toBeDefined();
    expect(report.timestamp).toBeDefined();
    expect(report.overallStatus).toBeDefined();
    expect(report.findings).toBeDefined();
    expect(report.policies).toBeDefined();
    expect(report.recommendations).toBeDefined();
  });

  it("should check permissions", async () => {
    const hasPermission = await securityManager.checkPermission(
      env,
      "user-123",
      "agents",
      "read"
    );
    expect(typeof hasPermission).toBe("boolean");
  });

  it("should log audit events", async () => {
    const event = await auditService.log(env, {
      action: "TEST_ACTION",
      userId: "test-user",
      resource: "agents",
      details: { test: true },
    });

    expect(event).toBeDefined();
    expect(event.id).toBeDefined();
    expect(event.action).toBe("TEST_ACTION");
    expect(event.userId).toBe("test-user");
    expect(event.success).toBe(true);
  });

  it("should get audit logs", async () => {
    await auditService.log(env, {
      action: "TEST_ACTION_1",
      userId: "user-1",
    });
    await auditService.log(env, {
      action: "TEST_ACTION_2",
      userId: "user-2",
    });

    const logs = await auditService.getLogs(env, { limit: 10 });
    expect(logs).toBeDefined();
    expect(logs.length).toBeGreaterThan(0);
  });

  it("should generate audit summary", async () => {
    const summary = await auditService.getSummary(env);
    expect(summary).toBeDefined();
    expect(summary.totalEvents).toBeDefined();
    expect(summary.successfulEvents).toBeDefined();
    expect(summary.failedEvents).toBeDefined();
    expect(summary.uniqueUsers).toBeDefined();
    expect(summary.uniqueActions).toBeDefined();
  });

  it("should manage roles and permissions", () => {
    const roles = permissionService.getAllRoles();
    expect(roles.length).toBeGreaterThan(0);

    const adminRole = permissionService.getRole("admin");
    expect(adminRole).toBeDefined();
    expect(adminRole?.permissions).toContain("perm_admin");
  });

  it("should assign and check user roles", async () => {
    permissionService.assignRole("test-user", "developer");
    const roles = permissionService.getUserRoles("test-user");
    expect(roles.length).toBeGreaterThan(0);

    const hasPerm = await permissionService.checkPermission(
      "test-user",
      "reviews",
      "write"
    );
    expect(hasPerm).toBe(true);
  });

  it("should get security stats", () => {
    const stats = securityManager.getStats();
    expect(stats).toBeDefined();
    expect(stats.totalPolicies).toBeGreaterThan(0);
    expect(stats.totalScans).toBeDefined();
  });

  it("should detect eval usage", async () => {
    const code = `eval(userInput);`;
    const result = await securityManager.scanCode(code, "dangerous.ts");
    const evalFindings = result.findings.filter((f) =>
      f.message.includes("eval()")
    );
    expect(evalFindings.length).toBeGreaterThan(0);
  });

  it("should detect innerHTML usage", async () => {
    const code = `element.innerHTML = userContent;`;
    const result = await securityManager.scanCode(code, "xss.ts");
    const xssFindings = result.findings.filter((f) =>
      f.message.includes("innerHTML")
    );
    expect(xssFindings.length).toBeGreaterThan(0);
  });

  it("should detect SQL injection patterns", async () => {
    const code = `db.query("SELECT * FROM users WHERE id = " + req.params.id);`;
    const result = await securityManager.scanCode(code, "sql.ts");
    const sqlFindings = result.findings.filter((f) =>
      f.category === "sql_injection"
    );
    expect(sqlFindings.length).toBeGreaterThan(0);
  });

  it("should detect insecure randomness", async () => {
    const code = `const token = Math.random().toString();`;
    const result = await securityManager.scanCode(code, "crypto.ts");
    const cryptoFindings = result.findings.filter((f) =>
      f.message.includes("Math.random()")
    );
    expect(cryptoFindings.length).toBeGreaterThan(0);
  });

  it("should handle custom secret patterns", async () => {
    secretScanner.addPattern({
      name: "Custom Token",
      severity: "high",
      pattern: /custom_token_[a-z0-9]{32}/g,
      description: "Custom token detected",
      remediation: "Move to environment variables",
    });

    const code = `const token = "custom_token_abcdefghijklmnopqrstuvwxyz12";`;
    const result = await secretScanner.scan(code, "custom.ts");
    const customFindings = result.filter((f) =>
      f.message.includes("Custom token")
    );
    expect(customFindings.length).toBeGreaterThan(0);
  });

  it("should generate compliance report", async () => {
    const report = await auditService.generateComplianceReport(env, {
      from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      to: new Date().toISOString(),
      includeFailed: true,
    });

    expect(report).toBeDefined();
    expect(report.period).toBeDefined();
    expect(report.summary).toBeDefined();
    expect(report.failedEvents).toBeDefined();
    expect(report.suspiciousEvents).toBeDefined();
  });
});
