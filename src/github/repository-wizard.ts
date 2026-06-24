/**
 * Repository Wizard - Cloudflare Workers Edition
 * Hades Army v0.8.5 — Architecture Realignment Update
 *
 * Priority 4 + 5: GitHub-Centric Workflow + Telegram UX
 *
 * 8-step Repository Onboarding Wizard. Each step is a discrete
 * function that:
 *   - Receives the current wizard state + user input
 *   - Returns the next state + the message to display to the user
 *
 * The wizard is UI-agnostic — it can be driven from Telegram,
 * from the REST API, or from a CLI. The Telegram module (src/telegram)
 * renders the messages as inline keyboards; the REST API renders them
 * as JSON.
 *
 * Steps:
 *   1. Repository URL
 *   2. GitHub Token Guide
 *   3. Permission Validation
 *   4. Repository Scan
 *   5. Manager Interview
 *   6. Architecture Summary
 *   7. Roadmap Preview
 *   8. Project Activation
 */

import { logger } from "../utils/logger";
import { generateId } from "../utils/helpers";
import type { HadesBindings } from "../types";

import { RepositoryOnboarding, type OnboardingState } from "../memory/onboarding";

// ============================================
// Types
// ============================================

export type WizardStep =
  | "URL"
  | "TOKEN_GUIDE"
  | "PERMISSION_VALIDATION"
  | "REPOSITORY_SCAN"
  | "MANAGER_INTERVIEW"
  | "ARCHITECTURE_SUMMARY"
  | "ROADMAP_PREVIEW"
  | "ACTIVATION"
  | "COMPLETED";

export interface WizardState {
  wizardId: string;
  userId: string;
  step: WizardStep;
  onboardingState?: OnboardingState;
  /** user-supplied data across steps */
  repositoryFullName?: string;
  githubToken?: string; // never persist beyond wizard lifetime
  interviewAnswers: Record<string, string>;
  startedAt: string;
  completedAt?: string;
  abortReason?: string;
}

export interface WizardStepResult {
  state: WizardState;
  /** message to display to the user (Markdown) */
  message: string;
  /** next expected input from the user (free text or option key) */
  expectedInput: "text" | "option" | "none";
  /** options for the user to pick (when expectedInput = "option") */
  options?: Array<{ key: string; label: string }>;
}

// ============================================
// Wizard
// ============================================

export class RepositoryWizard {
  private env: HadesBindings;
  private onboarding: RepositoryOnboarding;

  constructor(env: HadesBindings) {
    this.env = env;
    this.onboarding = new RepositoryOnboarding(env);
  }

  // ============================================
  // Start
  // ============================================

  start(userId: string): WizardStepResult {
    const state: WizardState = {
      wizardId: generateId("wizard"),
      userId,
      step: "URL",
      interviewAnswers: {},
      startedAt: new Date().toISOString(),
    };
    return {
      state,
      message: this.urlPrompt(),
      expectedInput: "text",
    };
  }

  // ============================================
  // Step 1: URL
  // ============================================

  private urlPrompt(): string {
    return [
      `*Step 1 / 8 — Repository URL*`,
      ``,
      `Send me the GitHub repository you want Hades Army to work on.`,
      ``,
      `Accepted formats:`,
      `• \`https://github.com/owner/name\``,
      `• \`owner/name\``,
      ``,
      `_Hades Army needs read+write access to create branches and PRs._`,
    ].join("\n");
  }

  // ============================================
  // Drive one step forward
  // ============================================

