import { describe, expect, it } from "vitest";
import type { CoverageRecord } from "../coverage-resolver";
import { aggregateReportRecords } from "./aggregator";

function createRecord(
  sourcePath: string,
  coveredLines: number[],
  uncoveredLines: number[],
  uncoverableLines: number[] = [],
): CoverageRecord {
  const executableLines = coveredLines.length + uncoveredLines.length;
  return {
    sourcePath,
    coveredLines: new Set(coveredLines),
    uncoveredLines: new Set(uncoveredLines),
    uncoverableLines: new Set(uncoverableLines),
    lineCoveragePercent:
      executableLines > 0
        ? Number(((coveredLines.length / executableLines) * 100).toFixed(2))
        : null,
    sourceFormat: "lcov",
  };
}

describe("aggregateReportRecords", () => {
  it("returns empty totals for empty input", () => {
    expect(aggregateReportRecords([], 10)).toEqual({
      filesDiscovered: 0,
      totals: {
        coveredLines: 0,
        uncoveredLines: 0,
        executableLines: 0,
        aggregateCoveragePercent: null,
      },
      samples: [],
    });
  });

  it("aggregates totals and orders worst files first", () => {
    const records = [
      createRecord("/repo/a.ts", [1, 2, 3], [4]),
      createRecord("/repo/b.ts", [10], [11, 12, 13]),
      createRecord("/repo/c.ts", [], [], [99]),
    ];

    expect(aggregateReportRecords(records, 2)).toEqual({
      filesDiscovered: 3,
      totals: {
        coveredLines: 4,
        uncoveredLines: 4,
        executableLines: 8,
        aggregateCoveragePercent: 50,
      },
      samples: [
        {
          filePath: "/repo/b.ts",
          coveredLines: 1,
          uncoveredLines: 3,
          lineCoveragePercent: 25,
        },
        {
          filePath: "/repo/a.ts",
          coveredLines: 3,
          uncoveredLines: 1,
          lineCoveragePercent: 75,
        },
      ],
    });
  });

  it("excludes uncoverable lines from executable totals", () => {
    const records = [createRecord("/repo/a.ts", [1], [2], [3, 4, 5])];

    expect(aggregateReportRecords(records, 10).totals).toEqual({
      coveredLines: 1,
      uncoveredLines: 1,
      executableLines: 2,
      aggregateCoveragePercent: 50,
    });
  });
});
