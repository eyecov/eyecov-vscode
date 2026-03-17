import { describe, it, expect } from "vitest";
import {
  applyChanges,
  applyOneChange,
  applyContentChangesToTrackedState,
  computeLineDelta,
  MAX_EDITS,
  recordToTrackedState,
  trackedStateToCoverageData,
} from "./edit-tracking";
import type { CoverageRecord } from "./coverage-resolver";
import { LINE_STATUS } from "./coverage-types";

/** Build a TrackedCoverageState from bare line number arrays. */
function makeState(
  covered: number[],
  uncovered: number[] = [],
  uncoverable: number[] = [],
) {
  return recordToTrackedState(
    {
      sourcePath: "/app/Foo.php",
      coveredLines: new Set(covered),
      uncoveredLines: new Set(uncovered),
      uncoverableLines: new Set(uncoverable),
      lineCoveragePercent: null,
    },
    1,
  );
}

describe("computeLineDelta", () => {
  it("insert 2 newlines: removedLines 0, addedLines 2, delta +2", () => {
    const change = {
      range: { start: { line: 5 }, end: { line: 5 } },
      text: "line1\nline2\nline3",
    };
    const result = computeLineDelta(change);
    expect(result.removedLines).toBe(0);
    expect(result.addedLines).toBe(2);
    expect(result.lineDelta).toBe(2);
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
      text: "new content\n",
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
    expect(result!.coveredLines).toEqual([21]);
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

  // Insert "a\nb\nc" has 2 newlines → adds 2 line boundaries → tracked line 20 shifts by +2 → 22.
  it("insert text with 2 newlines above tracked line: line shifts by 2 to 22", () => {
    const change = {
      range: { start: { line: 5 }, end: { line: 5 } },
      text: "a\nb\nc",
    };
    const result = applyOneChange([20], [], [], change);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([22]);
  });

  // Multi-line edit ending mid-line: replace lines 5–7 (2 newlines removed) with "x" (0 newlines added).
  // lineDelta = 0 - 2 = -2. Lines > end.line (7) shift down by 2. Line 8 → 6.
  it("multi-line replacement ending mid-line: line above end shifts down by net delta", () => {
    const change = {
      range: { start: { line: 5 }, end: { line: 7 } },
      text: "x",
    };
    const result = applyOneChange([8], [], [], change);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([6]);
  });
});

describe("applyChanges", () => {
  it("processes changes in order; each step uses current line numbers", () => {
    const changes = [
      { range: { start: { line: 5 }, end: { line: 5 } }, text: "a\nb" }, // +1 → 20→21
      { range: { start: { line: 0 }, end: { line: 0 } }, text: "x\ny" }, // +1 → 21→22
    ];
    const result = applyChanges([20], [], [], changes);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([22]);
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
  });
});

describe("trackedStateToCoverageData", () => {
  it("returns CoverageData with Sets from state arrays", () => {
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

  it("sourcePath is preserved in CoverageData.file.sourceFile", () => {
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
    const coverage = trackedStateToCoverageData(state);
    expect(coverage.file.sourceFile).toBe("/app/Baz.php");
  });
});

describe("applyContentChangesToTrackedState", () => {
  it("coverage data in result reflects shifted line sets", () => {
    const state = makeState([10], [20]);
    const result = applyContentChangesToTrackedState(
      state,
      [{ range: { start: { line: 5 }, end: { line: 5 } }, text: "\n" }],
      0,
    );
    expect(result.kind).toBe("updated");
    if (result.kind === "updated") {
      expect(result.coverage.coveredLines).toEqual(new Set([11]));
      expect(result.coverage.uncoveredLines).toEqual(new Set([21]));
    }
  });

  it("editCountBefore at limit (MAX_EDITS): invalidated", () => {
    const state = makeState([10]);
    const result = applyContentChangesToTrackedState(
      state,
      [{ range: { start: { line: 0 }, end: { line: 0 } }, text: "x" }],
      MAX_EDITS,
    );
    expect(result.kind).toBe("invalidated");
  });

  it("same-line edit (no newline) not on tracked line: lines unchanged, edit count increments", () => {
    const state = makeState([10], [15]);
    const result = applyContentChangesToTrackedState(
      state,
      [{ range: { start: { line: 5 }, end: { line: 5 } }, text: "hello" }],
      3,
    );
    expect(result.kind).toBe("updated");
    if (result.kind === "updated") {
      expect(result.state.coveredLines).toEqual([10]);
      expect(result.state.uncoveredLines).toEqual([15]);
      expect(result.newEditCount).toBe(4);
    }
  });

  it("edit on a covered line: invalidated", () => {
    const state = makeState([10]);
    const result = applyContentChangesToTrackedState(
      state,
      [{ range: { start: { line: 10 }, end: { line: 10 } }, text: "x" }],
      0,
    );
    expect(result.kind).toBe("invalidated");
  });

  it("newline inserted above tracked line: covered line shifts down by 1", () => {
    const state = makeState([10]);
    const result = applyContentChangesToTrackedState(
      state,
      [{ range: { start: { line: 5 }, end: { line: 5 } }, text: "\n" }],
      0,
    );
    expect(result.kind).toBe("updated");
    if (result.kind === "updated") {
      expect(result.state.coveredLines).toEqual([11]);
    }
  });
});
