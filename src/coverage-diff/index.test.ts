import { describe, expect, it } from "vitest";
import type { ResolverCoverageResult } from "../coverage-resolver";
import { getCoverageDiff } from "./index";

describe("getCoverageDiff", () => {
  it("classifies a changed file as uncovered when any changed executable line is uncovered", async () => {
    const result = await getCoverageDiff(
      {
        workspaceRoots: ["/repo"],
        base: "main",
      },
      {
        getGitDiffForRoot: async () => ({
          baseRef: "main",
          headRef: "HEAD",
          comparisonMode: "merge-base",
          files: [
            {
              repoRelativePath: "src/foo.ts",
              absolutePath: "/repo/src/foo.ts",
              diffStatus: "modified",
              changedLineRanges: [[10, 12]],
            },
          ],
        }),
        getCoverageForFile: async (): Promise<ResolverCoverageResult> => ({
          record: {
            sourcePath: "/repo/src/foo.ts",
            coveredLines: new Set([10]),
            uncoveredLines: new Set([11]),
            uncoverableLines: new Set(),
            lineCoveragePercent: 50,
          },
          sourceFormat: "lcov",
        }),
      },
    );

    expect(result).toMatchObject({
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
          uncoveredRegions: [
            {
              startLine: 11,
              endLine: 11,
              contextStartLine: 9,
              contextEndLine: 13,
            },
          ],
          lineCoveragePercent: 50,
        },
      ],
    });
  });

  it("omits fully covered files by default and includes them when requested", async () => {
    const dependencies = {
      getGitDiffForRoot: async () => ({
        baseRef: "main",
        headRef: "HEAD",
        comparisonMode: "merge-base" as const,
        files: [
          {
            repoRelativePath: "src/covered.ts",
            absolutePath: "/repo/src/covered.ts",
            diffStatus: "modified" as const,
            changedLineRanges: [[20, 22]] as Array<[number, number]>,
          },
        ],
      }),
      getCoverageForFile: async (): Promise<ResolverCoverageResult> => ({
        record: {
          sourcePath: "/repo/src/covered.ts",
          coveredLines: new Set([20, 21]),
          uncoveredLines: new Set(),
          uncoverableLines: new Set(),
          lineCoveragePercent: 100,
        },
      }),
    };

    const omitted = await getCoverageDiff(
      {
        workspaceRoots: ["/repo"],
        base: "main",
      },
      dependencies,
    );
    const included = await getCoverageDiff(
      {
        workspaceRoots: ["/repo"],
        base: "main",
        includeCoveredFiles: true,
      },
      dependencies,
    );

    expect(omitted.filesResolved).toBe(1);
    expect(omitted.items).toEqual([]);
    expect(included.items).toMatchObject([
      {
        filePath: "src/covered.ts",
        status: "covered",
        coveredLines: [20, 21],
        uncoveredLines: [],
      },
    ]);
  });

  it("distinguishes missing coverage from stale coverage", async () => {
    const result = await getCoverageDiff(
      {
        workspaceRoots: ["/repo"],
        base: "main",
      },
      {
        getGitDiffForRoot: async () => ({
          baseRef: "main",
          headRef: "HEAD",
          comparisonMode: "merge-base",
          files: [
            {
              repoRelativePath: "src/missing.ts",
              absolutePath: "/repo/src/missing.ts",
              diffStatus: "modified",
              changedLineRanges: [[1, 2]],
            },
            {
              repoRelativePath: "src/stale.ts",
              absolutePath: "/repo/src/stale.ts",
              diffStatus: "modified",
              changedLineRanges: [[5, 6]],
            },
          ],
        }),
        getCoverageForFile: async (
          filePath,
        ): Promise<ResolverCoverageResult> => {
          if (filePath.endsWith("stale.ts")) {
            return {
              record: null,
              rejectReason: "stale",
            };
          }

          return {
            record: null,
            rejectReason: "no-artifact",
          };
        },
      },
    );

    expect(result.filesMissingCoverage).toBe(1);
    expect(result.filesStale).toBe(1);
    expect(result.items).toMatchObject([
      {
        filePath: "src/missing.ts",
        status: "missing",
        reason: "No configured coverage source resolved this file.",
      },
      {
        filePath: "src/stale.ts",
        status: "stale",
        reason: "Coverage artifact is older than the source file.",
      },
    ]);
  });

  it("reports non-executable changed lines and collapses uncovered regions", async () => {
    const result = await getCoverageDiff(
      {
        workspaceRoots: ["/repo"],
        base: "main",
        contextLines: 1,
      },
      {
        getGitDiffForRoot: async () => ({
          baseRef: "main",
          headRef: "HEAD",
          comparisonMode: "merge-base",
          files: [
            {
              repoRelativePath: "src/regions.ts",
              absolutePath: "/repo/src/regions.ts",
              diffStatus: "modified",
              changedLineRanges: [[30, 36]],
            },
          ],
        }),
        getCoverageForFile: async (): Promise<ResolverCoverageResult> => ({
          record: {
            sourcePath: "/repo/src/regions.ts",
            coveredLines: new Set([30]),
            uncoveredLines: new Set([31, 32, 35]),
            uncoverableLines: new Set([34]),
            lineCoveragePercent: 25,
          },
        }),
      },
    );

    expect(result.changedExecutableLines).toBe(5);
    expect(result.changedUncoverableLines).toBe(1);
    expect(result.items).toMatchObject([
      {
        filePath: "src/regions.ts",
        uncoveredLines: [31, 32, 35],
        uncoverableLines: [34],
        nonExecutableChangedLines: [33],
        uncoveredRegions: [
          {
            startLine: 31,
            endLine: 32,
            contextStartLine: 30,
            contextEndLine: 33,
          },
          {
            startLine: 35,
            endLine: 35,
            contextStartLine: 34,
            contextEndLine: 36,
          },
        ],
      },
    ]);
  });

  it("sorts by severity then path and applies limit after computing summary counts", async () => {
    const result = await getCoverageDiff(
      {
        workspaceRoots: ["/repo"],
        base: "main",
        includeCoveredFiles: true,
        limit: 3,
      },
      {
        getGitDiffForRoot: async () => ({
          baseRef: "main",
          headRef: "HEAD",
          comparisonMode: "merge-base",
          files: [
            {
              repoRelativePath: "src/z-uncovered.ts",
              absolutePath: "/repo/src/z-uncovered.ts",
              diffStatus: "modified",
              changedLineRanges: [[1, 2]],
            },
            {
              repoRelativePath: "src/a-uncovered.ts",
              absolutePath: "/repo/src/a-uncovered.ts",
              diffStatus: "modified",
              changedLineRanges: [[2, 3]],
            },
            {
              repoRelativePath: "src/missing.ts",
              absolutePath: "/repo/src/missing.ts",
              diffStatus: "modified",
              changedLineRanges: [[3, 4]],
            },
            {
              repoRelativePath: "src/unsupported.ts",
              absolutePath: "/repo/src/unsupported.ts",
              diffStatus: "unsupported",
              changedLineRanges: [],
              reason: "Binary diff not supported.",
            },
            {
              repoRelativePath: "src/covered.ts",
              absolutePath: "/repo/src/covered.ts",
              diffStatus: "modified",
              changedLineRanges: [[4, 5]],
            },
          ],
        }),
        getCoverageForFile: async (
          filePath,
        ): Promise<ResolverCoverageResult> => {
          const fileName = filePath.split("/").at(-1) ?? filePath;
          if (filePath.endsWith("missing.ts")) {
            return { record: null, rejectReason: "no-artifact" };
          }
          if (fileName === "covered.ts") {
            return {
              record: {
                sourcePath: filePath,
                coveredLines: new Set([4]),
                uncoveredLines: new Set(),
                uncoverableLines: new Set(),
                lineCoveragePercent: 100,
              },
            };
          }

          return {
            record: {
              sourcePath: filePath,
              coveredLines: new Set(),
              uncoveredLines: new Set(fileName === "a-uncovered.ts" ? [2] : [1]),
              uncoverableLines: new Set(),
              lineCoveragePercent: 0,
            },
          };
        },
      },
    );

    expect(result.filesChanged).toBe(5);
    expect(result.filesResolved).toBe(3);
    expect(result.filesUncovered).toBe(2);
    expect(result.filesMissingCoverage).toBe(1);
    expect(result.items.map((item) => [item.status, item.filePath])).toEqual([
      ["uncovered", "src/a-uncovered.ts"],
      ["uncovered", "src/z-uncovered.ts"],
      ["missing", "src/missing.ts"],
    ]);
  });

});
