import { describe, expect, it } from "vitest";
import { renderHumanCoverageDiff } from "./reporter-human";

describe("renderHumanCoverageDiff", () => {
  it("describes raw diff ranges as changed lines instead of executable lines", () => {
    const rendered = renderHumanCoverageDiff({
      baseRef: "main",
      headRef: "HEAD",
      comparisonMode: "merge-base",
      filesChanged: 1,
      filesResolved: 1,
      filesUncovered: 1,
      filesMissingCoverage: 0,
      filesStale: 0,
      changedExecutableLines: 2,
      changedCoveredLines: 1,
      changedUncoveredLines: 1,
      changedUncoverableLines: 0,
      items: [
        {
          filePath: "src/foo.ts",
          status: "uncovered",
          changedLineRanges: [[10, 12]],
          coveredLines: [10],
          uncoveredLines: [11],
          uncoverableLines: [],
          nonExecutableChangedLines: [],
          uncoveredRegions: [],
          lineCoveragePercent: 50,
        },
      ],
    });

    expect(rendered).toContain("changed lines: 10-11");
    expect(rendered).not.toContain("changed executable lines:");
  });
});
