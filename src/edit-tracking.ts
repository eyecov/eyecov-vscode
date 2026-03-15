/**
 * Edit-tolerant coverage tracking: line delta and mapping.
 * Pure logic only; no VS Code dependency.
 */

import type { CoverageRecord } from "./coverage-resolver";
import type { CoverageData } from "./coverage-types";
import { LINE_STATUS } from "./coverage-types";

/** Single change from TextDocumentChangeEvent.contentChanges[]. */
export interface ContentChange {
  range: { start: { line: number }; end: { line: number } };
  text: string;
}

export interface LineDelta {
  removedLines: number;
  addedLines: number;
  delta: number;
}

/**
 * Line delta for one change.
 * removedLines = range.end.line - range.start.line
 * addedLines = number of lines in text (empty text → 0)
 * delta = addedLines - removedLines
 */
export function computeLineDelta(change: ContentChange): LineDelta {
  const removedLines = change.range.end.line - change.range.start.line;
  const addedLines = change.text === "" ? 0 : change.text.split("\n").length;
  const delta = addedLines - removedLines;
  return { removedLines, addedLines, delta };
}

/** Result of applying one change: updated line arrays, or null if overlap. */
export interface ApplyOneChangeResult {
  coveredLines: number[];
  uncoveredLines: number[];
  uncoverableLines: number[];
}

/**
 * Map one change over coverage line arrays. Returns updated arrays or null if
 * any coverage line falls inside the edit range (editStart <= L <= editEnd).
 */
export function applyOneChange(
  coveredLines: number[],
  uncoveredLines: number[],
  uncoverableLines: number[],
  change: ContentChange,
): ApplyOneChangeResult | null {
  const editStart = change.range.start.line;
  const editEnd = change.range.end.line;
  const { delta } = computeLineDelta(change);

  const mapLines = (lines: number[]): number[] | null => {
    const out: number[] = [];
    for (const L of lines) {
      if (L >= editStart && L <= editEnd) return null;
      out.push(L > editEnd ? L + delta : L);
    }
    return out;
  };

  const newCovered = mapLines(coveredLines);
  if (newCovered === null) return null;
  const newUncovered = mapLines(uncoveredLines);
  if (newUncovered === null) return null;
  const newUncoverable = mapLines(uncoverableLines);
  if (newUncoverable === null) return null;

  return {
    coveredLines: newCovered,
    uncoveredLines: newUncovered,
    uncoverableLines: newUncoverable,
  };
}

/** Optional invalidation thresholds (caller may pass to avoid magic numbers). */
export interface ApplyChangesOptions {
  /** Max edit range (lines). If (editEnd - editStart) > this, invalid. Default 200. */
  maxEditRange?: number;
  /** Max edits since load. If editCountBefore >= this, invalid. Default 200. */
  maxEdits?: number;
  /** Number of edits already applied for this file (since coverage load). */
  editCountBefore?: number;
}

/**
 * Apply multiple content changes in order. Each change uses the current line
 * arrays from the previous step. Returns null on first overlapping change,
 * or when a change exceeds maxEditRange, or when editCountBefore >= maxEdits.
 */
export function applyChanges(
  coveredLines: number[],
  uncoveredLines: number[],
  uncoverableLines: number[],
  contentChanges: ContentChange[],
  options?: ApplyChangesOptions,
): ApplyOneChangeResult | null {
  const maxEditRange = options?.maxEditRange;
  const maxEdits = options?.maxEdits;
  const editCountBefore = options?.editCountBefore ?? 0;

  if (maxEdits != null && editCountBefore >= maxEdits) {
    return null;
  }

  let state: ApplyOneChangeResult = {
    coveredLines,
    uncoveredLines,
    uncoverableLines,
  };
  for (const change of contentChanges) {
    if (maxEditRange != null) {
      const rangeLines = change.range.end.line - change.range.start.line;
      if (rangeLines > maxEditRange) return null;
    }
    const next = applyOneChange(
      state.coveredLines,
      state.uncoveredLines,
      state.uncoverableLines,
      change,
    );
    if (next === null) return null;
    state = next;
  }
  return state;
}

/** Tracked coverage line arrays + metadata for edit mapping. */
export interface TrackedCoverageState {
  sourcePath: string;
  coveredLines: number[];
  uncoveredLines: number[];
  uncoverableLines: number[];
  isValid: boolean;
  baseDocumentVersion: number;
  lineCoveragePercent: number | null;
}

/**
 * Build tracked state from a coverage record and current document version.
 */
export function recordToTrackedState(
  record: CoverageRecord,
  documentVersion: number,
): TrackedCoverageState {
  const toSortedArray = (s: Set<number>) => [...s].sort((a, b) => a - b);
  return {
    sourcePath: record.sourcePath,
    coveredLines: toSortedArray(record.coveredLines),
    uncoveredLines: toSortedArray(record.uncoveredLines),
    uncoverableLines: toSortedArray(record.uncoverableLines),
    isValid: true,
    baseDocumentVersion: documentVersion,
    lineCoveragePercent: record.lineCoveragePercent ?? null,
  };
}

/**
 * Convert tracked state to CoverageData for applyDecorations. When state.isValid
 * is false, returns minimal CoverageData (empty line sets) so the extension can
 * still call getDecorationPlan / applyDecorations without branching.
 */
export function trackedStateToCoverageData(
  state: TrackedCoverageState,
): CoverageData {
  if (!state.isValid) {
    return {
      file: {
        fileId: 0,
        sourceFile: state.sourcePath,
        lineCoveragePercent: state.lineCoveragePercent,
        totalLines: 0,
        coveredLines: 0,
      },
      coveredLines: new Set(),
      uncoveredLines: new Set(),
      uncoverableLines: new Set(),
      lineStatuses: new Map(),
    };
  }
  const coveredLines = new Set(state.coveredLines);
  const uncoveredLines = new Set(state.uncoveredLines);
  const uncoverableLines = new Set(state.uncoverableLines);
  const totalLines = coveredLines.size + uncoveredLines.size;
  const lineStatuses = new Map<number, number>();
  for (const line of state.coveredLines) {
    lineStatuses.set(line, LINE_STATUS.COVERED_SMALL);
  }
  for (const line of state.uncoveredLines) {
    lineStatuses.set(line, LINE_STATUS.UNCOVERED);
  }
  for (const line of state.uncoverableLines) {
    lineStatuses.set(line, LINE_STATUS.UNCOVERABLE);
  }
  return {
    file: {
      fileId: 0,
      sourceFile: state.sourcePath,
      lineCoveragePercent: state.lineCoveragePercent,
      totalLines,
      coveredLines: coveredLines.size,
    },
    coveredLines,
    uncoveredLines,
    uncoverableLines,
    lineStatuses,
  };
}
