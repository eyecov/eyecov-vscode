import { describe, it, expect } from "vitest";
import {
  applyChanges,
  applyOneChange,
  computeLineDelta,
  recordToTrackedState,
  trackedStateToCoverageData,
} from "./edit-tracking";
import type { CoverageRecord } from "./coverage-resolver";
import { LINE_STATUS } from "./coverage-types";

describe("computeLineDelta", () => {
  it("insert 3 lines: removedLines 0, addedLines 3, delta +3", () => {
    const change = {
      range: { start: { line: 5 }, end: { line: 5 } },
      text: "line1\nline2\nline3",
    };
    const result = computeLineDelta(change);
    expect(result.removedLines).toBe(0);
    expect(result.addedLines).toBe(3);
    expect(result.lineDelta).toBe(3);
  });

  it("delete 2 lines: removedLines 2, addedLines 0, delta -2", () => {
    const change = {
      range: { start: { line: 10 }, end: { line: 12 } },
      text: "",
    };
    const result = computeLineDelta(change);
    expect(result.removedLines).toBe(2);
    expect(result.addedLines).toBe(0);
    expect(result.lineDelta).toBe(-2);
  });

  it("replace 1 line with 1 line: delta 0", () => {
    const change = {
      range: { start: { line: 7 }, end: { line: 8 } },
      text: "new content",
    };
    const result = computeLineDelta(change);
    expect(result.removedLines).toBe(1);
    expect(result.addedLines).toBe(1);
    expect(result.lineDelta).toBe(0);
  });
});

describe("applyOneChange", () => {
  it("edit entirely before coverage line: line shifts by delta", () => {
    const change = {
      range: { start: { line: 5 }, end: { line: 5 } },
      text: "a\nb",
    };
    const result = applyOneChange([20], [], [], change);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([22]);
    expect(result!.uncoveredLines).toEqual([]);
    expect(result!.uncoverableLines).toEqual([]);
  });

  it("edit entirely after coverage line: lines unchanged", () => {
    const change = {
      range: { start: { line: 10 }, end: { line: 12 } },
      text: "",
    };
    const result = applyOneChange([5], [3], [1], change);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([5]);
    expect(result!.uncoveredLines).toEqual([3]);
    expect(result!.uncoverableLines).toEqual([1]);
  });

  it("edit overlaps a coverage line: returns null", () => {
    const change = {
      range: { start: { line: 8 }, end: { line: 12 } },
      text: "x",
    };
    const result = applyOneChange([10], [], [], change);
    expect(result).toBeNull();
  });

  // Regression: multi-line insert — we count LINES added (split length), not newline count.
  // Insert "a\nb\nc" = 3 lines; tracked line 20 must shift by +3 → 23 (not +2 → 22).
  it("insert 3 lines above tracked line: line shifts by 3 to 23", () => {
    const change = {
      range: { start: { line: 5 }, end: { line: 5 } },
      text: "a\nb\nc",
    };
    const result = applyOneChange([20], [], [], change);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([23]);
  });
});

describe("applyChanges", () => {
  it("processes changes in order; each step uses current line numbers", () => {
    const changes = [
      { range: { start: { line: 5 }, end: { line: 5 } }, text: "a\nb" },
      { range: { start: { line: 0 }, end: { line: 0 } }, text: "x" },
    ];
    const result = applyChanges([20], [], [], changes);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([23]);
  });

  it("returns null when any change overlaps a coverage line", () => {
    const changes = [
      { range: { start: { line: 0 }, end: { line: 0 } }, text: "\n" },
      { range: { start: { line: 8 }, end: { line: 12 } }, text: "y" },
    ];
    const result = applyChanges([10], [], [], changes);
    expect(result).toBeNull();
  });

  it("returns null when single change has range length > maxEditRange", () => {
    const change = {
      range: { start: { line: 0 }, end: { line: 6 } },
      text: "",
    };
    const result = applyChanges([10], [], [], [change], {
      maxEditRange: 5,
    });
    expect(result).toBeNull();
  });

  it("returns null when editCountBefore >= maxEdits", () => {
    const change = {
      range: { start: { line: 0 }, end: { line: 0 } },
      text: "x",
    };
    const result = applyChanges([5], [], [], [change], {
      maxEdits: 2,
      editCountBefore: 2,
    });
    expect(result).toBeNull();
  });
});

describe("recordToTrackedState", () => {
  it("converts record to state with arrays, sourcePath, version, isValid true", () => {
    const record: CoverageRecord = {
      sourcePath: "/app/Foo.php",
      coveredLines: new Set([1, 5]),
      uncoveredLines: new Set([2]),
      uncoverableLines: new Set([3]),
      lineCoveragePercent: 66.67,
    };
    const state = recordToTrackedState(record, 3);
    expect(state.sourcePath).toBe("/app/Foo.php");
    expect(state.coveredLines).toEqual([1, 5]);
    expect(state.uncoveredLines).toEqual([2]);
    expect(state.uncoverableLines).toEqual([3]);
    expect(state.baseDocumentVersion).toBe(3);
    expect(state.isValid).toBe(true);
  });
});

describe("trackedStateToCoverageData", () => {
  it("returns CoverageData with Sets from state arrays when state.isValid", () => {
    const state = recordToTrackedState(
      {
        sourcePath: "/app/Bar.php",
        coveredLines: new Set([1, 3]),
        uncoveredLines: new Set([2]),
        uncoverableLines: new Set(),
        lineCoveragePercent: 66.67,
      },
      1,
    );
    const coverage = trackedStateToCoverageData(state);
    expect(coverage.file.sourceFile).toBe("/app/Bar.php");
    expect(coverage.file.lineCoveragePercent).toBe(66.67);
    expect(coverage.coveredLines).toEqual(new Set([1, 3]));
    expect(coverage.uncoveredLines).toEqual(new Set([2]));
    expect(coverage.uncoverableLines).toEqual(new Set());
    expect(coverage.lineStatuses.get(1)).toBe(LINE_STATUS.COVERED_SMALL);
    expect(coverage.lineStatuses.get(2)).toBe(LINE_STATUS.UNCOVERED);
    expect(coverage.lineStatuses.get(3)).toBe(LINE_STATUS.COVERED_SMALL);
  });

  it("returns minimal CoverageData (empty line sets) when state.isValid is false", () => {
    const state = recordToTrackedState(
      {
        sourcePath: "/app/Baz.php",
        coveredLines: new Set([1]),
        uncoveredLines: new Set(),
        uncoverableLines: new Set(),
        lineCoveragePercent: 100,
      },
      1,
    );
    state.isValid = false;
    const coverage = trackedStateToCoverageData(state);
    expect(coverage.coveredLines.size).toBe(0);
    expect(coverage.uncoveredLines.size).toBe(0);
    expect(coverage.uncoverableLines.size).toBe(0);
    expect(coverage.file.sourceFile).toBe("/app/Baz.php");
  });
});
