/**
 * Hades Army — Environment Configuration
 * All secrets come from Cloudflare Worker secrets (env bindings)
 */

export interface HadesEnv {
  // Telegram
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;

  // AI Providers
  OPENROUTER_API_KEY: string;
  OPENROUTER_BASE_URL: string;
  GOOGLE_AI_API_KEY?: string;
  GOOGLE_AI_BASE_URL?: string;

  // GitHub
  GITHUB_TOKEN: string;
  GITHUB_API_BASE_URL: string;

  // Cloudflare
  HADES_D1: D1Database;
  HADES_KV: KVNamespace;

  // Encryption
  ENCRYPTION_KEY: string;

  // App Config
  HADES_VERSION: string;
  DEFAULT_MANAGER_MODEL: string;
  DEFAULT_BUILDER_MODEL: string;
  DEFAULT_REVIEWER_MODEL: string;
}

export function validateEnv(env: Record<string, unknown>): HadesEnv {
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'OPENROUTER_API_KEY',
    'GITHUB_TOKEN',
    'ENCRYPTION_KEY',
    'HADES_D1',
    'HADES_KV',
  ];

  for (const key of required) {
    if (!env[key]) {
      throw new Error(`Missing required env: ${key}`);
    }
  }

  return {
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN as string,
    TELEGRAM_WEBHOOK_SECRET: (env.TELEGRAM_WEBHOOK_SECRET as string) || undefined,
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY as string,
    OPENROUTER_BASE_URL: (env.OPENROUTER_BASE_URL as string) || 'https://openrouter.ai/api/v1',
    GOOGLE_AI_API_KEY: (env.GOOGLE_AI_API_KEY as string) || undefined,
    GOOGLE_AI_BASE_URL: (env.GOOGLE_AI_BASE_URL as string) || 'https://generativelanguage.googleapis.com/v1beta',
    GITHUB_TOKEN: env.GITHUB_TOKEN as string,
    GITHUB_API_BASE_URL: (env.GITHUB_API_BASE_URL as string) || 'https://api.github.com',
    HADES_D1: env.HADES_D1 as D1Database,
    HADES_KV: env.HADES_KV as KVNamespace,
    ENCRYPTION_KEY: env.ENCRYPTION_KEY as string,
    HADES_VERSION: (env.HADES_VERSION as string) || '1.0.0',
    DEFAULT_MANAGER_MODEL: (env.DEFAULT_MANAGER_MODEL as string) || 'google/gemini-3-flash',
    DEFAULT_BUILDER_MODEL: (env.DEFAULT_BUILDER_MODEL as string) || 'qwen/qwen3-coder',
    DEFAULT_REVIEWER_MODEL: (env.DEFAULT_REVIEWER_MODEL as string) || 'deepseek/deepseek-v3.1',
  };
}
