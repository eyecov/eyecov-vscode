/**
 * Parser for fixture coverage JSON (test-only format).
 * Accepts single-entry or multi-file (files array) shape.
 */

import type { FixtureCoverageEntry, FixtureFile } from './types';

function computeLineCoveragePercent(covered: number, uncovered: number): number | null {
  const total = covered + uncovered;
  if (total === 0) return null;
  return Number((((covered / total) * 100)).toFixed(2));
}

function normalizeEntry(raw: Partial<FixtureCoverageEntry>): FixtureCoverageEntry | null {
  if (
    typeof raw.sourcePath !== 'string' ||
    !Array.isArray(raw.coveredLines) ||
    !Array.isArray(raw.uncoveredLines)
  ) {
    return null;
  }
  const covered = raw.coveredLines.length;
  const uncovered = raw.uncoveredLines.length;
  const lineCoveragePercent =
    raw.lineCoveragePercent !== undefined
      ? raw.lineCoveragePercent
      : computeLineCoveragePercent(covered, uncovered);
  return {
    sourcePath: raw.sourcePath,
    coveredLines: raw.coveredLines,
    uncoveredLines: raw.uncoveredLines,
    uncoverableLines: raw.uncoverableLines ?? [],
    lineCoveragePercent,
    tests: raw.tests,
    testsByLine: raw.testsByLine,
  };
}

/**
 * Parse fixture coverage JSON. Returns array of normalized entries.
 * Single-entry: root is one record. Multi-file: root has "files": [ ... ].
 * Throws on invalid JSON.
 */
export function parseFixtureCoverage(json: string): FixtureCoverageEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Invalid fixture JSON');
  }
  if (data === null || typeof data !== 'object') {
    return [];
  }
  const root = data as FixtureFile;
  if (Array.isArray(root.files)) {
    const entries: FixtureCoverageEntry[] = [];
    for (const entry of root.files) {
      const normalized = normalizeEntry(entry);
      if (normalized) entries.push(normalized);
    }
    return entries;
  }
  const single = normalizeEntry(root);
  return single ? [single] : [];
}
