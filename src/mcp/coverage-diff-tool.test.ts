import { describe, expect, it } from "vitest";
import type { CoverageDiffResult } from "../coverage-diff";
import { createCoverageDiffToolHandler } from "./coverage-diff-tool";

describe("createCoverageDiffToolHandler", () => {
  it("uses shared defaults and returns the coverage diff result as structured content", async () => {
    const result: CoverageDiffResult = {
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
    };

    const calls: Array<Record<string, unknown>> = [];
    const handler = createCoverageDiffToolHandler({
      getWorkspaceRoots: async () => ["/repo"],
      getCoverageDiff: async (options) => {
        calls.push(options as unknown as Record<string, unknown>);
        return result;
      },
    });

    const response = await handler({
      base: "main",
      head: "HEAD",
      comparison: "merge-base",
      includeCoveredFiles: false,
      contextLines: 2,
      limit: 200,
    });

    expect(calls).toEqual([
      {
        workspaceRoots: ["/repo"],
        base: "main",
        head: "HEAD",
        comparison: "merge-base",
        includeCoveredFiles: false,
        contextLines: 2,
        limit: 200,
      },
    ]);
    expect(response.structuredContent).toEqual(result);
    expect(response.content).toEqual([
      {
        type: "text",
        text: JSON.stringify(result),
      },
    ]);
  });
});
