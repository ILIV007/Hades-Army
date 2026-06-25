/**
 * JSON Logger - Cloudflare Workers Edition
 * Hades Army v0.9.1 — Production Readiness
 *
 * Cloudflare Workers are NOT Node.js. The `process` global does not
 * exist at runtime. This module is therefore:
 *
 *   1. Free of any `process.*`, `process.env`, `Buffer`, `__dirname`,
 *      `__filename`, `require()`, and other Node.js globals.
 *   2. Lazy-Initialised — the singleton starts at the default level
 *      ("info") and is re-configured once the Hono app boots and the
 *      Env bindings become available (see `configureLogger(env)`).
 *
 * Usage:
 *   import { logger, configureLogger } from "./utils/logger";
 *   // At worker entry:
 *   configureLogger(c.env);
 *   logger.info("ready");
 *
 * If the worker never calls `configureLogger()`, the logger still
 * works at the default "info" level — it just won't pick up the
 * LOG_LEVEL variable from wrangler.toml.
 */

import type { HadesBindings } from "../types";

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  [key: string]: unknown;
}

const DEFAULT_LEVEL = "info";

export class Logger {
  private level: string;
  private levels: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
  };

  constructor(level: string = DEFAULT_LEVEL) {
    this.level = level;
  }

  private log(level: string, message: string, meta?: Record<string, unknown>): void {
    if (this.levels[level] < this.levels[this.level]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      ...meta,
    };

    // console.log is available in the Cloudflare Workers runtime —
    // it routes to wrangler tail / observability.
    console.log(JSON.stringify(entry));
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }

  fatal(message: string, meta?: Record<string, unknown>): void {
    this.log("fatal", message, meta);
  }

  setLevel(level: string): void {
    this.level = level;
  }

  getLevel(): string {
    return this.level;
  }
}

// ============================================
// Singleton (lazy-initialised at default level)
// ============================================

export const logger = new Logger(DEFAULT_LEVEL);

/**
 * Re-configure the singleton logger from the Worker's Env bindings.
 * Call this ONCE at the very top of the worker entry point
 * (src/index.ts) so that subsequent `logger.info(...)` calls honor
 * the LOG_LEVEL variable from wrangler.toml.
 *
 * This avoids the previous `process.env.LOG_LEVEL` reference that
 * caused `ReferenceError: process is not defined` on Cloudflare.
 */
export function configureLogger(env: Pick<HadesBindings, "LOG_LEVEL">): void {
  if (env?.LOG_LEVEL) {
    logger.setLevel(env.LOG_LEVEL);
  }
}
