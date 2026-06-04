import { describe, expect, it } from "vitest";
import { parseSimpleCovJson } from "./parser";

describe("parseSimpleCovJson", () => {
  it("parses modern lines format", () => {
    const result = parseSimpleCovJson(
      JSON.stringify({
        RSpec: {
          coverage: {
            "app/models/user.rb": {
              lines: [null, 1, 0, 2],
              branches: {},
            },
          },
        },
      }),
    );

    expect(result.files).toEqual([
      {
        sourcePath: "app/models/user.rb",
        coveredLines: [2, 4],
        uncoveredLines: [3],
      },
    ]);
    expect(result.totals).toEqual({
      coveredLines: 2,
      executableLines: 3,
      aggregateCoveragePercent: 66.67,
    });
  });

  it("parses older direct array format", () => {
    const result = parseSimpleCovJson(
      JSON.stringify({
        Minitest: {
          coverage: {
            "lib/widget.rb": [null, 0, 3],
          },
        },
      }),
    );

    expect(result.files).toEqual([
      {
        sourcePath: "lib/widget.rb",
        coveredLines: [3],
        uncoveredLines: [2],
      },
    ]);
  });

  it("merges matching files across suites with positive hits winning", () => {
    const result = parseSimpleCovJson(
      JSON.stringify({
        RSpec: {
          coverage: {
            "app/service.rb": { lines: [null, 0, 0, 1] },
          },
        },
        Cucumber: {
          coverage: {
            "app/service.rb": { lines: [null, 1, 0, 0] },
          },
        },
      }),
    );

    expect(result.files).toEqual([
      {
        sourcePath: "app/service.rb",
        coveredLines: [2, 4],
        uncoveredLines: [3],
      },
    ]);
  });

  it("ignores null, missing, and non-integer line data", () => {
    const result = parseSimpleCovJson(
      JSON.stringify({
        RSpec: {
          coverage: {
            "app/service.rb": { lines: [null, "1", 0.5, 0, 2] },
          },
        },
      }),
    );

    expect(result.files).toEqual([
      {
        sourcePath: "app/service.rb",
        coveredLines: [5],
        uncoveredLines: [4],
      },
    ]);
  });

  it("returns empty result for invalid JSON or unknown shape", () => {
    expect(parseSimpleCovJson("not json").files).toEqual([]);
    expect(parseSimpleCovJson(JSON.stringify({ files: {} })).files).toEqual([]);
  });
});
