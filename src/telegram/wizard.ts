/**
 * Telegram Wizard Bridge - Cloudflare Workers Edition
 * Hades Army v0.8.5
 *
 * Bridges the RepositoryWizard (src/github/repository-wizard.ts)
 * to Telegram: renders each wizard step as a Telegram message
 * with the appropriate inline keyboards.
 */

import type { HadesBindings } from "../types";
import { RepositoryWizard, type WizardState, type WizardStepResult } from "../github/repository-wizard";

// ============================================
// Types
// ============================================

export interface TelegramWizardSession {
  state: WizardState;
  lastMessage?: string;
}

// ============================================
// Bridge
// ============================================

export class TelegramWizardBridge {
  private wizard: RepositoryWizard;
  private sessions: Map<string, TelegramWizardSession> = new Map();

  constructor(env: HadesBindings) {
    this.wizard = new RepositoryWizard(env);
  }

  /** Start a new wizard session for a Telegram user. */
  start(userId: string): WizardStepResult {
    const result = this.wizard.start(userId);
    this.sessions.set(userId, { state: result.state });
    return result;
  }

  /** Advance the wizard with user input. */
  async advance(userId: string, input: string): Promise<WizardStepResult> {
    const session = this.sessions.get(userId);
    if (!session) {
      // No active session — start a new one
      const startResult = await this.start(userId);
      return startResult;
    }
    const result = await this.wizard.advance(session.state, input);
    session.state = result.state;
    session.lastMessage = result.message;
    return result;
  }

  /** Get the current session state. */
  getSession(userId: string): TelegramWizardSession | undefined {
    return this.sessions.get(userId);
  }

  /** End the session (called on /cancel or completion). */
  end(userId: string): void {
    this.sessions.delete(userId);
  }

  /** True if the user has an active wizard session. */
  isActive(userId: string): boolean {
    const session = this.sessions.get(userId);
    if (!session) return false;
    return session.state.step !== "COMPLETED" && !session.state.abortReason;
  }
}
