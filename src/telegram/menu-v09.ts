/**
 * Telegram Menu v0.9 - Cloudflare Workers Edition
 * Hades Army v0.9.0
 *
 * Section 7: Telegram UX Redesign — Main Menu
 *
 * New main menu (replaces v0.8.5 menu):
 *
 *   🏛 Hades Army
 *   ─────────────
 *   📦 My Repositories
 *   🧠 Plan
 *   ⚔ Build
 *   🔍 Explore
 *   📋 Tasks
 *   ✅ Approvals
 *   📚 Memory
 *   📊 Status
 *   ⚙ Settings
 */

import { renderModeSwitcher, renderModeDescription, MODES, type OperationMode } from "../modes/operation-modes";

// ============================================
// Types
// ============================================

export type MenuActionV09 =
  | "my_repositories"
  | "plan"
  | "build"
  | "explore"
  | "tasks"
  | "approvals"
  | "memory"
  | "status"
  | "settings"
  | "mode_switch";

export interface MenuButtonV09 {
  action: MenuActionV09;
  label: string;
  emoji: string;
}

export interface TelegramInlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
}

// ============================================
// Menu definition
// ============================================

export const MAIN_MENU_BUTTONS_V09: MenuButtonV09[] = [
  { action: "my_repositories", label: "My Repositories", emoji: "📦" },
  { action: "plan", label: "Plan", emoji: "🧠" },
  { action: "build", label: "Build", emoji: "⚔️" },
  { action: "explore", label: "Explore", emoji: "🔍" },
  { action: "tasks", label: "Tasks", emoji: "📋" },
  { action: "approvals", label: "Approvals", emoji: "✅" },
  { action: "memory", label: "Memory", emoji: "📚" },
  { action: "status", label: "Status", emoji: "📊" },
  { action: "settings", label: "Settings", emoji: "⚙️" },
];

// ============================================
// Renderers
// ============================================

export function renderMainMenuV09(activeMode: OperationMode = "plan", version: string = "unknown"): {
  text: string;
  replyMarkup: TelegramInlineKeyboard;
} {
  const mode = MODES[activeMode];
  const text = [
    `🏛 *Hades Army* v${version}`,
    ``,
    `Autonomous Repository-Aware Development Team`,
    ``,
    `*Active mode:* ${mode.emoji} ${mode.label} — ${mode.tagline}`,
    ``,
    `_Select an option to continue._`,
  ].join("\n");

  // 2-column layout, but Build/Plan/Explore are highlighted as the 3 mode buttons
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  // Mode buttons row (3 columns)
  rows.push([
    { text: `🧠 Plan${activeMode === "plan" ? " ●" : ""}`, callback_data: "menu:plan" },
    { text: `⚔️ Build${activeMode === "build" ? " ●" : ""}`, callback_data: "menu:build" },
    { text: `🔍 Explore${activeMode === "explore" ? " ●" : ""}`, callback_data: "menu:explore" },
  ]);

  // Other buttons (2 columns)
  const otherButtons: Array<{ text: string; callback_data: string }> = [
    { text: "📦 My Repositories", callback_data: "menu:my_repositories" },
    { text: "📋 Tasks", callback_data: "menu:tasks" },
    { text: "✅ Approvals", callback_data: "menu:approvals" },
    { text: "📚 Memory", callback_data: "menu:memory" },
    { text: "📊 Status", callback_data: "menu:status" },
    { text: "⚙️ Settings", callback_data: "menu:settings" },
  ];
  for (let i = 0; i < otherButtons.length; i += 2) {
    const row: Array<{ text: string; callback_data: string }> = [];
    for (let j = 0; j < 2; j++) {
      if (otherButtons[i + j]) row.push(otherButtons[i + j]);
    }
    rows.push(row);
  }

  // Mode switcher at the bottom
  rows.push([{ text: "🎛 Switch Mode", callback_data: "menu:mode_switch" }]);

  return { text, replyMarkup: { inline_keyboard: rows } };
}

export function renderModeMenu(): { text: string; replyMarkup: TelegramInlineKeyboard } {
  const r = renderModeSwitcher("plan");
  return { text: r.text, replyMarkup: r.replyMarkup as TelegramInlineKeyboard };
}

