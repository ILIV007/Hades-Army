/**
 * Telegram Progress Messages - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Priority 5: Telegram UX Redesign
 *
 * Replaces technical log lines with friendly progress messages.
 * Bad:  "Scanning... Done..."
 * Good: "🏛 Analyzing repository architecture"
 *
 * Each stage of the canonical workflow has its own message template.
 * The Manager controller calls these as it transitions between stages.
 */

import type { WorkflowStage } from "../orchestration/workflow";

// ============================================
// Types
// ============================================

export interface ProgressMessage {
  emoji: string;
  text: string;
  /** long-form description shown when the user taps an info button */
  detail?: string;
}

// ============================================
// Stage → message mapping
// ============================================

const STAGE_MESSAGES: Record<WorkflowStage, ProgressMessage> = {
  USER_REQUEST: {
    emoji: "📨",
    text: "Request received",
    detail: "Your request has been queued. The Manager will analyze it next.",
  },
  MANAGER_ANALYSIS: {
    emoji: "🧠",
    text: "Manager is analyzing your request",
    detail: "Parsing intent, classifying the request, and estimating scope.",
  },
  REPOSITORY_ANALYSIS: {
    emoji: "🏛",
    text: "Analyzing repository architecture",
    detail: "Scanning languages, frameworks, and existing conventions. Loading .hades/ memory.",
  },
  TASK_PLANNING: {
    emoji: "📋",
    text: "Manager is planning tasks",
    detail: "Decomposing the work into atomic Builder tasks with constraints.",
  },
  BUILDER_ASSIGNMENT: {
    emoji: "📨",
    text: "Assigning task to Builder",
    detail: "Sending structured message to Builder with repository and memory context.",
  },
  PATCH_GENERATION: {
    emoji: "⚔️",
    text: "Builder generating patch",
    detail: "Builder is producing the code patch using Qwen3 Coder (via Model Registry).",
  },
  REVIEWER_VALIDATION: {
    emoji: "🛡️",
    text: "Reviewer validating changes",
    detail: "Reviewer is running the 7-stage pipeline (syntax, security, performance, architecture, style, tests, docs).",
  },
  MANAGER_DECISION: {
    emoji: "🧭",
    text: "Manager is making a decision",
    detail: "Deciding whether to proceed to PR, request changes, or abort.",
  },
  GITHUB_PR: {
    emoji: "📦",
    text: "Pull request prepared",
    detail: "Manager created branch, committed patch, and opened a PR. Awaiting your approval.",
  },
  USER_APPROVAL: {
    emoji: "⏳",
    text: "Waiting for approval",
    detail: "Tap the approval button below to merge, or reject to send back to the Manager.",
  },
  MERGE: {
    emoji: "✅",
    text: "Merging pull request",
    detail: "Manager is merging the PR and updating .hades/ memory.",
  },
  COMPLETED: {
    emoji: "🎉",
    text: "Workflow complete",
    detail: "Your request has been delivered. The PR has been merged.",
  },
  ABORTED: {
    emoji: "❌",
    text: "Workflow aborted",
    detail: "The workflow was aborted. Check the abort reason for details.",
  },
};

// ============================================
// Renderers
// ============================================

export function renderStageProgress(stage: WorkflowStage): string {
  const msg = STAGE_MESSAGES[stage];
  return `${msg.emoji} ${msg.text}`;
}

export function renderStageProgressWithDetail(stage: WorkflowStage): string {
  const msg = STAGE_MESSAGES[stage];
  return [`${msg.emoji} ${msg.text}`, ``, msg.detail ?? ""].join("\n");
}

export function renderWorkflowTimeline(
  history: Array<{ stage: WorkflowStage; enteredAt: string; note?: string }>,
): string {
  if (history.length === 0) return `_(no history yet)_`;
  return history
    .map((h, idx) => {
      const msg = STAGE_MESSAGES[h.stage];
      const time = new Date(h.enteredAt).toLocaleTimeString("en-US", { hour12: false });
      const note = h.note ? ` — _${h.note}_` : "";
      return `${idx + 1}. ${msg.emoji} \`${time}\` ${msg.text}${note}`;
    })
    .join("\n");
}

// ============================================
// Approval prompt (PR ready)
// ============================================

export function renderApprovalPrompt(prUrl: string, objective: string, score: number): {
  text: string;
  replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
} {
  return {
    text: [
      `📦 *Pull Request Ready*`,
      ``,
      `*Objective:*`,
      `${objective.slice(0, 400)}`,
      ``,
      `*Review score:* ${score}/100`,
      `*PR:* ${prUrl}`,
      ``,
      `Approve to merge, or reject to send back to the Manager.`,
    ].join("\n"),
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "✅ Approve & Merge", callback_data: "approval:approve" },
          { text: "❌ Reject", callback_data: "approval:reject" },
        ],
        [{ text: "👁 View PR", url: prUrl }],
      ],
    },
  };
}

// ============================================
// Failure / abort message
// ============================================

export function renderAbort(stage: WorkflowStage, reason: string): string {
  return [
    `❌ *Workflow aborted*`,
    ``,
    `*Stage:* ${STAGE_MESSAGES[stage].emoji} ${STAGE_MESSAGES[stage].text}`,
    `*Reason:* \`${reason}\``,
    ``,
    `The Manager has recorded this failure in \`.hades/failures/\` to learn from it.`,
  ].join("\n");
}

// ============================================
// Workflow started banner
// ============================================

export function renderWorkflowStarted(workflowId: string, prompt: string): string {
  return [
    `🏛 *Hades Army — Workflow Started*`,
    ``,
    `*Workflow ID:* \`${workflowId}\``,
    `*Request:* ${prompt.slice(0, 200)}`,
    ``,
    `I'll keep you updated as the Manager, Builder, and Reviewer work through it.`,
  ].join("\n");
}
