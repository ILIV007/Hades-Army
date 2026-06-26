/**
 * Extended Operation Modes - Cloudflare Workers Edition
 * Hades Army v9.3 — New Operating Modes
 *
 * Priority 7: New Operating Modes
 *
 * Adds 5 new modes on top of PLAN / BUILD / EXPLORE:
 *
 *   ANALYZE   — Repository analysis only (like EXPLORE but deeper)
 *   REVIEW    — Review repository or Pull Request
 *   DEBUG     — Diagnose build failures
 *   ARCHITECT — Discuss architecture only (no implementation)
 *   CHAT      — General conversation (no actions)
 *
 * Manager automatically switches context based on the active mode.
 */

import { logger } from "../utils/logger";

// ============================================
// Types
// ============================================

export type ExtendedMode =
  | "plan"
  | "build"
  | "explore"
  | "analyze"
  | "review"
  | "debug"
  | "architect"
  | "chat";

export interface ExtendedModeDescriptor {
  mode: ExtendedMode;
  emoji: string;
  label: string;
  tagline: string;
  description: string;
  managerRole: string;
  capabilities: {
    codeGeneration: boolean;
    branchCreation: boolean;
    prCreation: boolean;
    repoModification: boolean;
    challengeUser: boolean;
    askQuestions: boolean;
    repoAnalysis: boolean;
    roadmapGeneration: boolean;
    costEstimation: boolean;
    reviewMode: boolean;
    debugMode: boolean;
    architectureDiscussion: boolean;
  };
}

// ============================================
// Mode definitions
// ============================================

export const EXTENDED_MODES: Record<ExtendedMode, ExtendedModeDescriptor> = {
  plan: {
    mode: "plan",
    emoji: "🧠",
    label: "Plan",
    tagline: "Engineering planning assistant",
    description: "Generates architecture analysis, dependency graph, implementation phases, affected files, risk analysis, estimated PR size, estimated duration, token usage, rollback strategy, and 3 alternative strategies (Fast/Balanced/Enterprise). No code generation.",
    managerRole: "Planner",
    capabilities: {
      codeGeneration: false, branchCreation: false, prCreation: false,
      repoModification: false, challengeUser: true, askQuestions: true,
      repoAnalysis: true, roadmapGeneration: true, costEstimation: true,
      reviewMode: false, debugMode: false, architectureDiscussion: true,
    },
  },
  build: {
    mode: "build",
    emoji: "⚒️",
    label: "Build",
    tagline: "Execute approved plans",
    description: "Implements an approved plan. Supports pause, resume, cancel, retry failed step, and rollback current step. Builder uses incremental execution.",
    managerRole: "Executor",
    capabilities: {
      codeGeneration: true, branchCreation: true, prCreation: true,
      repoModification: true, challengeUser: false, askQuestions: false,
      repoAnalysis: false, roadmapGeneration: false, costEstimation: true,
      reviewMode: false, debugMode: false, architectureDiscussion: false,
    },
  },
  explore: {
    mode: "explore",
    emoji: "🔍",
    label: "Explore",
    tagline: "Understand the repository",
    description: "Quick repository exploration. Architecture reports, dependency graphs, technical debt, hotspots. No code generation.",
    managerRole: "Analyst",
    capabilities: {
      codeGeneration: false, branchCreation: false, prCreation: false,
      repoModification: false, challengeUser: true, askQuestions: true,
      repoAnalysis: true, roadmapGeneration: false, costEstimation: false,
      reviewMode: false, debugMode: false, architectureDiscussion: false,
    },
  },
  analyze: {
    mode: "analyze",
    emoji: "🔬",
    label: "Analyze",
    tagline: "Deep repository analysis",
    description: "Deep-dive analysis mode. Produces comprehensive reports: architecture pattern, module map, dependency graph, technical debt inventory, hotspot detection, health score, security audit. No code generation.",
    managerRole: "Senior Analyst",
    capabilities: {
      codeGeneration: false, branchCreation: false, prCreation: false,
      repoModification: false, challengeUser: true, askQuestions: true,
      repoAnalysis: true, roadmapGeneration: false, costEstimation: false,
      reviewMode: false, debugMode: false, architectureDiscussion: true,
    },
  },
  review: {
    mode: "review",
    emoji: "🛡️",
    label: "Review",
    tagline: "Review repository or PR",
    description: "Reviews an existing repository or a specific Pull Request. Runs the 7-stage validation pipeline (syntax, security, performance, architecture, style, tests, docs). Produces a review report with findings and recommendations.",
    managerRole: "Reviewer",
    capabilities: {
      codeGeneration: false, branchCreation: false, prCreation: false,
      repoModification: false, challengeUser: true, askQuestions: true,
      repoAnalysis: true, roadmapGeneration: false, costEstimation: false,
      reviewMode: true, debugMode: false, architectureDiscussion: true,
    },
  },
  debug: {
    mode: "debug",
    emoji: "🐞",
    label: "Debug",
    tagline: "Diagnose build failures",
    description: "Diagnoses failures in past builds. Loads the failure record from .hades/failures/, analyzes root cause, suggests fixes, and offers to retry the failed step. Reads past logs and audit trail.",
    managerRole: "Debugger",
    capabilities: {
      codeGeneration: false, branchCreation: false, prCreation: false,
      repoModification: false, challengeUser: true, askQuestions: true,
      repoAnalysis: true, roadmapGeneration: false, costEstimation: false,
      reviewMode: false, debugMode: true, architectureDiscussion: false,
    },
  },
  architect: {
    mode: "architect",
    emoji: "🏛",
    label: "Architect",
    tagline: "Architecture discussion only",
    description: "Pure architecture discussion. No implementation, no analysis reports — just back-and-forth conversation about design decisions, tradeoffs, patterns, and alternatives. Useful for early-stage thinking.",
    managerRole: "Architect",
    capabilities: {
      codeGeneration: false, branchCreation: false, prCreation: false,
      repoModification: false, challengeUser: true, askQuestions: true,
      repoAnalysis: false, roadmapGeneration: false, costEstimation: false,
      reviewMode: false, debugMode: false, architectureDiscussion: true,
    },
  },
  chat: {
    mode: "chat",
    emoji: "💬",
    label: "Chat",
    tagline: "General conversation",
    description: "General conversation. Manager answers questions about Hades Army, explains concepts, helps with usage. No repository access, no actions.",
    managerRole: "Assistant",
    capabilities: {
      codeGeneration: false, branchCreation: false, prCreation: false,
      repoModification: false, challengeUser: false, askQuestions: false,
      repoAnalysis: false, roadmapGeneration: false, costEstimation: false,
      reviewMode: false, debugMode: false, architectureDiscussion: false,
    },
  },
};

