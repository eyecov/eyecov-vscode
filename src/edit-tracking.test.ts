import { describe, it, expect } from "vitest";
import {
  applyChanges,
  applyOneChange,
  applyContentChangesToTrackedState,
  computeLineDelta,
  MAX_EDITS,
  normalizeContentChangeFromZeroBased,
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

describe("normalizeContentChangeFromZeroBased", () => {
  it("converts VS Code 0-based lines to 1-based coverage lines", () => {
    const change = normalizeContentChangeFromZeroBased({
      range: {
        start: { line: 5, character: 10 },
        end: { line: 7, character: 0 },
      },
      text: "",
    });
    expect(change).toEqual({
      range: {
        start: { line: 6, character: 10 },
        end: { line: 8, character: 0 },
      },
      text: "",
    });
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

  it("edit overlaps a coverage line: drops that line, shifts lines below", () => {
    // Lines 8–12 replaced with "x" → lineDelta = 0 - 4 = -4.
    // Line 10 is inside the edit range → dropped.
    // Line 15 > editEnd (12) → shifts by -4 → 11.
    const change = {
      range: { start: { line: 8 }, end: { line: 12 } },
      text: "x",
    };
    const result = applyOneChange([10, 15], [], [], change);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([11]); // 10 dropped, 15 → 15+(-4) = 11
  });

  it("same-line edit on covered line: drops that line only", () => {
    const change = {
      range: { start: { line: 10 }, end: { line: 10 } },
      text: "x",
    };
    const result = applyOneChange([10, 20], [], [], change);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([20]); // 10 dropped, 20 unaffected
  });

  it("enter at end of covered line preserves that line and shifts lines below", () => {
    const change = {
      range: {
        start: { line: 10, character: 20 },
        end: { line: 10, character: 20 },
      },
      text: "\n",
      preserveStartLine: true,
    };
    const result = applyOneChange([10, 20], [25], [], change);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([10, 21]);
    expect(result!.uncoveredLines).toEqual([26]);
  });

  it("enter at column 0 of a covered line shifts that line down instead of invalidating it", () => {
    const change = {
      range: {
        start: { line: 10, character: 0 },
        end: { line: 10, character: 0 },
      },
      text: "\n",
      shiftStartLine: true,
    };
    const result = applyOneChange([10, 20], [25], [], change);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([11, 21]);
    expect(result!.uncoveredLines).toEqual([26]);
  });

  it("inserting a full line at column 0 shifts the covered line down", () => {
    const change = {
      range: {
        start: { line: 10, character: 0 },
        end: { line: 10, character: 0 },
      },
      text: "// inserted\n",
      shiftStartLine: true,
    };
    const result = applyOneChange([10, 20], [], [], change);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([11, 21]);
  });

  it("enter in the middle of a covered line still invalidates that line", () => {
    const change = {
      range: {
        start: { line: 10, character: 5 },
        end: { line: 10, character: 5 },
      },
      text: "\n",
    };
    const result = applyOneChange([10, 20], [], [], change);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([21]);
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

  // Backspace at col 0 of line 6 (0-indexed 5): VS Code gives start.line=5 (end of that line),
  // end.line=6, end.character=0, text="". This is the exact join-lines shape — editStart is
  // excluded because only the trailing newline of line 5 is removed, not its content.
  it("backspace at col 0 of line below covered line: coverage stays, lines below shift up", () => {
    const change = {
      range: {
        start: { line: 5, character: 30 },
        end: { line: 6, character: 0 },
      },
      text: "",
    };
    const result = applyOneChange([5], [], [8], change);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([5]);
    expect(result!.uncoverableLines).toEqual([7]);
  });

  it("backspace at col 0 after blank line shifts the covered end line up", () => {
    const change = {
      range: {
        start: { line: 5, character: 0 },
        end: { line: 6, character: 0 },
      },
      text: "",
    };
    const result = applyOneChange([5, 6, 10], [], [8], change);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([5, 9]);
    expect(result!.uncoverableLines).toEqual([7]);
  });

  // Mid-line multi-line replacement: select from col 10 on line 5 through line 7 and replace.
  // Even though start.character > 0, this is NOT a join-lines — line 5's content changes.
  // Coverage on line 5 must be dropped.
  it("mid-line multi-line replacement drops coverage on start line", () => {
    const change = {
      range: {
        start: { line: 5, character: 10 },
        end: { line: 7, character: 5 },
      },
      text: "replaced",
    };
    const result = applyOneChange([5, 10], [], [], change);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([8]); // 5 dropped (start line changed), 10 → 10+(-2)=8
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

  it("overlapping change drops covered line and shifts the rest", () => {
    // First change: insert newline at line 0 → line 10 shifts to 11.
    // Second change: replace lines 8–12 with "y" (lineDelta -4) → line 11 is in range → dropped.
    const changes = [
      { range: { start: { line: 0 }, end: { line: 0 } }, text: "\n" },
      { range: { start: { line: 8 }, end: { line: 12 } }, text: "y" },
    ];
    const result = applyChanges([10], [], [], changes);
    expect(result).not.toBeNull();
    expect(result!.coveredLines).toEqual([]); // 10 → 11 → dropped (in range 8–12)
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
  it("editing a covered line via a VS Code change removes that line, not the previous one", () => {
    const state = makeState([9, 10, 20]);
    const result = applyContentChangesToTrackedState(
      state,
      [
        normalizeContentChangeFromZeroBased({
          range: {
            start: { line: 9, character: 3 },
            end: { line: 9, character: 4 },
          },
          text: "x",
        }),
      ],
      0,
    );
    expect(result.kind).toBe("updated");
    if (result.kind === "updated") {
      expect(result.state.coveredLines).toEqual([9, 20]);
    }
  });

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

  it("edit on a covered line: drops that line, keeps rest", () => {
    const state = makeState([10, 20]);
    const result = applyContentChangesToTrackedState(
      state,
      [{ range: { start: { line: 10 }, end: { line: 10 } }, text: "x" }],
      0,
    );
    expect(result.kind).toBe("updated");
    if (result.kind === "updated") {
      expect(result.state.coveredLines).toEqual([20]); // 10 dropped, 20 unaffected
    }
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

  it("preserveStartLine keeps coverage when enter is pressed at end of covered line", () => {
    const state = makeState([10, 20], [30]);
    const result = applyContentChangesToTrackedState(
      state,
      [
        {
          range: {
            start: { line: 10, character: 20 },
            end: { line: 10, character: 20 },
          },
          text: "\n",
          preserveStartLine: true,
        },
      ],
      0,
    );
    expect(result.kind).toBe("updated");
    if (result.kind === "updated") {
      expect(result.state.coveredLines).toEqual([10, 21]);
      expect(result.state.uncoveredLines).toEqual([31]);
    }
  });

  it("shiftStartLine keeps coverage when enter is pressed at column 0 of a covered line", () => {
    const state = makeState([10, 20], [30]);
    const result = applyContentChangesToTrackedState(
      state,
      [
        {
          range: {
            start: { line: 10, character: 0 },
            end: { line: 10, character: 0 },
          },
          text: "\n",
          shiftStartLine: true,
        },
      ],
      0,
    );
    expect(result.kind).toBe("updated");
    if (result.kind === "updated") {
      expect(result.state.coveredLines).toEqual([11, 21]);
      expect(result.state.uncoveredLines).toEqual([31]);
    }
  });
});
