/**
 * Hades Army v0.2.1 — General Helpers
 * Pure ESM — no require() used.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === maxRetries) break;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }

  throw lastError;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

// FIX MEDIUM #2: Dangerous file detection
const DANGEROUS_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "wrangler.toml",
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "tsconfig.json",
  ".github/workflows",
  ".gitignore",
  "Dockerfile",
  "docker-compose.yml",
  ".npmrc",
  ".nvmrc",
];

export function isValidPatch(patch: string): boolean {
  const hasDiffHeader = /^diff --git/m.test(patch);
  const hasHunkHeader = /^@@ -\d+,?\d* \+\d+,?\d* @@/m.test(patch);
  return hasDiffHeader && hasHunkHeader;
}

// FIX MEDIUM #2: Check for dangerous files in patch
export function containsDangerousFiles(patch: string): { safe: boolean; dangerousFiles: string[] } {
  const files = extractAffectedFiles(patch);
  const dangerousFiles = files.filter(file =>
    DANGEROUS_FILES.some(dangerous =>
      file === dangerous || file.endsWith(`/${dangerous}`) || file.startsWith(dangerous)
    )
  );
  return {
    safe: dangerousFiles.length === 0,
    dangerousFiles,
  };
}

export function extractAffectedFiles(patch: string): string[] {
  const files: string[] = [];
  const regex = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  let match;
  while ((match = regex.exec(patch)) !== null) {
    files.push(match[1]);
  }
  return [...new Set(files)];
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
