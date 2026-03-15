/**
 * Test priority scoring: rank files by "where to add tests first" using
 * coverage data only (missing paths, low %, high uncovered count). Heuristic and explainable.
 */

import type { CoverageCacheFileEntry } from './coverage-cache';

const PRIORITY_NO_COVERAGE = 100;
const THRESHOLD_LOW_COVERAGE_PERCENT = 50;
const THRESHOLD_MANY_UNCOVERED_LINES = 10;

export interface TestPriorityItem {
  filePath: string;
  priorityScore: number;
  lineCoveragePercent: number | null;
  uncoveredLines: number;
  reasons: string[];
}

export interface ComputeTestPriorityOptions {
  filesWithCoverage: CoverageCacheFileEntry[];
  missingPaths: string[];
  limit?: number;
  fromCache?: boolean;
  includeNoCoverage?: boolean;
}

/**
 * Compute ranked items for "where to add tests first". Missing paths get top score;
 * files with coverage are scored by low % and high uncovered count, then merged and limited.
 */
export function computeTestPriorityItems(
  options: ComputeTestPriorityOptions
): TestPriorityItem[] {
  const {
    filesWithCoverage,
    missingPaths,
    limit = 20,
    fromCache = false,
    includeNoCoverage = true,
  } = options;

  const missingItems: TestPriorityItem[] = includeNoCoverage
    ? missingPaths.map((filePath) => ({
        filePath,
        priorityScore: PRIORITY_NO_COVERAGE,
        lineCoveragePercent: null,
        uncoveredLines: 0,
        reasons: ['no coverage', ...(fromCache ? ['fresh coverage available'] : [])],
      }))
    : [];

  const withCoverageItems: TestPriorityItem[] = filesWithCoverage.map((f) => {
    const reasons: string[] = [];
    if (f.lineCoveragePercent != null && f.lineCoveragePercent < THRESHOLD_LOW_COVERAGE_PERCENT) {
      reasons.push('low coverage');
    }
    if (f.uncoveredLines >= THRESHOLD_MANY_UNCOVERED_LINES) {
      reasons.push('many uncovered lines');
    }
    if (fromCache) {
      reasons.push('fresh coverage available');
    }
    const score =
      (f.lineCoveragePercent != null ? 100 - f.lineCoveragePercent : 50) +
      Math.min(f.uncoveredLines, 50);
    return {
      filePath: f.filePath,
      priorityScore: Math.min(99, Math.round(score)),
      lineCoveragePercent: f.lineCoveragePercent,
      uncoveredLines: f.uncoveredLines,
      reasons: reasons.length > 0 ? reasons : ['has coverage'],
    };
  });

  const merged = [...missingItems, ...withCoverageItems].sort(
    (a, b) => b.priorityScore - a.priorityScore
  );
  return merged.slice(0, limit);
}
