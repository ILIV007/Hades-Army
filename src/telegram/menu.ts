/**
 * Telegram Main Menu - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Priority 5: Telegram UX Redesign
 *
 * New main menu (replaces the old command-bot feel):
 *
 *   🏛 Hades Army
 *   ─────────────
 *   • Connect Repository
 *   • My Repositories
 *   • Projects
 *   • Tasks
 *   • Approvals
 *   • Memory
 *   • Settings
 *   • System Status
 *
 * Rendered as a 2-column inline keyboard. The existing
 * src/integrations/telegram-bot.ts is UNMODIFIED — this module
 * is mounted alongside it via the controller (see ./controller.ts).
 */

// ============================================
// Types
// ============================================

export type MenuAction =
  | "connect_repository"
  | "my_repositories"
  | "projects"
  | "tasks"
  | "approvals"
  | "memory"
  | "settings"
  | "system_status";

export interface MenuButton {
  action: MenuAction;
  label: string;
  emoji: string;
}

export interface TelegramInlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
}

// ============================================
// Menu definition
// ============================================

export const MAIN_MENU_BUTTONS: MenuButton[] = [
  { action: "connect_repository", label: "Connect Repository", emoji: "🔗" },
  { action: "my_repositories", label: "My Repositories", emoji: "📦" },
  { action: "projects", label: "Projects", emoji: "📁" },
  { action: "tasks", label: "Tasks", emoji: "⚔️" },
  { action: "approvals", label: "Approvals", emoji: "🛡️" },
  { action: "memory", label: "Memory", emoji: "🧠" },
  { action: "settings", label: "Settings", emoji: "⚙️" },
  { action: "system_status", label: "System Status", emoji: "📊" },
];

// ============================================
// Renderers
// ============================================

export function renderMainMenu(): { text: string; replyMarkup: TelegramInlineKeyboard } {
  const text = [
    `🏛 *Hades Army*`,
    ``,
    `Autonomous AI Development Team`,
    ``,
    `_Select an option to continue_`,
  ].join("\n");

  // 2-column layout
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < MAIN_MENU_BUTTONS.length; i += 2) {
    const row: Array<{ text: string; callback_data: string }> = [];
    for (let j = 0; j < 2; j++) {
      const btn = MAIN_MENU_BUTTONS[i + j];
      if (btn) {
        row.push({ text: `${btn.emoji} ${btn.label}`, callback_data: `menu:${btn.action}` });
      }
    }
    rows.push(row);
  }

  return {
    text,
    replyMarkup: { inline_keyboard: rows },
  };
}

export function renderHeader(action: MenuAction): string {
  const btn = MAIN_MENU_BUTTONS.find((b) => b.action === action);
  if (!btn) return `🏛 *Hades Army*`;
  return `${btn.emoji} *${btn.label}*`;
}

export function renderBackButton(to: "main" | "previous" = "main"): { text: string; callback_data: string } {
  return {
    text: "🔙 Back",
    callback_data: to === "main" ? "menu:main" : "menu:back",
  };
}

// ============================================
// Sub-menus
// ============================================

export function renderSystemStatusMenu(): { text: string; replyMarkup: TelegramInlineKeyboard } {
  const text = [
    renderHeader("system_status"),
    ``,
    `Select a dashboard:`,
  ].join("\n");

  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "🩺 Health", callback_data: "status:health" },
          { text: "💰 Cost", callback_data: "status:cost" },
        ],
        [
          { text: "📈 Agent Metrics", callback_data: "status:agents" },
          { text: "📋 Queue", callback_data: "status:queue" },
        ],
        [renderBackButton()],
      ],
    },
  };
}

export function renderSettingsMenu(): { text: string; replyMarkup: TelegramInlineKeyboard } {
  const text = [
    renderHeader("settings"),
    ``,
    `Configure your Hades Army instance:`,
  ].join("\n");

  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        [{ text: "🤖 Model Registry", callback_data: "settings:models" }],
        [{ text: "🔐 GitHub Token", callback_data: "settings:github_token" }],
        [{ text: "🔑 Admin Token", callback_data: "settings:admin_token" }],
        [{ text: "🌐 Language", callback_data: "settings:language" }],
        [renderBackButton()],
      ],
    },
  };
}

export function renderMemoryMenu(): { text: string; replyMarkup: TelegramInlineKeyboard } {
  const text = [
    renderHeader("memory"),
    ``,
    `Repository Memory (\`.hades/\`) browser:`,
  ].join("\n");

  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "🏛 Architecture", callback_data: "memory:architecture" },
          { text: "🗺 Roadmap", callback_data: "memory:roadmap" },
        ],
        [
          { text: "📝 Decisions", callback_data: "memory:decisions" },
          { text: "⚔️ Tasks", callback_data: "memory:tasks" },
        ],
        [
          { text: "🛡 Reviews", callback_data: "memory:reviews" },
          { text: "⚠️ Failures", callback_data: "memory:failures" },
        ],
        [
          { text: "📚 Knowledge", callback_data: "memory:knowledge" },
          { text: "📊 Metrics", callback_data: "memory:metrics" },
        ],
        [renderBackButton()],
      ],
    },
  };
}

export function renderApprovalsMenu(pendingCount: number): { text: string; replyMarkup: TelegramInlineKeyboard } {
  const text = [
    renderHeader("approvals"),
    ``,
    pendingCount > 0
      ? `🟡 *${pendingCount} pending approval(s)*`
      : `✅ No pending approvals`,
    ``,
    `The Manager has prepared PRs that need your decision before merge.`,
  ].join("\n");

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  if (pendingCount > 0) {
    keyboard.push([{ text: "📋 List Pending", callback_data: "approvals:list" }]);
  }
  keyboard.push([renderBackButton()]);

  return { text, replyMarkup: { inline_keyboard: keyboard } };
}
