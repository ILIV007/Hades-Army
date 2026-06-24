
/**
 * Agents Tests - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createMockEnv } from "./setup";
import { agentManager } from "../src/agents/manager";
import { builderAgent } from "../src/agents/builder";
import { reviewManager } from "../src/agents/reviewer";
import { createDb } from "../src/database/client";

describe("Agent Manager", () => {
  const env = createMockEnv();

  beforeEach(async () => {
    // Clean up agents table
    const db = createDb(env.HADES_DB);
    await db.prepare("DELETE FROM agents").run();
    await db.prepare("DELETE FROM agent_tasks").run();
  });

  it("should create a new agent", async () => {
    const db = createDb(env.HADES_DB);
    const agent = await agentManager.createAgent(db, {
      name: "Test Builder",
      type: "builder",
      priority: 8,
      capabilities: ["typescript", "react"],
      config: { maxConcurrentTasks: 5 },
    });

    expect(agent).toBeDefined();
    expect(agent.name).toBe("Test Builder");
    expect(agent.type).toBe("builder");
    expect(agent.priority).toBe(8);
    expect(agent.capabilities).toContain("typescript");
    expect(agent.status).toBe("active");
  });

  it("should get an agent by ID", async () => {
    const db = createDb(env.HADES_DB);
    const created = await agentManager.createAgent(db, {
      name: "Test Reviewer",
      type: "reviewer",
    });

    const fetched = await agentManager.getAgent(db, created.id);
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.name).toBe("Test Reviewer");
  });

  it("should return undefined for non-existent agent", async () => {
    const db = createDb(env.HADES_DB);
    const agent = await agentManager.getAgent(db, "non-existent-id");
    expect(agent).toBeUndefined();
  });

  it("should get all agents", async () => {
    const db = createDb(env.HADES_DB);
    await agentManager.createAgent(db, { name: "Agent 1", type: "builder" });
    await agentManager.createAgent(db, { name: "Agent 2", type: "reviewer" });
    await agentManager.createAgent(db, { name: "Agent 3", type: "tester" });

    const agents = await agentManager.getAllAgents(db);
    expect(agents).toHaveLength(3);
  });

  it("should update an agent", async () => {
    const db = createDb(env.HADES_DB);
    const created = await agentManager.createAgent(db, {
      name: "Original Name",
      type: "builder",
    });

    const updated = await agentManager.updateAgent(db, created.id, {
      name: "Updated Name",
      priority: 10,
    });

    expect(updated).toBeDefined();
    expect(updated?.name).toBe("Updated Name");
    expect(updated?.priority).toBe(10);
  });

  it("should remove an agent", async () => {
    const db = createDb(env.HADES_DB);
    const created = await agentManager.createAgent(db, {
      name: "To Remove",
      type: "builder",
    });

    await agentManager.removeAgent(db, created.id);
    const fetched = await agentManager.getAgent(db, created.id);
    expect(fetched).toBeUndefined();
  });

  it("should execute a task on an agent", async () => {
    const db = createDb(env.HADES_DB);
    const created = await agentManager.createAgent(db, {
      name: "Task Executor",
      type: "builder",
    });

    const result = await agentManager.executeTask(db, created.id, "build", {
      specification: "test spec",
    });

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it("should throw error for inactive agent", async () => {
    const db = createDb(env.HADES_DB);
    const created = await agentManager.createAgent(db, {
      name: "Inactive Agent",
      type: "builder",
    });

    await agentManager.pauseAgent(db, created.id);

    await expect(
      agentManager.executeTask(db, created.id, "build", {})
    ).rejects.toThrow("Agent is not active");
  });

  it("should pause and resume an agent", async () => {
    const db = createDb(env.HADES_DB);
    const created = await agentManager.createAgent(db, {
      name: "Toggle Agent",
      type: "builder",
    });

    await agentManager.pauseAgent(db, created.id);
    let fetched = await agentManager.getAgent(db, created.id);
    expect(fetched?.status).toBe("paused");

    await agentManager.resumeAgent(db, created.id);
    fetched = await agentManager.getAgent(db, created.id);
    expect(fetched?.status).toBe("active");
  });

  it("should get agent statistics", async () => {
    const db = createDb(env.HADES_DB);
    const created = await agentManager.createAgent(db, {
      name: "Stats Agent",
      type: "builder",
    });

    const stats = await agentManager.getAgentStats(db, created.id);
    expect(stats).toBeDefined();
    expect(stats.totalTasks).toBeDefined();
    expect(stats.successRate).toBeDefined();
  });
});

describe("Builder Agent", () => {
  it("should build a task", async () => {
    const result = await builderAgent.build({
      id: "test-build-1",
      specification: "Create a simple function",
      language: "typescript",
      requirements: ["must be typed", "must handle errors"],
    });

    expect(result).toBeDefined();
    expect(result.taskId).toBe("test-build-1");
    expect(result.language).toBe("typescript");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.files).toBeDefined();
  });

  it("should analyze requirements", async () => {
    const requirements = await builderAgent.analyzeRequirements(
      "- Must use TypeScript\n- Must handle errors\n- Must be tested"
    );

    expect(requirements).toHaveLength(3);
    expect(requirements).toContain("Must use TypeScript");
  });

  it("should estimate complexity", async () => {
    const estimate = await builderAgent.estimateComplexity({
      id: "test",
      specification: "A".repeat(500),
      language: "typescript",
      requirements: ["req1", "req2"],
    });

    expect(estimate.lines).toBeGreaterThan(0);
    expect(estimate.time).toBeGreaterThan(0);
    expect(estimate.risk).toBeDefined();
  });
});

describe("Reviewer Agent", () => {
  it("should perform a review", async () => {
    const review = await reviewManager.review({
      id: "test-review-1",
      target: "test.ts",
      code: `function test() { console.log("hello"); }`,
      type: "code",
    });

    expect(review).toBeDefined();
    expect(review.target).toBe("test.ts");
    expect(review.overallScore).toBeGreaterThanOrEqual(0);
    expect(review.overallScore).toBeLessThanOrEqual(100);
    expect(review.findings).toBeDefined();
    expect(review.summary).toBeDefined();
  });

  it("should detect console.log in syntax check", async () => {
    const review = await reviewManager.review({
      id: "test-review-2",
      target: "test.ts",
      code: `function test() { console.log("hello"); }`,
      type: "code",
    });

    const syntaxFindings = review.findings.filter((f) => f.category === "syntax");
    expect(syntaxFindings.length).toBeGreaterThan(0);
    expect(syntaxFindings[0].message).toContain("console.log");
  });

  it("should detect security issues", async () => {
    const review = await reviewManager.review({
      id: "test-review-3",
      target: "test.ts",
      code: `eval(userInput);`,
      type: "security",
    });

    const securityFindings = review.findings.filter((f) => f.category === "security");
    expect(securityFindings.length).toBeGreaterThan(0);
  });

  it("should generate summary", async () => {
    const review = await reviewManager.review({
      id: "test-review-4",
      target: "test.ts",
      code: `function test() {}`,
      type: "code",
    });

    expect(review.summary).toContain("Score");
  });
});
