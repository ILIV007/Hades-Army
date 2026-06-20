/**
 * Hades Army v0.6 - Persistent Interview System
 * Stores interview state in D1 for recovery across worker restarts
 */

import type { Interview, InterviewStep, Project } from '../core/types';
import type { DBContext } from '../db';
import { createInterview, getInterview, getInterviewByProject, updateInterview, createProject, updateProject } from '../db';
import { CONFIG } from '../core/config';
import { validateRepository } from '../github';

export interface InterviewState {
  interviewId: number;
  projectId: number;
  currentStep: number;
  totalSteps: number;
  answers: Record<string, string>;
  status: 'in_progress' | 'completed' | 'abandoned';
  architectureProposal?: string;
  approved: boolean;
}

export async function startInterview(
  ctx: DBContext,
  repoUrl: string,
  githubToken?: string
): Promise<InterviewState> {
  // Extract owner and repo from URL
  const urlMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
  if (!urlMatch) {
    throw new Error('Invalid GitHub repository URL');
  }

  const [, owner, repo] = urlMatch;

  // Create project
  const project = await createProject(ctx, {
    name: repo,
    repoUrl,
    repoOwner: owner,
    repoName: repo,
    githubToken,
    status: 'interviewing',
    complexityScore: 0,
    architectureScore: 0,
    healthScore: 0,
    memoryScore: 0,
  });

  // Create interview
  const interview = await createInterview(ctx, {
    projectId: project.id,
    status: 'in_progress',
    currentStep: 1,
    totalSteps: CONFIG.INTERVIEW_STEPS.length,
    answers: {},
    approved: false,
  });

  return {
    interviewId: interview.id,
    projectId: project.id,
    currentStep: 1,
    totalSteps: CONFIG.INTERVIEW_STEPS.length,
    answers: {},
    status: 'in_progress',
    approved: false,
  };
}

export async function resumeInterview(ctx: DBContext, projectId: number): Promise<InterviewState | null> {
  const interview = await getInterviewByProject(ctx, projectId);
  if (!interview) return null;

  return {
    interviewId: interview.id,
    projectId: interview.projectId,
    currentStep: interview.currentStep,
    totalSteps: interview.totalSteps,
    answers: interview.answers || {},
    status: interview.status,
    architectureProposal: interview.architectureProposal || undefined,
    approved: interview.approved,
  };
}

export async function processStep(
  ctx: DBContext,
  state: InterviewState,
  answer: string
): Promise<{
  state: InterviewState;
  nextStep?: InterviewStep;
  result?: {
    type: 'validation' | 'proposal' | 'complete';
    data: unknown;
  };
}> {
  const step = CONFIG.INTERVIEW_STEPS[state.currentStep - 1];
  if (!step) {
    return { state };
  }

  // Save answer
  const answers = { ...state.answers, [step.title]: answer };

  let updatedState: InterviewState = {
    ...state,
    answers,
  };

  // Process based on step type
  switch (step.type) {
    case 'repository_url':
      // Validate repository
      updatedState = await handleRepositoryValidation(ctx, updatedState, answer);
      break;

    case 'architecture_proposal':
      // Generate architecture proposal
      updatedState = await handleArchitectureProposal(ctx, updatedState);
      break;

    case 'choice':
      if (step.title === 'Approval') {
        updatedState.approved = answer.toLowerCase().includes('yes');
        if (updatedState.approved) {
          updatedState.status = 'completed';
          // Activate project
          await updateProject(ctx, state.projectId, { status: 'active' });
        }
      }
      break;

    default:
      break;
  }

  // Move to next step
  if (state.currentStep < state.totalSteps) {
    updatedState.currentStep++;
  }

  // Save to database
  await updateInterview(ctx, state.interviewId, {
    currentStep: updatedState.currentStep,
    answers: updatedState.answers,
    status: updatedState.status,
    architectureProposal: updatedState.architectureProposal,
    approved: updatedState.approved,
  });

  const nextStep = CONFIG.INTERVIEW_STEPS[updatedState.currentStep - 1];

  return {
    state: updatedState,
    nextStep,
  };
}

async function handleRepositoryValidation(
  ctx: DBContext,
  state: InterviewState,
  repoUrl: string
): Promise<InterviewState> {
  const project = await ctx.db.prepare('SELECT * FROM projects WHERE id = ?').bind(state.projectId).first();
  if (!project) return state;

  const githubToken = project.github_token as string | undefined;
  if (!githubToken) return state;

  try {
    const { validateRepository } = await import('../github');
    const validation = await validateRepository({
      token: githubToken,
      owner: project.repo_owner as string,
      repo: project.repo_name as string,
    });

    // Store validation result in answers
    return {
      ...state,
      answers: {
        ...state.answers,
        'Repository Validation': validation.valid ? 'Valid' : 'Invalid',
        'Permissions': validation.permissions.join(', '),
        'Issues': validation.issues.join('; '),
      },
    };
  } catch {
    return state;
  }
}

async function handleArchitectureProposal(
  ctx: DBContext,
  state: InterviewState
): Promise<InterviewState> {
  // Generate a basic architecture proposal based on answers
  const projectGoals = state.answers['Manager Interview'] || '';

  const proposal = `# Architecture Proposal for Project ${state.projectId}

## Goals
${projectGoals}

## Proposed Architecture
Based on the project requirements, we recommend:

1. **Modular Design**: Separate concerns into distinct modules
2. **Clean Interfaces**: Well-defined APIs between components
3. **Test Coverage**: Comprehensive test suite
4. **Documentation**: Clear architecture documentation

## Next Steps
1. Repository scanning and analysis
2. Dependency mapping
3. Task creation and assignment
4. Continuous monitoring

## Approval Required
Please review and approve this proposal to activate the project.
`;

  return {
    ...state,
    architectureProposal: proposal,
  };
}

export async function abandonInterview(ctx: DBContext, interviewId: number): Promise<void> {
  await updateInterview(ctx, interviewId, {
    status: 'abandoned',
  });
}

export function getInterviewProgress(state: InterviewState): {
  percentage: number;
  currentStep: InterviewStep;
  remainingSteps: number;
} {
  const percentage = ((state.currentStep - 1) / state.totalSteps) * 100;
  const currentStep = CONFIG.INTERVIEW_STEPS[state.currentStep - 1];
  const remainingSteps = state.totalSteps - state.currentStep + 1;

  return {
    percentage,
    currentStep,
    remainingSteps,
  };
}

export function formatInterviewStatus(state: InterviewState): string {
  const progress = getInterviewProgress(state);

  let status = `## Interview Status\n\n`;
  status += `**Progress:** ${progress.percentage.toFixed(0)}%\n`;
  status += `**Current Step:** ${progress.currentStep.title}\n`;
  status += `**Remaining Steps:** ${progress.remainingSteps}\n\n`;

  if (state.architectureProposal) {
    status += `## Architecture Proposal\n${state.architectureProposal}\n\n`;
  }

  if (state.approved) {
    status += `**Status:** Approved and Active\n`;
  } else if (state.status === 'abandoned') {
    status += `**Status:** Abandoned\n`;
  } else {
    status += `**Status:** In Progress\n`;
  }

  return status;
}
