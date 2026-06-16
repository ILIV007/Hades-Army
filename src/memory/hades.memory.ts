/**
 * Hades Army — Repository Memory (.hades/) Manager
 * Primary source of truth for project memory.
 */

import type { HadesEnv } from '../config/env';
import type { Project, HadesMemory, Task, ReviewMemory, DecisionMemory, ProjectIndex } from '../types';
import { Logger } from '../utils/logger';

export class HadesMemoryManager {
  private logger: Logger;

  constructor(
    private env: HadesEnv,
    private project: Project
  ) {
    this.logger = new Logger(env, project.id);
  }

  private get githubToken(): Promise<string> {
    const { decrypt } = require('../utils/crypto');
    return decrypt(this.project.githubTokenEncrypted, this.env.ENCRYPTION_KEY);
  }

  private get apiBase() {
    return this.env.GITHUB_API_BASE_URL;
  }

  private async githubHeaders(): Promise<Record<string, string>> {
    const token = await this.githubToken;
    return {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Hades-Army/1.0',
    };
  }

  // ============================================================
  // READ MEMORY
  // ============================================================

  async readMemory(): Promise<HadesMemory | null> {
    try {
      const content = await this.fetchFileContent('.hades/project_state.json');
      if (!content) return null;

      const projectState = JSON.parse(content);

      const [tasksRaw, reviewsRaw, decisionsRaw, contextRaw, indexRaw] = await Promise.all([
        this.fetchFileContent('.hades/tasks.json'),
        this.fetchFileContent('.hades/reviews.json'),
        this.fetchFileContent('.hades/decisions.json'),
        this.fetchFileContent('.hades/context.json'),
        this.fetchFileContent('.hades/project_index.json'),
      ]);

      return {
        version: '1.0.0',
        projectState: projectState.projectState ?? { currentStatus: 'unknown', activeTaskId: null, lastUpdated: new Date().toISOString(), metadata: {} },
        tasks: tasksRaw ? JSON.parse(tasksRaw).tasks ?? [] : [],
        reviews: reviewsRaw ? JSON.parse(reviewsRaw).reviews ?? [] : [],
        decisions: decisionsRaw ? JSON.parse(decisionsRaw).decisions ?? [] : [],
        context: contextRaw ? JSON.parse(contextRaw).context ?? { recentTasks: [], recentDecisions: [], activeFiles: [], workingNotes: '' } : { recentTasks: [], recentDecisions: [], activeFiles: [], workingNotes: '' },
        index: indexRaw ? JSON.parse(indexRaw) : { version: '1.0.0', generatedAt: new Date().toISOString(), files: [], modules: [], dependencies: [] },
      };
    } catch (error) {
      await this.logger.error('memory', `Failed to read .hades memory: ${error}`);
      return null;
    }
  }

  // ============================================================
  // WRITE MEMORY
  // ============================================================

  async writeMemory(memory: Partial<HadesMemory>): Promise<void> {
    const headers = await this.githubHeaders();
    const branch = this.project.defaultBranch;

    const files: { path: string; content: string }[] = [];

    if (memory.projectState) {
      files.push({
        path: '.hades/project_state.json',
        content: JSON.stringify({ projectState: memory.projectState, version: '1.0.0' }, null, 2),
      });
    }

    if (memory.tasks) {
      files.push({
        path: '.hades/tasks.json',
        content: JSON.stringify({ tasks: memory.tasks, version: '1.0.0' }, null, 2),
      });
    }

    if (memory.reviews) {
      files.push({
        path: '.hades/reviews.json',
        content: JSON.stringify({ reviews: memory.reviews, version: '1.0.0' }, null, 2),
      });
    }

    if (memory.decisions) {
      files.push({
        path: '.hades/decisions.json',
        content: JSON.stringify({ decisions: memory.decisions, version: '1.0.0' }, null, 2),
      });
    }

    if (memory.context) {
      files.push({
        path: '.hades/context.json',
        content: JSON.stringify({ context: memory.context, version: '1.0.0' }, null, 2),
      });
    }

    if (memory.index) {
      files.push({
        path: '.hades/project_index.json',
        content: JSON.stringify(memory.index, null, 2),
      });
    }

    for (const file of files) {
      await this.createOrUpdateFile(file.path, file.content, branch, headers);
    }

    await this.logger.info('memory', `Updated ${files.length} .hades files`);
  }

