/**
 * JSON Logger - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  [key: string]: unknown;
}

export class Logger {
  private level: string;
  private levels: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
  };

  constructor(level: string = "info") {
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
}

export const logger = new Logger(process.env.LOG_LEVEL || "info");
