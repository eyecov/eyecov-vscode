import { z } from "zod";
import { getCoverageDiff, type CoverageDiffResult } from "../coverage-diff";

export const COVERAGE_DIFF_INPUT_SCHEMA = z.object({
  base: z.string().describe("Base ref to diff against, such as main."),
  head: z
    .string()
    .optional()
    .describe("Optional head ref. Defaults to HEAD."),
  comparison: z
    .enum(["merge-base", "direct"])
    .optional()
    .default("merge-base")
    .describe("Comparison mode. Defaults to merge-base."),
  includeCoveredFiles: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include files whose changed executable lines are fully covered."),
  contextLines: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(2)
    .describe("Context lines around uncovered regions."),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .default(200)
    .describe("Maximum number of items to return."),
});

export const COVERAGE_DIFF_OUTPUT_SCHEMA = z.object({
  baseRef: z.string(),
  headRef: z.string(),
  comparisonMode: z.enum(["merge-base", "direct"]),
  filesChanged: z.number(),
  filesResolved: z.number(),
  filesUncovered: z.number(),
  filesMissingCoverage: z.number(),
  filesStale: z.number(),
  changedExecutableLines: z.number(),
  changedCoveredLines: z.number(),
  changedUncoveredLines: z.number(),
  changedUncoverableLines: z.number(),
  items: z.array(
    z.object({
      filePath: z.string(),
      status: z.enum(["covered", "uncovered", "missing", "stale", "unsupported"]),
      changedLineRanges: z.array(z.tuple([z.number(), z.number()])).optional(),
      coveredLines: z.array(z.number()).optional(),
      uncoveredLines: z.array(z.number()).optional(),
      uncoverableLines: z.array(z.number()).optional(),
      nonExecutableChangedLines: z.array(z.number()).optional(),
      uncoveredRegions: z
        .array(
          z.object({
            startLine: z.number(),
            endLine: z.number(),
            contextStartLine: z.number(),
            contextEndLine: z.number(),
          }),
        )
        .optional(),
      lineCoveragePercent: z.number().nullable().optional(),
      reason: z.string().optional(),
    }),
  ),
});

type ToolResponse = {
  structuredContent: Record<string, unknown>;
  content: Array<{ type: "text"; text: string }>;
};

export function createCoverageDiffToolHandler(dependencies: {
  getWorkspaceRoots: () => Promise<string[]>;
  getCoverageDiff?: typeof getCoverageDiff;
}): (args: z.infer<typeof COVERAGE_DIFF_INPUT_SCHEMA>) => Promise<ToolResponse> {
  const getCoverageDiffImpl = dependencies.getCoverageDiff ?? getCoverageDiff;

  return async (args) => {
    const workspaceRoots = await dependencies.getWorkspaceRoots();
    const response = await getCoverageDiffImpl({
      workspaceRoots,
      base: args.base,
      head: args.head ?? "HEAD",
      comparison: args.comparison ?? "merge-base",
      includeCoveredFiles: args.includeCoveredFiles ?? false,
      contextLines: args.contextLines ?? 2,
      limit: args.limit ?? 200,
    });

    return {
      structuredContent: response as unknown as Record<string, unknown>,
      content: [{ type: "text", text: JSON.stringify(response) }],
    };
  };
}
