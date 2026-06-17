/**
 * Hades Army v0.2 — Unified Diff Parser
 * Parses unified diff patches into structured data for GitHub application.
 * Pure ESM.
 */

import type { ParsedPatch, PatchHunk } from "../types";

export function parsePatch(patchText: string): ParsedPatch[] {
  const patches: ParsedPatch[] = [];
  const lines = patchText.split("\n");

  let currentPatch: ParsedPatch | null = null;
  let currentHunk: PatchHunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("diff --git")) {
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

    if (line.startsWith("new file mode")) {
      currentPatch.isNewFile = true;
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      currentPatch.isDeleted = true;
      continue;
    }

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

    if (currentHunk) {
      currentHunk.lines.push(line);
    }
  }

  if (currentHunk && currentPatch) {
    currentPatch.hunks.push(currentHunk);
  }
  if (currentPatch) {
    patches.push(currentPatch);
  }

  return patches;
}

export function applyPatchToContent(original: string, patch: ParsedPatch): string {
  if (patch.isNewFile) {
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

  const originalLines = original.split("\n");
  const result = [...originalLines];
  let offset = 0;

  for (const hunk of patch.hunks) {
    const startLine = hunk.oldStart - 1 + offset;
    let originalIndex = startLine;
    let resultIndex = startLine;

    for (const line of hunk.lines) {
      if (line.startsWith(" ")) {
        resultIndex++;
        originalIndex++;
      } else if (line.startsWith("-")) {
        result.splice(resultIndex, 1);
        originalIndex++;
        offset--;
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        result.splice(resultIndex, 0, line.slice(1));
        resultIndex++;
        offset++;
      }
    }
  }

  return result.join("\n");
}

export function extractPatchFiles(patchText: string): string[] {
  const patches = parsePatch(patchText);
  return patches.map((p) => p.newPath);
}
