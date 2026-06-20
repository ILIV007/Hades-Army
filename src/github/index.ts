/**
 * Hades Army v0.6 - GitHub Integration
 * Full GitHub API integration with repository intelligence
 */

import type { GitHubRepository, GitHubFile, GitHubPR } from '../core/types';
import { GitHubError } from '../core/errors';

interface GitHubContext {
  token: string;
  owner: string;
  repo: string;
}

const GITHUB_API_BASE = 'https://api.github.com';

async function githubFetch(ctx: GitHubContext, endpoint: string, options: RequestInit = {}): Promise<Response> {
  const url = `${GITHUB_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${ctx.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Hades-Army-v0.6',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new GitHubError(`GitHub API error: ${response.status} - ${errorText}`, response.status);
  }

  return response;
}

// ============================================================================
// REPOSITORY OPERATIONS
// ============================================================================

export async function getRepository(ctx: GitHubContext): Promise<GitHubRepository> {
  const response = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}`);
  const data = await response.json();

  return {
    id: data.id,
    name: data.name,
    fullName: data.full_name,
    owner: data.owner.login,
    url: data.html_url,
    defaultBranch: data.default_branch,
    languages: data.language ? { [data.language]: 100 } : {},
    stars: data.stargazers_count,
    forks: data.forks_count,
    openIssues: data.open_issues_count,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    pushedAt: data.pushed_at,
  };
}

export async function getRepositoryLanguages(ctx: GitHubContext): Promise<Record<string, number>> {
  const response = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/languages`);
  return await response.json();
}

export async function validateRepository(ctx: GitHubContext): Promise<{
  valid: boolean;
  permissions: string[];
  issues: string[];
}> {
  try {
    const response = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}`);
    const data = await response.json();

    const permissions: string[] = [];
    const issues: string[] = [];

    if (data.permissions?.admin) permissions.push('admin');
    if (data.permissions?.push) permissions.push('push');
    if (data.permissions?.pull) permissions.push('pull');

    if (!data.permissions?.push) {
      issues.push('No push access. Cannot create branches or PRs.');
    }
    if (!data.permissions?.admin) {
      issues.push('No admin access. Cannot manage webhooks or settings.');
    }

    return {
      valid: data.permissions?.push === true,
      permissions,
      issues,
    };
  } catch (error) {
    return {
      valid: false,
      permissions: [],
      issues: [error instanceof Error ? error.message : 'Repository not found or inaccessible'],
    };
  }
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

export async function getFileTree(ctx: GitHubContext, path: string = '', branch?: string): Promise<GitHubFile[]> {
  const branchParam = branch ? `?ref=${branch}` : '';
  const response = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${path}${branchParam}`);
  const data = await response.json();

  if (!Array.isArray(data)) {
    return [{
      path: data.path,
      name: data.name,
      type: 'file',
      size: data.size,
      sha: data.sha,
      content: data.content ? atob(data.content.replace(/\s/g, '')) : undefined,
      downloadUrl: data.download_url,
    }];
  }

  return data.map((item: Record<string, unknown>) => ({
    path: item.path as string,
    name: item.name as string,
    type: item.type as 'file' | 'directory',
    size: (item.size as number) || 0,
    sha: item.sha as string,
    downloadUrl: item.download_url as string | undefined,
  }));
}

export async function getFileContent(ctx: GitHubContext, path: string, branch?: string): Promise<string> {
  const branchParam = branch ? `?ref=${branch}` : '';
  const response = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${path}${branchParam}`);
  const data = await response.json();

  if (data.content) {
    return atob(data.content.replace(/\s/g, ''));
  }

  if (data.download_url) {
    const contentResponse = await fetch(data.download_url, {
      headers: { 'Authorization': `Bearer ${ctx.token}` },
    });
    return await contentResponse.text();
  }

  throw new GitHubError(`Could not retrieve content for ${path}`);
}

export async function getAllFiles(ctx: GitHubContext, path: string = '', branch?: string): Promise<GitHubFile[]> {
  const files: GitHubFile[] = [];
  const queue: string[] = [path];

  while (queue.length > 0) {
    const currentPath = queue.shift()!;
    try {
      const items = await getFileTree(ctx, currentPath, branch);
      for (const item of items) {
        if (item.type === 'file') {
          files.push(item);
        } else if (item.type === 'directory') {
          queue.push(item.path);
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return files;
}

// ============================================================================
// BRANCH OPERATIONS
// ============================================================================

export async function createBranch(ctx: GitHubContext, branchName: string, baseBranch?: string): Promise<void> {
  // Get base branch SHA
  const baseResponse = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/git/refs/heads/${baseBranch || 'main'}`);
  const baseData = await baseResponse.json();
  const baseSha = baseData.object.sha;

  // Create new branch
  await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    }),
  });
}

export async function getBranches(ctx: GitHubContext): Promise<string[]> {
  const response = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/branches`);
  const data = await response.json();
  return data.map((b: Record<string, unknown>) => b.name as string);
}

// ============================================================================
// COMMIT OPERATIONS
// ============================================================================

export async function createCommit(
  ctx: GitHubContext,
  branch: string,
  message: string,
  files: Array<{ path: string; content: string }>
): Promise<string> {
  // Get current branch SHA
  const refResponse = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/git/refs/heads/${branch}`);
  const refData = await refResponse.json();
  const parentSha = refData.object.sha;

  // Get parent commit tree
  const commitResponse = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/git/commits/${parentSha}`);
  const commitData = await commitResponse.json();
  const baseTreeSha = commitData.tree.sha;

  // Create blobs for each file
  const treeEntries = [];
  for (const file of files) {
    const blobResponse = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: btoa(file.content),
        encoding: 'base64',
      }),
    });
    const blobData = await blobResponse.json();
    treeEntries.push({
      path: file.path,
      mode: '100644',
      type: 'blob',
      sha: blobData.sha,
    });
  }

  // Create new tree
  const treeResponse = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries,
    }),
  });
  const treeData = await treeResponse.json();

  // Create commit
  const newCommitResponse = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: treeData.sha,
      parents: [parentSha],
    }),
  });
  const newCommitData = await newCommitResponse.json();

  // Update branch reference
  await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sha: newCommitData.sha,
      force: false,
    }),
  });

  return newCommitData.sha;
}