  async advance(state: WizardState, input: string): Promise<WizardStepResult> {
    try {
      switch (state.step) {
        case "URL":
          return await this.stepUrl(state, input);
        case "TOKEN_GUIDE":
          return await this.stepTokenGuide(state, input);
        case "PERMISSION_VALIDATION":
          return await this.stepPermissionValidation(state);
        case "REPOSITORY_SCAN":
          return await this.stepScan(state);
        case "MANAGER_INTERVIEW":
          return await this.stepInterview(state, input);
        case "ARCHITECTURE_SUMMARY":
          return await this.stepArchitecture(state);
        case "ROADMAP_PREVIEW":
          return await this.stepRoadmap(state);
        case "ACTIVATION":
          return await this.stepActivation(state);
        case "COMPLETED":
          return {
            state,
            message: `✅ Onboarding already complete. Project ID: \`${state.onboardingState?.projectId}\``,
            expectedInput: "none",
          };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.abortReason = msg;
      logger.error(`Wizard ${state.wizardId} failed at ${state.step}: ${msg}`);
      return {
        state,
        message: `❌ Wizard failed at step *${state.step}*.\n\n\`${msg}\`\n\nStart over with /wizard.`,
        expectedInput: "none",
      };
    }
  }

  // ============================================
  // Step impls
  // ============================================

  private async stepUrl(state: WizardState, input: string): Promise<WizardStepResult> {
    const repo = this.parseRepoUrl(input.trim());
    if (!repo) {
      return { state, message: `❌ Could not parse repository URL. Try \`owner/name\`.`, expectedInput: "text" };
    }
    state.repositoryFullName = repo;
    state.step = "TOKEN_GUIDE";
    return {
      state,
      message: this.tokenGuidePrompt(repo),
      expectedInput: "text",
    };
  }

  private async stepTokenGuide(state: WizardState, input: string): Promise<WizardStepResult> {
    // Accept either a token OR an option like "I have it" / "How do I get one?"
    const trimmed = input.trim();
    if (trimmed.toLowerCase().startsWith("how")) {
      return {
        state,
        message: this.tokenHowToPrompt(),
        expectedInput: "text",
      };
    }
    if (!trimmed.startsWith("gh") && !trimmed.startsWith("github_pat_")) {
      return {
        state,
        message: `❌ That doesn't look like a GitHub token. Tokens start with \`ghp_\`, \`gho_\`, or \`github_pat_\`.`,
        expectedInput: "text",
      };
    }
    state.githubToken = trimmed;
    state.step = "PERMISSION_VALIDATION";
    return {
      state,
      message: `Validating permissions…`,
      expectedInput: "none",
    };
  }

  private async stepPermissionValidation(state: WizardState): Promise<WizardStepResult> {
    if (!state.onboardingState) {
      state.onboardingState = await this.onboarding.connect(state.repositoryFullName!, state.githubToken!);
    }
    state.onboardingState = await this.onboarding.validatePermissions(state.onboardingState, state.githubToken!);
    state.step = "REPOSITORY_SCAN";
    return {
      state,
      message: [
        `✅ Permissions validated.`,
        ``,
        `🏛 *Step 4 / 8 — Repository Scan*`,
        `Analyzing architecture, languages, frameworks…`,
      ].join("\n"),
      expectedInput: "none",
    };
  }

  private async stepScan(state: WizardState): Promise<WizardStepResult> {
    state.onboardingState = await this.onboarding.scanRepository(state.onboardingState!);
    state.step = "MANAGER_INTERVIEW";
    const scan = state.onboardingState!.scanResult!;
    return {
      state,
      message: [
        `✅ Scan complete.`,
        ``,
        `*Detected:*`,
        `• Languages: ${scan.languages.slice(0, 5).join(", ") || "—"}`,
        `• Frameworks: ${scan.frameworks.slice(0, 5).join(", ") || "—"}`,
        `• Style: \`${scan.architectureStyle}\``,
        ``,
        `🧠 *Step 5 / 8 — Manager Interview*`,
        `The Manager has prepared a few questions to understand your project.`,
        `Tap "Start Interview" to begin.`,
      ].join("\n"),
      expectedInput: "option",
      options: [{ key: "start_interview", label: "🧠 Start Interview" }],
    };
  }

  private async stepInterview(state: WizardState, input: string): Promise<WizardStepResult> {
    if (input === "start_interview" && !state.onboardingState?.interview) {
      state.onboardingState = await this.onboarding.conductInterview(state.onboardingState!);
    }
    const questions = state.onboardingState?.interview?.questions ?? [];

    // If input contains "answer:" prefix, store it
    const match = input.match(/^answer:(q\d+):(.+)$/i);
    if (match) {
      state.interviewAnswers[match[1].toLowerCase()] = match[2].trim();
    }

    const answeredCount = Object.keys(state.interviewAnswers).length;
    const nextQuestion = questions[answeredCount];

    if (!nextQuestion) {
      // All answered
      state.onboardingState = await this.onboarding.submitInterviewAnswers(
        state.onboardingState!,
        state.interviewAnswers,
      );
      state.step = "ARCHITECTURE_SUMMARY";
      return {
        state,
        message: `✅ Interview complete. Generating architecture summary…`,
        expectedInput: "none",
      };
    }

    return {
      state,
      message: [
        `*Question ${answeredCount + 1} / ${questions.length}*`,
        ``,
        `${nextQuestion}`,
        ``,
        `_Reply with: \`answer:q${answeredCount + 1}:your answer here\`_`,
      ].join("\n"),
      expectedInput: "text",
    };
  }

  private async stepArchitecture(state: WizardState): Promise<WizardStepResult> {
    state.onboardingState = await this.onboarding.generateArchitectureSummary(state.onboardingState!);
    state.step = "ROADMAP_PREVIEW";
    return {
      state,
      message: [
        `🏛 *Architecture Summary*`,
        ``,
        state.onboardingState!.architectureSummary!,
        ``,
        `_Generating roadmap preview…_`,
      ].join("\n"),
      expectedInput: "none",
    };
  }

  private async stepRoadmap(state: WizardState): Promise<WizardStepResult> {
    state.onboardingState = await this.onboarding.generateRoadmapPreview(state.onboardingState!);
    state.step = "ACTIVATION";
    return {
      state,
      message: [
        `🗺 *Roadmap Preview*`,
        ``,
        state.onboardingState!.roadmapPreview!,
        ``,
        `Tap "Activate Project" to finalize onboarding.`,
      ].join("\n"),
      expectedInput: "option",
      options: [{ key: "activate", label: "✅ Activate Project" }],
    };
  }

  private async stepActivation(state: WizardState): Promise<WizardStepResult> {
    state.onboardingState = await this.onboarding.activate(state.onboardingState!);
    state.step = "COMPLETED";
    state.completedAt = new Date().toISOString();
    return {
      state,
      message: [
        `🎉 *Project Activated*`,
        ``,
        `• Repository: \`${state.repositoryFullName}\``,
        `• Project ID: \`${state.onboardingState!.projectId}\``,
        `• \`.hades/\` memory initialized`,
        ``,
        `You can now send your first request — the Manager will plan, build, review, and open a PR for you.`,
      ].join("\n"),
      expectedInput: "none",
    };
  }

  // ============================================
  // Helpers
  // ============================================

  private parseRepoUrl(input: string): string | undefined {
    const trimmed = input.trim();
    // owner/name
    const shortMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
    if (shortMatch) return `${shortMatch[1]}/${shortMatch[2].replace(/\.git$/, "")}`;
    // https://github.com/owner/name
    const urlMatch = trimmed.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/i);
    if (urlMatch) return `${urlMatch[1]}/${urlMatch[2].replace(/\.git$/, "")}`;
    // git@github.com:owner/name.git
    const sshMatch = trimmed.match(/^git@github\.com:([\w.-]+)\/([\w.-]+)\.git$/);
    if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;
    return undefined;
  }

