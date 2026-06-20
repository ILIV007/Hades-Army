/**
 * Hades Army v0.6 - Configuration
 * Central configuration management
 */

import type { LLMProvider, ProjectSettings } from './types';

export const CONFIG = {
  // System
  VERSION: '0.6.0',
  NAME: 'Hades Army',
  CODENAME: 'Ultimate',

  // Limits
  MAX_CONCURRENT_TASKS: 5,
  MAX_FILE_SIZE: 1024 * 1024, // 1MB
  MAX_REPOSITORY_FILES: 50000,
  MAX_CONTEXT_TOKENS: 128000,

  // Timeouts
  GITHUB_TIMEOUT: 30000,
  LLM_TIMEOUT: 120000,
  TELEGRAM_TIMEOUT: 10000,

  // Context Management
  CONTEXT_COMPRESSION_THRESHOLD: 0.8,
  SEMANTIC_SUMMARY_MAX_TOKENS: 2000,
  RELEVANCE_THRESHOLD: 0.6,

  // Repository Intelligence
  HOTSPOT_CHANGE_THRESHOLD: 5,
  COMPLEXITY_THRESHOLD: 20,
  TECHNICAL_DEBT_THRESHOLD: 50,

  // Health
  HEALTH_CHECK_INTERVAL: 60000, // 1 minute
  PROVIDER_CHECK_INTERVAL: 30000, // 30 seconds

  // Recovery
  SNAPSHOT_INTERVAL: 300000, // 5 minutes
  MAX_SNAPSHOT_AGE: 86400000, // 24 hours

  // Security
  SECRET_SCAN_PATTERNS: [
    { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g, severity: 'critical' as const },
    { name: 'AWS Secret Key', regex: /[0-9a-zA-Z/+]{40}/g, severity: 'critical' as const },
    { name: 'GitHub Token', regex: /ghp_[0-9a-zA-Z]{36}/g, severity: 'critical' as const },
    { name: 'GitHub OAuth', regex: /gho_[0-9a-zA-Z]{36}/g, severity: 'critical' as const },
    { name: 'Slack Token', regex: /xox[baprs]-[0-9a-zA-Z]{10,48}/g, severity: 'high' as const },
    { name: 'Private Key', regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, severity: 'critical' as const },
    { name: 'API Key Generic', regex: /api[_-]?key[\s]*[:=][\s]*['"][0-9a-zA-Z]{32,}/gi, severity: 'high' as const },
    { name: 'Password', regex: /password[\s]*[:=][\s]*['"][^'"]{8,}/gi, severity: 'high' as const },
    { name: 'Database URL', regex: /(mongodb|postgres|mysql)://[^\s]+/g, severity: 'high' as const },
    { name: 'JWT Secret', regex: /jwt[_-]?secret[\s]*[:=][\s]*['"][^'"]{16,}/gi, severity: 'high' as const },
    { name: 'OpenAI Key', regex: /sk-[0-9a-zA-Z]{48}/g, severity: 'critical' as const },
    { name: 'Telegram Bot Token', regex: /[0-9]{8,10}:[a-zA-Z0-9_-]{35}/g, severity: 'high' as const },
  ],

  // Scoring Weights
  SCORING: {
    architecture: 0.25,
    repository: 0.20,
    memory: 0.15,
    workflow: 0.15,
    review: 0.15,
    agent: 0.10,
  },

  // Interview Steps
  INTERVIEW_STEPS: [
    { stepNumber: 1, title: 'Repository URL', question: 'Enter your GitHub repository URL:', type: 'repository_url' as const, required: true },
    { stepNumber: 2, title: 'Repository Validation', question: 'Validating repository access and permissions...', type: 'text' as const, required: true },
    { stepNumber: 3, title: 'Permission Validation', question: 'Checking GitHub token permissions...', type: 'text' as const, required: true },
    { stepNumber: 4, title: 'Repository Scan', question: 'Scanning repository structure and dependencies...', type: 'text' as const, required: true },
    { stepNumber: 5, title: 'Manager Interview', question: 'What is the primary goal of this project?', type: 'text' as const, required: true },
    { stepNumber: 6, title: 'Architecture Proposal', question: 'Reviewing proposed architecture...', type: 'architecture_proposal' as const, required: true },
    { stepNumber: 7, title: 'Approval', question: 'Do you approve the architecture proposal?', type: 'choice' as const, options: ['Yes', 'No, request changes'], required: true },
    { stepNumber: 8, title: 'Activation', question: 'Activating project...', type: 'text' as const, required: true },
  ],

  // Default Settings
  DEFAULT_PROJECT_SETTINGS: {
    autoReview: true,
    requireApproval: true,
    maxConcurrentTasks: 3,
    preferredProvider: 'openrouter',
    secretScanEnabled: true,
    architectureCheckEnabled: true,
  } as ProjectSettings,

  // LLM Providers
  LLM_PROVIDERS: {
    openrouter: {
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'google/gemini-1.5-pro'],
      defaultModel: 'anthropic/claude-3.5-sonnet',
      maxTokens: 128000,
      temperature: 0.7,
    } as LLMProvider,
    google: {
      name: 'Google AI Studio',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
      defaultModel: 'gemini-1.5-pro',
      maxTokens: 128000,
      temperature: 0.7,
    } as LLMProvider,
  },
} as const;

export type ConfigKey = keyof typeof CONFIG;
