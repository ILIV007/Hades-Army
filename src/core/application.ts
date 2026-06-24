/**
 * Application State - Cloudflare Workers Edition
 * Hades Army v0.8.0
 */

import { logger } from "../utils/logger";

export class ApplicationManager {
  private requestCount: number = 0;
  private errorCount: number = 0;
  private startTime: number = Date.now();

  incrementRequests(): void {
    this.requestCount++;
  }

  incrementErrors(): void {
    this.errorCount++;
  }

  getStats(): { requests: number; errors: number; uptime: number; errorRate: number } {
    const uptime = Date.now() - this.startTime;
    return {
      requests: this.requestCount,
      errors: this.errorCount,
      uptime,
      errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0,
    };
  }
}

export const appManager = new ApplicationManager();
