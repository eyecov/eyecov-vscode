/**
 * Edit-tolerant coverage tracking: line delta and mapping.
 * Pure logic only; no VS Code dependency.
 */

import type { CoverageRecord } from "./coverage-resolver";
import type { CoverageData } from "./coverage-types";
import { LINE_STATUS } from "./coverage-types";

/**
 * Single change from TextDocumentChangeEvent.contentChanges[].
 * range.end.line is VS Code's raw end line: the last line touched by the
 * replacement. removedLines = end.line - start.line counts newline boundaries
 * removed, matching addedLines = newlines in text.
 */
export interface ContentChange {
  range: {
    start: { line: number; character?: number };
    end: { line: number; character?: number };
  };
  text: string;
  /**
   * When true, the edit inserted a newline after the end of the start line
   * without changing that line's content, so the start line should not be
   * invalidated.
   */
  preserveStartLine?: boolean;
  /**
   * When true, the edit inserted one or more whole lines before the start line
   * without changing that line's content, so the start line should shift by
   * lineDelta instead of being invalidated.
   */
  shiftStartLine?: boolean;
}

/**
 * Coverage line numbers are 1-based. VS Code document change events are 0-based,
 * so normalize them before applying edit tracking.
 */
export function normalizeContentChangeFromZeroBased(
  change: ContentChange,
): ContentChange {
  return {
    range: {
      start: {
        line: change.range.start.line + 1,
        character: change.range.start.character,
      },
      end: {
        line: change.range.end.line + 1,
        character: change.range.end.character,
      },
    },
    text: change.text,
    preserveStartLine: change.preserveStartLine,
    shiftStartLine: change.shiftStartLine,
  };
}

export interface LineDelta {
  removedLines: number;
  addedLines: number;
  lineDelta: number;
}

/**
 * Line delta for one change.
 * removedLines = range.end.line - range.start.line
 * addedLines = number of lines in text (empty text → 0)
 * lineDelta = addedLines - removedLines
 */
export function computeLineDelta(change: ContentChange): LineDelta {
  const removedLines = change.range.end.line - change.range.start.line;
  const addedLines = change.text.split("\n").length - 1;
  const lineDelta = addedLines - removedLines;
  return { removedLines, addedLines, lineDelta };
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
  const { lineDelta } = computeLineDelta(change);

  // Only exclude editStart from invalidation for the exact join-lines shape: backspace at
  // col 0 of the next line removes the trailing newline of editStart without touching its
  // content. Any other multi-line edit starting mid-line still modifies editStart's content.
  const isJoinLines =
    (change.range.start.character ?? 0) > 0 &&
    editEnd === editStart + 1 &&
    (change.range.end.character ?? 0) === 0 &&
    change.text === "";
  const shiftsStartLine =
    change.shiftStartLine &&
    editStart === editEnd &&
    (change.range.start.character ?? 0) === 0;
  const lowerBound =
    isJoinLines || change.preserveStartLine ? editStart + 1 : editStart;
  const inRange = (L: number) => L >= lowerBound && L <= editEnd;

  // Drop lines that fall inside the edit range (their content was replaced/removed).
  // Shift lines that fall after the edit range by lineDelta.
  const mapLines = (lines: number[]): number[] => {
    return lines.flatMap((L) => {
      if (shiftsStartLine && L >= editStart) return [L + lineDelta];
      if (inRange(L)) return [];
      if (L > editEnd) return [L + lineDelta];
      return [L];
    });
  };

  return {
    coveredLines: mapLines(coveredLines),
    uncoveredLines: mapLines(uncoveredLines),
    uncoverableLines: mapLines(uncoverableLines),
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

// Both thresholds intentionally equal — tune together if adjusting.
export const MAX_EDIT_RANGE = 200;
export const MAX_EDITS = 200;

/** Result of applying content changes to a tracked coverage state. */
export type ApplyContentChangesResult =
  | {
      kind: "updated";
      state: TrackedCoverageState;
      coverage: CoverageData;
      newEditCount: number;
    }
  | { kind: "invalidated" };

/**
 * Apply VS Code content changes to a tracked coverage state.
 * Returns updated state + coverage data, or `{ kind: "invalidated" }` when
 * any change overlaps a tracked line or exceeds the edit thresholds.
 * Pure function — no VS Code dependency.
 */
export function applyContentChangesToTrackedState(
  existingState: TrackedCoverageState,
  contentChanges: ContentChange[],
  editCountBefore: number,
): ApplyContentChangesResult {
  const mapped = applyChanges(
    existingState.coveredLines,
    existingState.uncoveredLines,
    existingState.uncoverableLines,
    contentChanges,
    { maxEditRange: MAX_EDIT_RANGE, maxEdits: MAX_EDITS, editCountBefore },
  );
  if (!mapped) {
    return { kind: "invalidated" };
  }
  const updatedState: TrackedCoverageState = {
    ...existingState,
    coveredLines: mapped.coveredLines,
    uncoveredLines: mapped.uncoveredLines,
    uncoverableLines: mapped.uncoverableLines,
  };
  return {
    kind: "updated",
    state: updatedState,
    coverage: trackedStateToCoverageData(updatedState),
    // contentChanges.length is the number of VS Code change items in this event
    // (>1 for multi-cursor edits), so this counts items, not keystrokes.
    newEditCount: editCountBefore + contentChanges.length,
  };
}

/** Tracked coverage line arrays + metadata for edit mapping. */
export interface TrackedCoverageState {
  sourcePath: string;
  coveredLines: number[];
  uncoveredLines: number[];
  uncoverableLines: number[];
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
    baseDocumentVersion: documentVersion,
    lineCoveragePercent: record.lineCoveragePercent ?? null,
  };
}

/**
 * Convert tracked state to CoverageData for applyDecorations.
 */
export function trackedStateToCoverageData(
  state: TrackedCoverageState,
): CoverageData {
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