export function renderPlanMenu(): { text: string; replyMarkup: TelegramInlineKeyboard } {
  const text = [
    `🧠 *Plan Mode*`,
    ``,
    `Think before acting. The Manager will:`,
    `• Review your request as a Senior Architect`,
    `• Identify risks and ask clarifying questions`,
    `• Estimate cost and time`,
    `• Generate a roadmap and task breakdown`,
    ``,
    `*No code generation. No branches. No PRs.*`,
    ``,
    `Send me your request as a free-text message, or tap a button below:`,
  ].join("\n");

  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "🧠 Analyze Request", callback_data: "plan:analyze" },
          { text: "🗺 Generate Roadmap", callback_data: "plan:roadmap" },
        ],
        [
          { text: "⚠️ Risk Analysis", callback_data: "plan:risk" },
          { text: "💰 Cost Estimate", callback_data: "plan:cost" },
        ],
        [
          { text: "📋 Task Breakdown", callback_data: "plan:breakdown" },
          { text: "✅ Approve Plan", callback_data: "plan:approve" },
        ],
        [{ text: "🔙 Back", callback_data: "menu:main" }],
      ],
    },
  };
}

export function renderBuildMenu(hasApprovedPlan: boolean): { text: string; replyMarkup: TelegramInlineKeyboard } {
  const text = [
    `⚔️ *Build Mode*`,
    ``,
    hasApprovedPlan
      ? `✅ You have an approved plan ready to execute.`
      : `❌ No approved plan yet. Switch to Plan mode first.`,
    ``,
    `The Manager will:`,
    `• Decompose the plan into atomic Builder tasks`,
    `• Send each task to the Builder (Qwen3-Coder)`,
    `• Forward patches to the Reviewer (DeepSeek)`,
    `• Open a PR for your approval`,
    ``,
    `*Only starts after an approved plan exists.*`,
  ].join("\n");

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  if (hasApprovedPlan) {
    keyboard.push([{ text: "🚀 Execute Approved Plan", callback_data: "build:execute" }]);
  } else {
    keyboard.push([{ text: "🧠 Go to Plan Mode", callback_data: "menu:plan" }]);
  }
  keyboard.push([
    { text: "📋 View Tasks", callback_data: "build:tasks" },
    { text: "🛡 View Reviews", callback_data: "build:reviews" },
  ]);
  keyboard.push([{ text: "🔙 Back", callback_data: "menu:main" }]);

  return { text, replyMarkup: { inline_keyboard: keyboard } };
}

export function renderExploreMenu(): { text: string; replyMarkup: TelegramInlineKeyboard } {
  const text = [
    `🔍 *Explore Mode*`,
    ``,
    `Understand your repository. The Manager will:`,
    `• Analyze architecture`,
    `• Generate a dependency graph`,
    `• Detect technical debt and hotspots`,
    `• Produce a repository insights report`,
    ``,
    `*No code generation. No repository changes.*`,
  ].join("\n");

  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "🏛 Architecture Report", callback_data: "explore:architecture" },
          { text: "🕸 Dependency Graph", callback_data: "explore:deps" },
        ],
        [
          { text: "⚠️ Technical Debt", callback_data: "explore:debt" },
          { text: "🔥 Hotspots", callback_data: "explore:hotspots" },
        ],
        [
          { text: "📊 Full Insights", callback_data: "explore:insights" },
          { text: "🩺 Health Score", callback_data: "explore:health" },
        ],
        [{ text: "🔙 Back", callback_data: "menu:main" }],
      ],
    },
  };
}

export function renderSettingsMenuV09(): { text: string; replyMarkup: TelegramInlineKeyboard } {
  const text = [
    `⚙️ *Settings*`,
    ``,
    `Configure your Hades Army instance:`,
  ].join("\n");

  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        [{ text: "🤖 Model Registry", callback_data: "settings:models" }],
        [{ text: "🎛 Operation Mode", callback_data: "menu:mode_switch" }],
        [{ text: "🔐 GitHub Token", callback_data: "settings:github_token" }],
        [{ text: "🔑 Admin Token", callback_data: "settings:admin_token" }],
        [{ text: "🌐 Language", callback_data: "settings:language" }],
        [{ text: "🔙 Back", callback_data: "menu:main" }],
      ],
    },
  };
}