// ============================================
// Mode list (ordered)
// ============================================

export const EXTENDED_MODE_LIST: ExtendedModeDescriptor[] = [
  EXTENDED_MODES.plan,
  EXTENDED_MODES.build,
  EXTENDED_MODES.explore,
  EXTENDED_MODES.analyze,
  EXTENDED_MODES.review,
  EXTENDED_MODES.debug,
  EXTENDED_MODES.architect,
  EXTENDED_MODES.chat,
];

// ============================================
// Helpers
// ============================================

export function getExtendedMode(mode: string): ExtendedModeDescriptor {
  return EXTENDED_MODES[mode as ExtendedMode] ?? EXTENDED_MODES.plan;
}

export function isValidExtendedMode(mode: string): mode is ExtendedMode {
  return mode in EXTENDED_MODES;
}

/**
 * Auto-detect the most appropriate mode based on user prompt keywords.
 * Returns undefined if no clear signal — caller should default to "plan".
 */
export function autoDetectMode(prompt: string): ExtendedMode | undefined {
  const lower = prompt.toLowerCase();
  if (/\b(debug|fix.*fail|why.*fail|crash|error|stack trace)\b/.test(lower)) return "debug";
  if (/\b(review|audit|validate|check.*pr)\b/.test(lower)) return "review";
  if (/\b(analy[sz]e|deep.*dive|assess|evaluat)\b/.test(lower)) return "analyze";
  if (/\b(architect|design|pattern|tradeoff|alternative)\b/.test(lower)) return "architect";
  if (/\b(plan|roadmap|strateg|estimate|how.*should|approach)\b/.test(lower)) return "plan";
  if (/\b(build|implement|cod|develop|feature|patch)\b/.test(lower)) return "build";
  if (/\b(explore|understand|what.*in|show.*me|overview)\b/.test(lower)) return "explore";
  if (/\b(hello|hi|hey|help|what.*hades|how.*work)\b/.test(lower)) return "chat";
  return undefined;
}

// ============================================
// Render for Telegram
// ============================================

export function renderExtendedModeSwitcher(currentMode: ExtendedMode): {
  text: string;
  replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
} {
  const text = [
    `🎛 *Operation Mode*`,
    ``,
    `Current: ${EXTENDED_MODES[currentMode].emoji} *${EXTENDED_MODES[currentMode].label}*`,
    `${EXTENDED_MODES[currentMode].tagline}`,
    ``,
    `Select a mode:`,
  ].join("\n");

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const m of EXTENDED_MODE_LIST) {
    const isActive = m.mode === currentMode;
    keyboard.push([{
      text: `${isActive ? "● " : "○ "}${m.emoji} ${m.label} — ${m.tagline}`,
      callback_data: `mode:switch:${m.mode}`,
    }]);
  }
  keyboard.push([{ text: "🔙 Back", callback_data: "menu:main" }]);

  return { text, replyMarkup: { inline_keyboard: keyboard } };
}

export function renderExtendedModeDescription(mode: ExtendedMode): string {
  const m = EXTENDED_MODES[mode];
  return [
    `${m.emoji} *${m.label} Mode*`,
    ``,
    `*Tagline:* ${m.tagline}`,
    ``,
    `*Description:*`,
    m.description,
    ``,
    `*Manager role:* ${m.managerRole}`,
  ].join("\n");
}
