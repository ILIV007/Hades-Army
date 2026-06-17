/**
 * Hades Army v0.2 — Unified Diff Parser
 * Parses unified diff patches into structured data for GitHub application.
 * Pure ESM.
 */

import type { ParsedPatch, PatchHunk } from "../types";

/**
 * Parse a unified diff string into structured patch objects.
 */
export function parsePatch(patchText: string): ParsedPatch[] {
  const patches: ParsedPatch[] = [];
  const lines = patchText.split("\n");

  let currentPatch: ParsedPatch | null = null;
  let currentHunk: PatchHunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file diff
    if (line.startsWith("diff --git")) {
      // Save previous hunk/patch
      if (currentHunk && currentPatch) {
        currentPatch.hunks.push(currentHunk);
        currentHunk = null;
      }
      if (currentPatch) {
        patches.push(currentPatch);
      }

      const match = line.match(/diff --git a\/(.+?) b\/(.+?)$/);
      if (match) {
        currentPatch = {
          oldPath: match[1],
          newPath: match[2],
          hunks: [],
          isNewFile: false,
          isDeleted: false,
        };
      }
      continue;
    }

    if (!currentPatch) continue;

    // Detect new/deleted files
    if (line.startsWith("new file mode")) {
      currentPatch.isNewFile = true;
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      currentPatch.isDeleted = true;
      continue;
    }

    // Hunk header
    const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
    if (hunkMatch) {
      if (currentHunk) {
        currentPatch.hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newLines: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        lines: [],
      };
      continue;
    }

    // Hunk content lines
    if (currentHunk) {
      currentHunk.lines.push(line);
    }
  }

  // Finalize last hunk/patch
  if (currentHunk && currentPatch) {
    currentPatch.hunks.push(currentHunk);
  }
  if (currentPatch) {
    patches.push(currentPatch);
  }

  return patches;
}

/**
 * Apply a parsed patch to original file content.
 * Returns the new file content.
 */
export function applyPatchToContent(original: string, patch: ParsedPatch): string {
  if (patch.isNewFile) {
    // For new files, collect all added lines
    const lines: string[] = [];
    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          lines.push(line.slice(1));
        }
      }
    }
    return lines.join("\n");
  }

  if (patch.isDeleted) {
    return "";
  }

  // For modified files, apply hunks
  const originalLines = original.split("\n");
  const result = [...originalLines];
  let offset = 0;

  for (const hunk of patch.hunks) {
    const startLine = hunk.oldStart - 1 + offset;
    let originalIndex = startLine;
    let resultIndex = startLine;

    for (const line of hunk.lines) {
      if (line.startsWith(" ")) {
        // Context line — keep
        resultIndex++;
        originalIndex++;
      } else if (line.startsWith("-")) {
        // Removed line — delete from result
        result.splice(resultIndex, 1);
        originalIndex++;
        offset--;
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        // Added line — insert
        result.splice(resultIndex, 0, line.slice(1));
        resultIndex++;
        offset++;
      }
    }
  }

  return result.join("\n");
}

/**
 * Extract all affected file paths from a raw patch string.
 */
export function extractPatchFiles(patchText: string): string[] {
  const patches = parsePatch(patchText);
  return patches.map((p) => p.newPath);
}
