/**
 * Telegram Home Screen v9.3 - Cloudflare Workers Edition
 * Hades Army v9.3 — Complete UX Redesign
 *
 * New home menu:
 *   🏠 Dashboard
 *   📂 My Projects
 *   ➕ New Project
 *   🧠 Plan
 *   ⚒ Build
 *   📋 Tasks
 *   📊 Activity
 *   ⚙ Settings
 *   ❓ Help
 *
 * No old menus remain.
 */

import type { ExtendedMode } from "../modes/extended-modes";
import { EXTENDED_MODES } from "../modes/extended-modes";

// ============================================
// Types
// ============================================

export interface HomeScreenContext {
  userId: string;
  activeMode: ExtendedMode;
  activeProject?: string;
  activeRepository?: string;
  runningTasks: number;
  pendingApprovals: number;
  lastActivity?: string;
  version?: string; // v9.4 — dynamic version from env
}

// ============================================
// Home screen renderer
// ============================================

export function renderHomeScreen(ctx: HomeScreenContext): {
  text: string;
  replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
} {
  const mode = EXTENDED_MODES[ctx.activeMode];
  const version = ctx.version ?? "unknown";
  const lines: string[] = [
    `🏛 *Hades Army* v${version}`,
    ``,
    `*Mode:* ${mode.emoji} ${mode.label}`,
  ];
  if (ctx.activeRepository) {
    lines.push(`*Repository:* \`${ctx.activeRepository}\``);
  } else {
    lines.push(`*Repository:* none connected`);
  }
  if (ctx.activeProject) {
    lines.push(`*Project:* \`${ctx.activeProject}\``);
  }
  lines.push(``);
  lines.push(`*Activity:*`);
  lines.push(`▶️ Running tasks: ${ctx.runningTasks}`);
  lines.push(`⏳ Pending approvals: ${ctx.pendingApprovals}`);
  if (ctx.lastActivity) {
    lines.push(`🕒 Last: ${new Date(ctx.lastActivity).toLocaleString()}`);
  }
  lines.push(``);
  lines.push(`_Tap an option below:_`);

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      { text: "🏠 Dashboard", callback_data: "home:dashboard" },
      { text: "📂 My Projects", callback_data: "home:projects" },
    ],
    [
      { text: "➕ New Project", callback_data: "home:new_project" },
      { text: "📋 Tasks", callback_data: "home:tasks" },
    ],
    [
      { text: `🧠 Plan`, callback_data: "home:plan" },
      { text: `⚒ Build`, callback_data: "home:build" },
    ],
    [
      { text: "📊 Activity", callback_data: "home:activity" },
      { text: "🎛 Mode", callback_data: "home:mode" },
    ],
    [
      { text: "📚 Memory", callback_data: "home:memory" },
      { text: "⚙ Settings", callback_data: "home:settings" },
    ],
    [{ text: "❓ Help", callback_data: "home:help" }],
  ];

  return { text: lines.join("\n"), replyMarkup: { inline_keyboard: keyboard } };
}

// ============================================
// Dashboard screen
// ============================================

export function renderDashboardScreen(stats: {
  projects: number;
  repositories: number;
  runningTasks: number;
  pendingApprovals: number;
  completedToday: number;
  failedToday: number;
  costTodayUsd: number;
  workerStatus: "healthy" | "degraded" | "failed";
  telegramStatus: "healthy" | "degraded" | "failed";
  githubStatus: "healthy" | "degraded" | "failed";
  d1Status: "healthy" | "degraded" | "failed";
  kvStatus: "healthy" | "degraded" | "failed";
  llmStatus: "healthy" | "degraded" | "failed";
}): {
  text: string;
  replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
} {
  const statusIcon = (s: string) => s === "healthy" ? "🟢" : s === "degraded" ? "🟡" : "🔴";

  const lines: string[] = [
    `🏠 *Dashboard*`,
    ``,
    `*Projects & Repos:*`,
    `📂 Projects: ${stats.projects}`,
    `📦 Repositories: ${stats.repositories}`,
    ``,
    `*Today's Activity:*`,
    `▶️ Running: ${stats.runningTasks}`,
    `⏳ Pending approval: ${stats.pendingApprovals}`,
    `✅ Completed: ${stats.completedToday}`,
    `❌ Failed: ${stats.failedToday}`,
    `💰 Cost: $${stats.costTodayUsd.toFixed(4)}`,
    ``,
    `*System Status:*`,
    `${statusIcon(stats.workerStatus)} Worker`,
    `${statusIcon(stats.telegramStatus)} Telegram`,
    `${statusIcon(stats.githubStatus)} GitHub`,
    `${statusIcon(stats.d1Status)} D1`,
    `${statusIcon(stats.kvStatus)} KV`,
    `${statusIcon(stats.llmStatus)} LLM`,
  ];

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [
    [
      { text: "📋 View Tasks", callback_data: "home:tasks" },
      { text: "📊 Activity", callback_data: "home:activity" },
    ],
    [
      { text: "🩺 Full Health", callback_data: "home:full_health" },
      { text: "💰 Cost Report", callback_data: "home:cost" },
    ],
    [{ text: "🔙 Home", callback_data: "home:main" }],
  ];

  return { text: lines.join("\n"), replyMarkup: { inline_keyboard: keyboard } };
}

// ============================================
// Onboarding wizard (first /start)
// ============================================

