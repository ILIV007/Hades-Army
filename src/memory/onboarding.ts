/**
 * Repository Onboarding - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Priority 4: GitHub-Centric Workflow
 *
 * Onboarding pipeline:
 *
 *   1. Connect Repository (URL + token)
 *   2. Permission Validation
 *   3. Repository Scan
 *   4. Manager Interview (LLM-driven questions about project goals)
 *   5. Architecture Summary (Manager writes architecture.md)
 *   6. Roadmap Preview (Manager writes roadmap.md)
 *   7. Project Activation (.hades/project.json status = "active")
 *
 * No project may start the implementation workflow until onboarding
 * is completed (Repository Memory must exist).
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";

import { RepositoryMemory } from "./repository-memory";
import { RepositoryScanner, type DetailedScanResult } from "./repository-scanner";
import { ModelRegistry } from "../registry/model-registry";

// ============================================
// Types
// ============================================

export type OnboardingStage =
  | "CONNECT"
  | "PERMISSION_VALIDATION"
  | "REPOSITORY_SCAN"
  | "MANAGER_INTERVIEW"
  | "ARCHITECTURE_SUMMARY"
  | "ROADMAP_PREVIEW"
  | "ACTIVATION"
  | "COMPLETED";

export interface OnboardingState {
  onboardingId: string;
  projectId: string;
  repositoryFullName: string;
  stage: OnboardingStage;
  startedAt: string;
  completedAt?: string;
  scanResult?: DetailedScanResult;
  interview?: {
    questions: string[];
    answers: Record<string, string>;
  };
  architectureSummary?: string;
  roadmapPreview?: string;
  abortReason?: string;
}

export interface OnboardingQuestion {
  id: string;
  question: string;
  rationale: string;
}

// ============================================
// Onboarding Manager
// ============================================

export class RepositoryOnboarding {
  private env: HadesBindings;
  private memory: RepositoryMemory;
  private scanner: RepositoryScanner;
  private registry: ModelRegistry;

  constructor(env: HadesBindings) {
    this.env = env;
    this.memory = new RepositoryMemory(env);
    this.scanner = new RepositoryScanner(env);
    this.registry = ModelRegistry.getInstance(env);
  }

  // ============================================
  // Stage 1: Connect (validation only — token storage is caller's responsibility)
  // ============================================

  async connect(repositoryFullName: string, githubToken: string): Promise<OnboardingState> {
    if (!githubToken) throw new Error("GitHub token is required");
    if (!repositoryFullName.includes("/")) throw new Error("Repository must be in owner/name format");

    // Verify the token can read the repository
    const [owner, name] = repositoryFullName.split("/");
    const response = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "HadesArmy/0.8.5",
      },
    });

    if (!response.ok) {
      throw new Error(`Repository access failed (${response.status}). Check token scopes.`);
    }

    const repo = (await response.json()) as any;

    const state: OnboardingState = {
      onboardingId: generateId("onboard"),
      projectId: generateId("proj"),
      repositoryFullName,
      stage: "PERMISSION_VALIDATION",
      startedAt: new Date().toISOString(),
    };

    logger.info(`Onboarding: connect ok for ${repositoryFullName}`, { onboardingId: state.onboardingId, defaultBranch: repo.default_branch });
    return state;
  }

  // ============================================
  // Stage 2: Permission validation
  // ============================================

  async validatePermissions(state: OnboardingState, githubToken: string): Promise<OnboardingState> {
    const [owner, name] = state.repositoryFullName.split("/");

    // Check that the token can create branches and PRs
    const checks: Array<{ name: string; ok: boolean }> = [];

    // Read access
    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
      headers: this.githubHeaders(githubToken),
    });
    checks.push({ name: "repo:read", ok: repoRes.ok });

    if (repoRes.ok) {
      const repo = (await repoRes.json()) as any;
      checks.push({ name: "default_branch", ok: !!repo.default_branch });
      checks.push({ name: "push_allowed", ok: !repo.permissions || repo.permissions.push !== false });
    }

    // Try to list branches (validates contents:read)
    const branchRes = await fetch(`https://api.github.com/repos/${owner}/${name}/branches?per_page=1`, {
      headers: this.githubHeaders(githubToken),
    });
    checks.push({ name: "branches:read", ok: branchRes.ok });

    const failed = checks.filter((c) => !c.ok);
    if (failed.length > 0) {
      throw new Error(`Permission validation failed: ${failed.map((c) => c.name).join(", ")}`);
    }

    state.stage = "REPOSITORY_SCAN";
    logger.info(`Onboarding ${state.onboardingId}: permissions ok`, { checks });
    return state;
  }

  // ============================================
  // Stage 3: Repository scan
  // ============================================

  async scanRepository(state: OnboardingState): Promise<OnboardingState> {
    const scanResult = await this.scanner.scan(state.repositoryFullName);
    state.scanResult = scanResult;
    state.stage = "MANAGER_INTERVIEW";
    logger.info(`Onboarding ${state.onboardingId}: scan complete`, {
      languages: scanResult.languages.length,
      frameworks: scanResult.frameworks.length,
    });
    return state;
  }

  // ============================================
  // Stage 4: Manager interview (LLM generates questions)
  // ============================================

  async conductInterview(state: OnboardingState): Promise<OnboardingState> {
    if (!state.scanResult) throw new Error("Scan must complete before interview");

    // Manager generates 5 questions about the project based on the scan
    const prompt = this.buildInterviewPrompt(state.scanResult);

    let questions: OnboardingQuestion[];
    try {
      const response = await this.registry.generateForAgent(
        "manager",
        prompt,
        { maxTokens: 1024, temperature: 0.6 },
      );
      questions = this.parseInterviewQuestions(response.content);
    } catch (err) {
      // Fallback: use static default questions
      logger.warn("Onboarding: manager interview generation failed, using defaults", { err });
      questions = DEFAULT_INTERVIEW_QUESTIONS;
    }

    state.interview = {
      questions: questions.map((q) => q.question),
      answers: {},
    };
    state.stage = "ARCHITECTURE_SUMMARY";
    logger.info(`Onboarding ${state.onboardingId}: interview prepared with ${questions.length} questions`);
    return state;
  }

  /**
   * Caller collects answers from the user (via Telegram wizard) and
   * submits them back via this method.
   */
  async submitInterviewAnswers(state: OnboardingState, answers: Record<string, string>): Promise<OnboardingState> {
    if (!state.interview) throw new Error("Interview has not been conducted");
    state.interview.answers = answers;
    return state;
  }

  // ============================================
  // Stage 5: Architecture summary (Manager writes architecture.md)
  // ============================================

  async generateArchitectureSummary(state: OnboardingState): Promise<OnboardingState> {
    if (!state.scanResult) throw new Error("Scan required before architecture summary");

    const prompt = this.buildArchitecturePrompt(state);

    let summary: string;
    try {
      const response = await this.registry.generateForAgent(
        "manager",
        prompt,
        { maxTokens: 2048, temperature: 0.4 },
      );
      summary = response.content;
    } catch (err) {
      logger.warn("Onboarding: architecture summary generation failed, using template", { err });
      summary = this.fallbackArchitectureSummary(state);
    }

    state.architectureSummary = summary;
    state.stage = "ROADMAP_PREVIEW";
    logger.info(`Onboarding ${state.onboardingId}: architecture summary generated (${summary.length} chars)`);
    return state;
  }

  // ============================================
  // Stage 6: Roadmap preview
  // ============================================

  async generateRoadmapPreview(state: OnboardingState): Promise<OnboardingState> {
    const prompt = this.buildRoadmapPrompt(state);

    let roadmap: string;
    try {
      const response = await this.registry.generateForAgent(
        "manager",
        prompt,
        { maxTokens: 2048, temperature: 0.5 },
      );
      roadmap = response.content;
    } catch (err) {
      logger.warn("Onboarding: roadmap preview generation failed, using template", { err });
      roadmap = this.fallbackRoadmap(state);
    }

    state.roadmapPreview = roadmap;
    state.stage = "ACTIVATION";
    logger.info(`Onboarding ${state.onboardingId}: roadmap preview generated`);
    return state;
  }

  // ============================================
  // Stage 7: Activation (writes .hades/ and flips status to "active")
  // ============================================

  async activate(state: OnboardingState): Promise<OnboardingState> {
    if (!state.scanResult) throw new Error("Cannot activate without scan");
    if (!state.architectureSummary) throw new Error("Cannot activate without architecture summary");
    if (!state.roadmapPreview) throw new Error("Cannot activate without roadmap preview");

    // Set the project context so subsequent memory writes are scoped correctly
    this.memory.setProjectContext(state.projectId);

    // Initialize .hades/ structure
    const project = await this.memory.initializeRepository(state.projectId, state.scanResult);

    // Write the architecture summary and roadmap as ADR / knowledge
    await this.memory.addKnowledgeNote(state.projectId, {
      title: "Architecture Summary",
      content: state.architectureSummary,
      tags: ["architecture", "auto-generated"],
    });
    await this.memory.addKnowledgeNote(state.projectId, {
      title: "Roadmap Preview",
      content: state.roadmapPreview,
      tags: ["roadmap", "auto-generated"],
    });

    if (state.interview) {
      await this.memory.addKnowledgeNote(state.projectId, {
        title: "Onboarding Interview",
        content: state.interview.questions
          .map((q, i) => `Q${i + 1}: ${q}\nA: ${state.interview!.answers[`q${i + 1}`] ?? "(no answer)"}`)
          .join("\n\n"),
        tags: ["onboarding", "interview"],
      });
    }

    state.stage = "COMPLETED";
    state.completedAt = new Date().toISOString();
    logger.info(`Onboarding ${state.onboardingId}: COMPLETED — project ${state.projectId} activated`);
    return state;
  }

  // ============================================
  // Helpers: prompts
  // ============================================

  private buildInterviewPrompt(scan: DetailedScanResult): string {
    return [
      `You are the Hades Army Manager agent. You just scanned a new repository and need to interview the owner to understand the project.`,
      ``,
      `Repository: ${scan.repositoryFullName}`,
      `Architecture style: ${scan.architectureStyle}`,
      `Languages: ${scan.languages.join(", ")}`,
      `Frameworks detected: ${scan.frameworks.join(", ") || "(none)"}`,
      `Conventions: ${scan.conventions.join(", ")}`,
      `Test layout: ${scan.testLayout}`,
      ``,
      `Generate exactly 5 short, focused questions that will help you build a roadmap.`,
      `Each question must be on its own line, prefixed with "Q:".`,
      `Focus on: project goals, current pain points, next milestone, target users, and known constraints.`,
      `Do not include any other text.`,
    ].join("\n");
  }

  private parseInterviewQuestions(content: string): OnboardingQuestion[] {
    const lines = content.split("\n").map((l) => l.trim()).filter((l) => l.toLowerCase().startsWith("q:"));
    return lines.slice(0, 5).map((line, i) => ({
      id: `q${i + 1}`,
      question: line.replace(/^q:\s*/i, ""),
      rationale: "auto-generated",
    }));
  }

  private buildArchitecturePrompt(state: OnboardingState): string {
    return [
      `You are the Hades Army Manager agent. Write a concise architecture summary in Markdown for the repository ${state.repositoryFullName}.`,
      ``,
      `## Scan Result`,
      `- Architecture style: ${state.scanResult!.architectureStyle}`,
      `- Languages: ${state.scanResult!.languages.join(", ")}`,
      `- Frameworks: ${state.scanResult!.frameworks.join(", ") || "(none)"}`,
      `- Conventions: ${state.scanResult!.conventions.join(", ")}`,
      `- Test layout: ${state.scanResult!.testLayout}`,
      `- Linter: ${state.scanResult!.linting.linter ?? "(none)"}`,
      `- Formatter: ${state.scanResult!.linting.formatter ?? "(none)"}`,
      ``,
      `## Interview Answers`,
      ...(state.interview?.questions ?? []).map((q, i) => `- Q: ${q}\n  A: ${state.interview!.answers[`q${i + 1}`] ?? "(no answer)"}`),
      ``,
      `Write a Markdown document with these sections:`,
      `1. Overview`,
      `2. Module Structure`,
      `3. Dependency Map`,
      `4. Coding Conventions`,
      `5. Open Questions`,
      `Keep it under 400 words. Use headings and bullets.`,
    ].join("\n");
  }

  private buildRoadmapPrompt(state: OnboardingState): string {
    return [
      `You are the Hades Army Manager agent. Based on the architecture summary below, propose a 3-milestone roadmap in Markdown.`,
      ``,
      `## Architecture Summary`,
      state.architectureSummary ?? "(not available)",
      ``,
      `## Interview Answers`,
      ...(state.interview?.questions ?? []).map((q, i) => `- Q: ${q}\n  A: ${state.interview!.answers[`q${i + 1}`] ?? "(no answer)"}`),
      ``,
      `Format as:`,
      `## Milestone 1: <title>`,
      `- <task>`,
      `## Milestone 2: <title>`,
      `## Milestone 3: <title>`,
      `Keep it under 300 words.`,
    ].join("\n");
  }

  private fallbackArchitectureSummary(state: OnboardingState): string {
    return [
      `# Architecture Summary`,
      ``,
      `## Overview`,
      `${state.repositoryFullName} is a ${state.scanResult!.architectureStyle} project written primarily in ${state.scanResult!.languages.slice(0, 3).join(", ")}.`,
      ``,
      `## Module Structure`,
      `Modules will be documented after the first task.`,
      ``,
      `## Dependency Map`,
      `Frameworks detected: ${state.scanResult!.frameworks.join(", ") || "none"}.`,
      ``,
      `## Coding Conventions`,
      ...state.scanResult!.conventions.map((c) => `- ${c}`),
      ``,
      `## Open Questions`,
      `- Architectural details will be refined as tasks are completed.`,
    ].join("\n");
  }

  private fallbackRoadmap(state: OnboardingState): string {
    return [
      `# Roadmap Preview`,
      ``,
      `## Milestone 1: Stabilization`,
      `- Repository onboarding completed`,
      `- Memory system initialized`,
      `- First task ready for Builder`,
      ``,
      `## Milestone 2: First Implementation`,
      `- Manager plans first user request`,
      `- Builder produces first patch`,
      `- Reviewer validates`,
      ``,
      `## Milestone 3: Iteration`,
      `- Address review feedback`,
      `- Merge first PR`,
      `- Update .hades/ knowledge`,
    ].join("\n");
  }

  private githubHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "HadesArmy/0.8.5",
    };
  }
}

// ============================================
// Default interview questions (used if LLM fails)
// ============================================

const DEFAULT_INTERVIEW_QUESTIONS: OnboardingQuestion[] = [
  { id: "q1", question: "What is the primary goal of this project?", rationale: "understand intent" },
  { id: "q2", question: "What is the most urgent issue or feature right now?", rationale: "find first task" },
  { id: "q3", question: "Who are the target users?", rationale: "scope decisions" },
  { id: "q4", question: "Are there any hard constraints (deadline, budget, dependencies)?", rationale: "risk" },
  { id: "q5", question: "What does success look like in 30 days?", rationale: "roadmap anchor" },
];
