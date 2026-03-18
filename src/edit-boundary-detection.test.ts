import { describe, expect, it } from "vitest";

import {
  shouldPreserveStartLineOnInsert,
  shouldShiftStartLineOnInsert,
} from "./edit-boundary-detection";

describe("shouldPreserveStartLineOnInsert", () => {
  it("preserves the line when Enter is pressed at EOL", () => {
    expect(
      shouldPreserveStartLineOnInsert("", "", {
        range: {
          start: { line: 3, character: 18 },
          end: { line: 3, character: 18 },
        },
        text: "\n",
      }),
    ).toBe(false);

    expect(
      shouldPreserveStartLineOnInsert("// Line 3: covered", "", {
        range: {
          start: { line: 3, character: 18 },
          end: { line: 3, character: 18 },
        },
        text: "\n",
      }),
    ).toBe(true);
  });

  it("preserves the line when Enter at EOL creates an indented blank line", () => {
    expect(
      shouldPreserveStartLineOnInsert("  return 1;", "  ", {
        range: {
          start: { line: 5, character: 11 },
          end: { line: 5, character: 11 },
        },
        text: "\n  ",
      }),
    ).toBe(true);
  });

  it("does not preserve the line when Enter splits the line in the middle", () => {
    expect(
      shouldPreserveStartLineOnInsert("  return", "  1;", {
        range: {
          start: { line: 5, character: 8 },
          end: { line: 5, character: 8 },
        },
        text: "\n  ",
      }),
    ).toBe(false);
  });
});

describe("shouldShiftStartLineOnInsert", () => {
  it("shifts the line when Enter is pressed at column 0", () => {
    expect(
      shouldShiftStartLineOnInsert("", "", {
        range: {
          start: { line: 3, character: 0 },
          end: { line: 3, character: 0 },
        },
        text: "\n",
      }),
    ).toBe(true);
  });

  it("shifts the line when a full line is inserted before it", () => {
    expect(
      shouldShiftStartLineOnInsert("// edit", "", {
        range: {
          start: { line: 3, character: 0 },
          end: { line: 3, character: 0 },
        },
        text: "// edit\n",
      }),
    ).toBe(true);
  });

  it("shifts the line when Enter at column 0 creates indentation on the new blank line", () => {
    expect(
      shouldShiftStartLineOnInsert("", "  return 1;", {
        range: {
          start: { line: 5, character: 0 },
          end: { line: 5, character: 2 },
        },
        text: "\n  ",
      }),
    ).toBe(true);
  });

  it("does not shift the line when inserted text does not end on a line boundary", () => {
    expect(
      shouldShiftStartLineOnInsert("// edit", "", {
        range: {
          start: { line: 3, character: 0 },
          end: { line: 3, character: 0 },
        },
        text: "// edit",
      }),
    ).toBe(false);
  });
});