  private tokenGuidePrompt(repo: string): string {
    return [
      `*Step 2 / 8 — GitHub Token*`,
      ``,
      `Hades Army needs a Personal Access Token to:`,
      `• Read repository contents`,
      `• Create branches (\`hades/*\`)`,
      `• Open pull requests`,
      `• Merge approved PRs`,
      ``,
      `Token requirements:`,
      `• Scope: \`repo\` (or fine-grained: \`Contents: Read and write\`, \`Pull requests: Read and write\`)`,
      `• Expiration: 90 days recommended`,
      ``,
      `Create one at: https://github.com/settings/tokens/new?scopes=repo&description=Hades+Army`,
      ``,
      `Send the token now, or reply \`how\` for more help.`,
      ``,
      `_Repository: \`${repo}\`_`,
    ].join("\n");
  }

  private tokenHowToPrompt(): string {
    return [
      `*How to create a GitHub Token*`,
      ``,
      `1. Open https://github.com/settings/tokens/new`,
      `2. Set **Note**: \`Hades Army\``,
      `3. Check **Scopes**: \`repo\` (covers contents, PRs, branches)`,
      `4. Click **Generate token**`,
      `5. Copy the token (starts with \`ghp_\`)`,
      `6. Paste it back here`,
      ``,
      `⚠️ Hades Army stores the token only in your worker's secret store. It is never logged.`,
    ].join("\n");
  }
}
