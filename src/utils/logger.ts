/**
 * Hades Army v0.2 — Structured Logging System
 * Logs to D1 for persistence and console for debugging.
 * Pure ESM.
 */

import type { HadesEnv } from "../config/env";
import type { SystemLog, LogType } from "../types";

export class Logger {
  constructor(
    private env: HadesEnv,
    private projectId?: string,
    private taskId?: string
  ) {}

  private async write(
    level: SystemLog["level"],
    type: LogType,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const log: SystemLog = {
      id: crypto.randomUUID(),
      projectId: this.projectId,
      taskId: this.taskId,
      type,
      level,
      message,
      metadata,
      timestamp: new Date().toISOString(),
    };

    console.log(JSON.stringify(log));

    try {
      await this.env.HADES_D1.prepare(
        `INSERT INTO logs (id, project_id, task_id, type, level, message, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          log.id,
          log.projectId ?? null,
          log.taskId ?? null,
          log.type,
          log.level,
          log.message,
          metadata ? JSON.stringify(metadata) : null,
          log.timestamp
        )
        .run();
    } catch (e) {
      console.error(`[Logger D1 Error] ${e}`);
    }
  }

  debug(type: LogType, message: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.write("debug", type, message, metadata);
  }

  info(type: LogType, message: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.write("info", type, message, metadata);
  }

  warn(type: LogType, message: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.write("warn", type, message, metadata);
  }

  error(type: LogType, message: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.write("error", type, message, metadata);
  }
}
