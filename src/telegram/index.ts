/**
 * Telegram Module - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Public API for the new Telegram UX layer.
 *
 * Usage:
 *   import { getTelegramController } from "./telegram";
 *   const controller = getTelegramController(env);
 *   await controller.handleUpdate(update);
 *
 * The existing src/integrations/telegram-bot.ts is UNMODIFIED.
 * Both can coexist — this module is mounted on the same webhook
 * endpoint via src/index.ts (also unmodified; a new route file
 * src/telegram-webhook-v085.ts is added for v0.8.5 paths).
 */

export { TelegramController, getTelegramController } from "./controller";
export type { TelegramUpdate } from "./controller";

export {
  renderMainMenu,
  renderSystemStatusMenu,
  renderSettingsMenu,
  renderMemoryMenu,
  renderApprovalsMenu,
  MAIN_MENU_BUTTONS,
} from "./menu";
export type { MenuAction, MenuButton } from "./menu";

export {
  renderStageProgress,
  renderStageProgressWithDetail,
  renderWorkflowTimeline,
  renderApprovalPrompt,
  renderAbort,
  renderWorkflowStarted,
} from "./progress";

export {
  renderHealthDashboard,
  renderCostDashboard,
  renderAgentMetricsDashboard,
  renderQueueDashboard,
  renderMemoryDashboard,
  renderModelRegistryDashboard,
} from "./dashboards";

export { TelegramWizardBridge } from "./wizard";
export { TelegramHandlers } from "./handlers";
export type { HandlerContext, HandlerResult } from "./handlers";
