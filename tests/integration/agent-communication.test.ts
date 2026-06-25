/**
 * Integration Tests: Agent Communication Protocol - Cloudflare Workers Edition
 * Hades Army v0.9.0
 *
 * Section 10: Testing & Stability
 *
 * Tests the structured message protocol:
 *   - Manager → Builder
 *   - Builder → Reviewer
 *   - Reviewer → Manager
 *   - Validation rules
 *   - Audit log
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentMessageBuilder,
  validateMessage,
  deliver,
  agentMessageLog,
  type AgentMessage,
} from "../../src/orchestration/agent-communication";

describe("Agent Communication Protocol", () => {
  beforeEach(() => {
    agentMessageLog.clear();
  });

  describe("Message builders", () => {
    it("should build ManagerToBuilder message with correct from/to", () => {
      const msg = AgentMessageBuilder.managerToBuilder({
        taskId: "task-1",
        projectId: "proj-1",
        objective: "Add login page",
        repositoryContext: {
          repositoryId: "r1",
          fullName: "owner/repo",
          defaultBranch: "main",
          targetBranch: "hades/task-1",
          architecture: { languages: ["TypeScript"], frameworks: ["Hono"], style: "workers", conventions: [] },
          relevantFiles: [],
        },
        memoryContext: {
          projectMemory: { architecture: null, roadmap: null, conventions: [] },
          relevantDecisions: [],
          pastFailures: [],
          knowledgeNotes: [],
        },
      });

      expect(msg.kind).toBe("MANAGER_TO_BUILDER");
      expect(msg.from).toBe("manager");
      expect(msg.to).toBe("builder");
      expect(msg.taskId).toBe("task-1");
      expect(msg.status).toBe("sent");
    });

    it("should build BuilderToReviewer message", () => {
      const msg = AgentMessageBuilder.builderToReviewer({
        taskId: "task-1",
        patch: { format: "new_file", content: "code", baseSha: "abc" },
        changedFiles: [{ path: "src/x.ts", status: "added", additions: 10, deletions: 0 }],
        rationale: "implements login",
        confidence: 0.85,
        estimatedRisk: "low",
      });

      expect(msg.kind).toBe("BUILDER_TO_REVIEWER");
      expect(msg.from).toBe("builder");
      expect(msg.to).toBe("reviewer");
    });

    it("should build ReviewerToManager message", () => {
      const msg = AgentMessageBuilder.reviewerToManager({
        taskId: "task-1",
        status: "approved",
        issues: [],
        recommendation: "looks good",
        score: 85,
      });

      expect(msg.kind).toBe("REVIEWER_TO_MANAGER");
      expect(msg.from).toBe("reviewer");
      expect(msg.to).toBe("manager");
    });

    it("should build ManagerToReviewer message", () => {
      const msg = AgentMessageBuilder.managerToReviewer({
        taskId: "task-arch",
        projectId: "proj-1",
        reviewType: "architecture",
        target: "src/",
        context: {},
      });

      expect(msg.kind).toBe("MANAGER_TO_REVIEWER");
      expect(msg.from).toBe("manager");
      expect(msg.to).toBe("reviewer");
    });

    it("should build ManagerToBuilderAck message", () => {
      const msg = AgentMessageBuilder.managerToBuilderAck({
        taskId: "task-1",
        action: "proceed",
      });

      expect(msg.kind).toBe("MANAGER_TO_BUILDER_ACK");
      expect(msg.from).toBe("manager");
      expect(msg.to).toBe("builder");
    });

    it("should build System message", () => {
      const msg = AgentMessageBuilder.system({
        taskId: "task-1",
        event: "timeout",
        reason: "Builder took too long",
      });

      expect(msg.kind).toBe("SYSTEM");
      expect(msg.from).toBe("system");
      expect(msg.to).toBe("manager");
    });
  });

  describe("Validation", () => {
    it("should reject same from and to", () => {
      const msg: AgentMessage = {
        id: "msg-1",
        kind: "MANAGER_TO_BUILDER",
        from: "manager",
        to: "manager", // wrong!
        taskId: "task-1",
        payload: {},
        status: "sent",
        sentAt: new Date().toISOString(),
      };

      const errors = validateMessage(msg);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("from and to"))).toBe(true);
    });

    it("should reject kind/from/to mismatch", () => {
      const msg: AgentMessage = {
        id: "msg-1",
        kind: "MANAGER_TO_BUILDER",
        from: "builder", // wrong! should be manager
        to: "builder",
        taskId: "task-1",
        payload: {},
        status: "sent",
        sentAt: new Date().toISOString(),
      };

      const errors = validateMessage(msg);
      expect(errors.some((e) => e.includes("requires from=manager"))).toBe(true);
    });

    it("should reject empty taskId", () => {
      const msg: AgentMessage = {
        id: "msg-1",
        kind: "MANAGER_TO_BUILDER",
        from: "manager",
        to: "builder",
        taskId: "",
        payload: {},
        status: "sent",
        sentAt: new Date().toISOString(),
      };

      const errors = validateMessage(msg);
      expect(errors.some((e) => e.includes("taskId is required"))).toBe(true);
    });

    it("should accept a valid message", () => {
      const msg = AgentMessageBuilder.managerToBuilder({
        taskId: "task-1",
        projectId: "proj-1",
        objective: "test",
        repositoryContext: {
          repositoryId: "r1",
          fullName: "o/r",
          defaultBranch: "main",
          targetBranch: "b",
          architecture: { languages: [], frameworks: [], style: "", conventions: [] },
          relevantFiles: [],
        },
        memoryContext: {
          projectMemory: { architecture: null, roadmap: null, conventions: [] },
          relevantDecisions: [],
          pastFailures: [],
          knowledgeNotes: [],
        },
      });

      const errors = validateMessage(msg);
      expect(errors).toEqual([]);
    });
  });

  describe("Delivery", () => {
    it("should deliver valid messages and update status", () => {
      const msg = AgentMessageBuilder.reviewerToManager({
        taskId: "task-1",
        status: "approved",
        issues: [],
        recommendation: "ok",
        score: 90,
      });

      const result = deliver(msg);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(msg.status).toBe("delivered");
      expect(msg.deliveredAt).toBeTruthy();
    });

    it("should reject invalid messages", () => {
      const msg: AgentMessage = {
        id: "msg-1",
        kind: "MANAGER_TO_BUILDER",
        from: "builder",
        to: "manager",
        taskId: "task-1",
        payload: {},
        status: "sent",
        sentAt: new Date().toISOString(),
      };

      const result = deliver(msg);
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should record delivered messages in the log", () => {
      const msg = AgentMessageBuilder.reviewerToManager({
        taskId: "task-log",
        status: "approved",
        issues: [],
        recommendation: "ok",
        score: 100,
      });
      deliver(msg);

      const log = agentMessageLog.getByTask("task-log");
      expect(log.length).toBe(1);
      expect(log[0].id).toBe(msg.id);
    });
  });
});