// ============================================================================
// PULL REQUEST OPERATIONS
// ============================================================================

export async function createPullRequest(
  ctx: GitHubContext,
  title: string,
  body: string,
  head: string,
  base?: string
): Promise<GitHubPR> {
  const response = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      body,
      head,
      base: base || 'main',
    }),
  });

  const data = await response.json();
  return mapPR(data);
}

export async function getPullRequests(ctx: GitHubContext, state: 'open' | 'closed' | 'all' = 'open'): Promise<GitHubPR[]> {
  const response = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/pulls?state=${state}`);
  const data = await response.json();
  return data.map(mapPR);
}

export async function getPullRequest(ctx: GitHubContext, number: number): Promise<GitHubPR> {
  const response = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/pulls/${number}`);
  const data = await response.json();
  return mapPR(data);
}

export async function mergePullRequest(ctx: GitHubContext, number: number, commitMessage?: string): Promise<void> {
  await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/pulls/${number}/merge`, {
    method: 'PUT',
    body: JSON.stringify({
      commit_title: commitMessage,
      merge_method: 'squash',
    }),
  });
}

function mapPR(data: Record<string, unknown>): GitHubPR {
  return {
    number: data.number as number,
    title: data.title as string,
    body: data.body as string | undefined,
    state: data.state as 'open' | 'closed',
    head: {
      ref: (data.head as Record<string, unknown>).ref as string,
      sha: (data.head as Record<string, unknown>).sha as string,
    },
    base: {
      ref: (data.base as Record<string, unknown>).ref as string,
      sha: (data.base as Record<string, unknown>).sha as string,
    },
    user: {
      login: (data.user as Record<string, unknown>).login as string,
    },
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
    mergedAt: data.merged_at as string | undefined,
    htmlUrl: data.html_url as string,
  };
}

// ============================================================================
// COMMIT HISTORY (for Hotspot Detection)
// ============================================================================

export async function getCommitHistory(
  ctx: GitHubContext,
  path?: string,
  perPage: number = 100
): Promise<Array<{
  sha: string;
  message: string;
  author: string;
  date: string;
  files: string[];
}>> {
  let url = `/repos/${ctx.owner}/${ctx.repo}/commits?per_page=${perPage}`;
  if (path) url += `&path=${encodeURIComponent(path)}`;

  const response = await githubFetch(ctx, url);
  const data = await response.json();

  return data.map((commit: Record<string, unknown>) => ({
    sha: commit.sha as string,
    message: (commit.commit as Record<string, unknown>).message as string,
    author: ((commit.commit as Record<string, unknown>).author as Record<string, unknown>).name as string,
    date: ((commit.commit as Record<string, unknown>).author as Record<string, unknown>).date as string,
    files: [], // Would need separate API call for files
  }));
}

export async function getCommitFiles(ctx: GitHubContext, sha: string): Promise<string[]> {
  const response = await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/commits/${sha}`);
  const data = await response.json();
  return (data.files as Array<Record<string, unknown>>).map(f => f.filename as string);
}

// ============================================================================
// WEBHOOK OPERATIONS
// ============================================================================

export async function createWebhook(
  ctx: GitHubContext,
  webhookUrl: string,
  secret: string,
  events: string[] = ['push', 'pull_request']
): Promise<void> {
  await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/hooks`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'web',
      active: true,
      events,
      config: {
        url: webhookUrl,
        content_type: 'json',
        secret,
      },
    }),
  });
}

export async function deleteWebhook(ctx: GitHubContext, hookId: number): Promise<void> {
  await githubFetch(ctx, `/repos/${ctx.owner}/${ctx.repo}/hooks/${hookId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// REPOSITORY SCANNING (for Intelligence Engine)
// ============================================================================

export async function scanRepository(ctx: GitHubContext): Promise<{
  files: GitHubFile[];
  languages: Record<string, number>;
  totalSize: number;
  fileCount: number;
}> {
  const files = await getAllFiles(ctx);
  const languages = await getRepositoryLanguages(ctx);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return {
    files,
    languages,
    totalSize,
    fileCount: files.length,
  };
}