export interface OnboardingStep {
  step: number;
  total: number;
  title: string;
  body: string;
  nextAction?: string;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    step: 1,
    total: 5,
    title: "Welcome to Hades Army",
    body: [
      `🏛 *Welcome to Hades Army*`,
      ``,
      `Hades Army is your autonomous software engineering team.`,
      `It consists of three AI agents:`,
      ``,
      `🧠 *Manager* — Strategic engineering lead. Plans, evaluates risk, decides.`,
      `⚒ *Builder* — Code generation. Uses Qwen3-Coder.`,
      `🛡 *Reviewer* — Code review. Uses DeepSeek.`,
      ``,
      `Tap "Next" to continue.`,
    ].join("\n"),
    nextAction: "onboard:2",
  },
  {
    step: 2,
    total: 5,
    title: "Operating Modes",
    body: [
      `🎛 *Operating Modes*`,
      ``,
      `Hades Army has 8 modes. The most important:`,
      ``,
      `🧠 *PLAN* — Generate engineering plans (3 strategies: Fast/Balanced/Enterprise)`,
      `⚒ *BUILD* — Execute approved plans with Builder + Reviewer`,
      `🔍 *EXPLORE* — Quick repository exploration`,
      `🔬 *ANALYZE* — Deep repository analysis`,
      `🛡 *REVIEW* — Review existing code or PRs`,
      `🐞 *DEBUG* — Diagnose build failures`,
      `🏛 *ARCHITECT* — Architecture discussion`,
      `💬 *CHAT* — General conversation`,
      ``,
      `Default mode is *PLAN*. You can switch anytime with /plan /build /explore etc.`,
    ].join("\n"),
    nextAction: "onboard:3",
  },
  {
    step: 3,
    total: 5,
    title: "Memory System",
    body: [
      `🧠 *Memory System*`,
      ``,
      `Hades Army remembers everything:`,
      ``,
      `• *Repository Memory* (.hades/) — architecture, decisions, failures`,
      `• *Conversation Memory* — your active project, mode, approvals`,
      `• *Decision Memory* — past architecture decisions (ADRs)`,
      `• *Failure Memory* — lessons learned from rejected patches`,
      ``,
      `The Manager consults past failures before planning — it never repeats rejected approaches.`,
    ].join("\n"),
    nextAction: "onboard:4",
  },
  {
    step: 4,
    total: 5,
    title: "Connect GitHub",
    body: [
      `🔗 *Connect Your Repository*`,
      ``,
      `To start working, connect a GitHub repository:`,
      ``,
      `1. Tap "Connect Repository" below`,
      `2. Send the repository URL (e.g. \`owner/repo\`)`,
      `3. Provide a GitHub token (we'll guide you)`,
      `4. Manager scans + analyzes the repo`,
      `5. Project is created`,
      ``,
      `*Safe Mode* is enabled by default for new repos — no pushes until you explicitly allow them.`,
    ].join("\n"),
    nextAction: "onboard:5",
  },
  {
    step: 5,
    total: 5,
    title: "Ready",
    body: [
      `✅ *You're Ready!*`,
      ``,
      `Quick reference:`,
      ``,
      `/menu — Home screen`,
      `/plan — Switch to PLAN mode`,
      `/build — Switch to BUILD mode`,
      `/repositories — Manage repos`,
      `/memory — View memory snapshot`,
      `/health — System health`,
      `/admin — Admin dashboard (requires token)`,
      ``,
      `Tap "Finish" to start using Hades Army.`,
    ].join("\n"),
    nextAction: "onboard:finish",
  },
];

export function renderOnboardingStep(step: OnboardingStep): {
  text: string;
  replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
} {
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  if (step.nextAction) {
    if (step.step === 1) {
      keyboard.push([{ text: "Next →", callback_data: step.nextAction }]);
    } else {
      keyboard.push([
        { text: "← Back", callback_data: `onboard:${step.step - 1}` },
        { text: "Next →", callback_data: step.nextAction },
      ]);
    }
  } else {
    keyboard.push([{ text: "← Back", callback_data: `onboard:${step.step - 1}` }]);
  }
  keyboard.push([{ text: "Skip", callback_data: "onboard:skip" }]);
  return { text: step.body, replyMarkup: { inline_keyboard: keyboard } };
}

// ============================================
// Help screen
// ============================================

export function renderHelpScreen(): {
  text: string;
  replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
} {
  const text = [
    `❓ *Help*`,
    ``,
    `*Commands:*`,
    `/menu — Home screen`,
    `/plan — PLAN mode (engineering planning)`,
    `/build — BUILD mode (execute approved plan)`,
    `/explore — EXPLORE mode (quick repo exploration)`,
    `/analyze — ANALYZE mode (deep repo analysis)`,
    `/review — REVIEW mode (review code/PR)`,
    `/debug — DEBUG mode (diagnose failures)`,
    `/architect — ARCHITECT mode (architecture discussion)`,
    `/chat — CHAT mode (general conversation)`,
    `/repositories — Manage repositories`,
    `/memory — Memory snapshot`,
    `/health — System health`,
    `/reset — Clear conversation memory`,
    ``,
    `*Concepts:*`,
    `• *Plan* before *Build* — always plan first`,
    `• Manager produces 3 strategies: Fast / Balanced / Enterprise`,
    `• Safe Mode blocks pushes for new repos`,
    `• Memory is per-project and persistent`,
  ].join("\n");

  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "How planning works", callback_data: "help:planning" },
          { text: "How build works", callback_data: "help:build" },
        ],
        [
          { text: "How approval works", callback_data: "help:approval" },
          { text: "How memory works", callback_data: "help:memory" },
        ],
        [{ text: "🔙 Home", callback_data: "home:main" }],
      ],
    },
  };
}