  // ============================================================
  // INITIALIZE .hades DIRECTORY
  // ============================================================

  async initializeHadesDirectory(): Promise<void> {
    const headers = await this.githubHeaders();
    const branch = this.project.defaultBranch;

    // Check if .hades already exists
    try {
      const check = await fetch(
        `${this.apiBase}/repos/${this.project.repoOwner}/${this.project.repoName}/contents/.hades?ref=${branch}`,
        { headers }
      );
      if (check.status === 200) {
        await this.logger.info('memory', '.hades directory already exists');
        return;
      }
    } catch {
      // Directory doesn't exist, create it
    }

    const initialFiles = [
      {
        path: '.hades/project_state.json',
        content: JSON.stringify({
          version: '1.0.0',
          projectState: {
            currentStatus: 'initialized',
            activeTaskId: null,
            lastUpdated: new Date().toISOString(),
            metadata: {},
          },
        }, null, 2),
      },
      {
        path: '.hades/tasks.json',
        content: JSON.stringify({ version: '1.0.0', tasks: [] }, null, 2),
      },
      {
        path: '.hades/reviews.json',
        content: JSON.stringify({ version: '1.0.0', reviews: [] }, null, 2),
      },
      {
        path: '.hades/decisions.json',
        content: JSON.stringify({ version: '1.0.0', decisions: [] }, null, 2),
      },
      {
        path: '.hades/context.json',
        content: JSON.stringify({
          version: '1.0.0',
          context: {
            recentTasks: [],
            recentDecisions: [],
            activeFiles: [],
            workingNotes: '',
          },
        }, null, 2),
      },
      {
        path: '.hades/project_index.json',
        content: JSON.stringify({
          version: '1.0.0',
          generatedAt: new Date().toISOString(),
          files: [],
          modules: [],
          dependencies: [],
        }, null, 2),
      },
    ];

    for (const file of initialFiles) {
      await this.createOrUpdateFile(file.path, file.content, branch, headers);
    }

    await this.logger.info('memory', 'Initialized .hades directory');
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private async fetchFileContent(path: string): Promise<string | null> {
    const headers = await this.githubHeaders();
    const url = `${this.apiBase}/repos/${this.project.repoOwner}/${this.project.repoName}/contents/${path}?ref=${this.project.defaultBranch}`;

    const res = await fetch(url, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const data = await res.json() as { content: string; encoding: string };
    if (data.encoding === 'base64') {
      return atob(data.content.replace(/\s/g, ''));
    }
    return data.content;
  }

  private async createOrUpdateFile(
    path: string,
    content: string,
    branch: string,
    headers: Record<string, string>
  ): Promise<void> {
    // Get current SHA if file exists
    let sha: string | undefined;
    try {
      const checkRes = await fetch(
        `${this.apiBase}/repos/${this.project.repoOwner}/${this.project.repoName}/contents/${path}?ref=${branch}`,
        { headers }
      );
      if (checkRes.ok) {
        const checkData = await checkRes.json() as { sha: string };
        sha = checkData.sha;
      }
    } catch {
      // File doesn't exist
    }

    const body: Record<string, string> = {
      message: `[hades] Update ${path}`,
      content: btoa(content),
      branch,
    };
    if (sha) body.sha = sha;

    const res = await fetch(
      `${this.apiBase}/repos/${this.project.repoOwner}/${this.project.repoName}/contents/${path}`,
      {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to write ${path}: ${res.status} ${err}`);
    }
  }
}
