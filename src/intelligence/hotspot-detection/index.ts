/**
 * Hades Army v0.6 - Repository Intelligence Engine
 * Hotspot Detection
 */

import type { Hotspot, RepositoryFile } from '../../core/types';

interface CommitInfo {
  sha: string;
  date: string;
  author: string;
  files: string[];
}

export function detectHotspots(
  files: RepositoryFile[],
  commitHistory: CommitInfo[]
): Hotspot[] {
  const fileChangeCounts = new Map<string, number>();
  const fileLastChanged = new Map<string, string>();
  const fileContributors = new Map<string, Set<string>>();

  // Count changes per file
  for (const commit of commitHistory) {
    for (const filePath of commit.files) {
      fileChangeCounts.set(filePath, (fileChangeCounts.get(filePath) || 0) + 1);
      fileLastChanged.set(filePath, commit.date);

      if (!fileContributors.has(filePath)) {
        fileContributors.set(filePath, new Set());
      }
      fileContributors.get(filePath)!.add(commit.author);
    }
  }

  const hotspots: Hotspot[] = [];

  for (const file of files) {
    const changeCount = fileChangeCounts.get(file.path) || 0;

    // Only consider files with significant change history
    if (changeCount < 3) continue;

    const complexity = file.complexity || 1;
    const contributors = fileContributors.get(file.path) || new Set();

    // Risk score: combination of change frequency, complexity, and contributor count
    // More changes + higher complexity + more contributors = higher risk
    const changeFrequency = Math.min(changeCount / 10, 1); // Normalize to 0-1
    const complexityNorm = Math.min(complexity / 50, 1);
    const contributorFactor = Math.min(contributors.size / 5, 1);

    const riskScore = (
      changeFrequency * 0.4 +
      complexityNorm * 0.4 +
      contributorFactor * 0.2
    ) * 100;

    if (riskScore > 30) { // Threshold for hotspot
      hotspots.push({
        filePath: file.path,
        changeFrequency: changeCount,
        complexity,
        riskScore: Math.round(riskScore),
        lastChanged: fileLastChanged.get(file.path) || file.lastModified || '',
        contributors: Array.from(contributors),
      });
    }
  }

  // Sort by risk score descending
  return hotspots.sort((a, b) => b.riskScore - a.riskScore);
}

export function calculateComplexity(content: string, language?: string): number {
  let complexity = 1;
  const lines = content.split('
');

  // Cyclomatic complexity approximation
  const controlFlowPatterns = [
    /if/g,
    /else\s+if/g,
    /for/g,
    /while/g,
    /do/g,
    /switch/g,
    /case/g,
    /catch/g,
    /\?/g, // ternary
    /\|\|/g, // logical OR
    /\&\&/g, // logical AND
  ];

  for (const pattern of controlFlowPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  // Nesting depth penalty
  let maxDepth = 0;
  let currentDepth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.endsWith('{') || trimmed.endsWith(':') || trimmed.startsWith('def ') || trimmed.startsWith('class ')) {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    }
    if (trimmed === '}' || (trimmed.startsWith('return') && currentDepth > 0)) {
      currentDepth = Math.max(0, currentDepth - 1);
    }
  }

  complexity += maxDepth * 2;

  // Function length penalty
  const functionLengths = estimateFunctionLengths(content, language);
  for (const length of functionLengths) {
    if (length > 50) complexity += Math.floor((length - 50) / 10);
  }

  return Math.min(complexity, 100);
}

function estimateFunctionLengths(content: string, language?: string): number[] {
  const lengths: number[] = [];
  const lines = content.split('
');
  let inFunction = false;
  let functionStart = 0;
  let braceCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inFunction) {
      if (/^(\s*)(function|def|func|fn|async\s+function)\s+/.test(line) ||
          /^(\s*)(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/.test(line)) {
        inFunction = true;
        functionStart = i;
        braceCount = 0;
      }
    } else {
      braceCount += (line.match(/\{/g) || []).length;
      braceCount -= (line.match(/\}/g) || []).length;

      if (braceCount <= 0 && line.trim() === '}' && language !== 'python') {
        lengths.push(i - functionStart);
        inFunction = false;
      } else if (language === 'python' && line.trim() !== '' && !line.startsWith(' ') && !line.startsWith('	')) {
        lengths.push(i - functionStart);
        inFunction = false;
      }
    }
  }

  return lengths;
}

export function getHotspotRecommendations(hotspots: Hotspot[]): string[] {
  const recommendations: string[] = [];

  for (const hotspot of hotspots.slice(0, 5)) {
    if (hotspot.riskScore > 80) {
      recommendations.push(
        `CRITICAL: ${hotspot.filePath} has risk score ${hotspot.riskScore}. ` +
        `Consider refactoring: ${hotspot.changeFrequency} changes by ${hotspot.contributors.length} contributors.`
      );
    } else if (hotspot.riskScore > 60) {
      recommendations.push(
        `HIGH: ${hotspot.filePath} has risk score ${hotspot.riskScore}. ` +
        `Review for potential simplification.`
      );
    } else {
      recommendations.push(
        `MEDIUM: ${hotspot.filePath} has risk score ${hotspot.riskScore}. ` +
        `Monitor for increasing change frequency.`
      );
    }
  }

  return recommendations;
}
