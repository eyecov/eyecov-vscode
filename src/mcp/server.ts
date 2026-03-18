import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseTestName } from "../coverage-formats/phpunit-html";
import { lineTestsNotSupportedMessage } from "../coverage-formats/xml/shared";
import {
  getPathAggregateResponse,
  getProjectAggregateResponse,
  listCoveredPathsFromFirstFormat,
  pathAggregateFromCache,
  projectAggregateFromCache,
} from "../coverage-aggregate";
import { readCoverageCache } from "../coverage-cache";
import { computeTestPriorityItems } from "../coverage-test-priority";
import {
  loadCoverageConfig,
  getPhpUnitHtmlDir,
  getPhpUnitHtmlSourceSegment,
} from "../coverage-config";
import type { CoverageFileResult } from "../coverage-formats/phpunit-html";
import {
  getCandidatePathsForQuery,
  toFileSystemPath,
} from "../coverage-runtime";
import type { CoverageRecord } from "../coverage-resolver";
import {
  CoverageResolver,
  createAdaptersFromConfig,
} from "../coverage-resolver";

const ANSI_TEXT_LOGO =
  "\u001b[48;2;0;0;0m\u001b[38;2;90;12;163m \u25ae\u001b[38;2;124;58;237m\u25ae\u001b[38;2;159;103;255m\u25ae\u001b[38;2;255;255;255meyecov \u001b[0m\n";

const FILE_INPUT_SCHEMA = z.object({
  query: z
    .string()
    .describe(
      'File path or basename to search for in coverage (e.g. "GetEmployeeAction.php" or "app/Domain/Workspace/Actions/GetEmployeeAction.php"). Matches under workspace coverage-html folders.',
    ),
});

const LINE_TESTS_INPUT_SCHEMA = z
  .object({
    query: z
      .string()
      .optional()
      .describe(
        'File path or basename to look up in coverage (e.g. "GetEmployeeAction.php" or "app/Domain/Workspace/Actions/GetEmployeeAction.php").',
      ),
    file_path: z
      .string()
      .optional()
      .describe(
        "Alias for query. File path or basename to look up in coverage.",
      ),
    line: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Single line number to get covering tests for. Use this OR line_start + line_end.",
      ),
    line_start: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Start of line range (inclusive). Use with line_end; range is [line_start, line_end).",
      ),
    line_end: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "End of line range (exclusive). Lines from line_start up to but not including line_end are included.",
      ),
  })
  .refine((data) => (data.query ?? data.file_path) != null, {
    message: "Either query or file_path is required",
    path: ["query"],
  })
  .refine(
    (data) =>
      data.line != null || (data.line_start != null && data.line_end != null),
    {
      message: "Either line or both line_start and line_end are required",
      path: ["line"],
    },
  )
  .refine(
    (data) => {
      if (data.line_start != null && data.line_end != null)
        return data.line_end > data.line_start;
      return true;
    },
    { message: "line_end must be greater than line_start", path: ["line_end"] },
  );

const COVERAGE_PATH_INPUT_SCHEMA = z
  .object({
    path: z
      .string()
      .optional()
      .describe(
        'Single path or folder prefix to aggregate coverage for (e.g. "app/Domain/Automation").',
      ),
    paths: z
      .array(z.string())
      .optional()
      .describe(
        "Multiple path/folder prefixes; coverage is aggregated over the union of files under any prefix.",
      ),
    worstFilesLimit: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Max number of worst-coverage files to return (default 10)."),
    zeroCoverageFilesLimit: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "When set with coveredLinesCutoff, include up to this many files with covered lines <= cutoff in zeroCoverageFiles.",
      ),
    coveredLinesCutoff: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        "Used with zeroCoverageFilesLimit: files with covered lines <= this go into zeroCoverageFiles.",
      ),
  })
  .refine(
    (data) =>
      (data.path != null && data.path !== "") ||
      (data.paths != null && data.paths.length > 0),
    {
      message: "Either path or paths (non-empty array) is required",
      path: ["path"],
    },
  );

function getConfiguredWorkspaceRoots(): string[] {
  const raw = process.env.EYECOV_WORKSPACE_ROOTS;
  if (!raw) {
    return [];
  }

  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => toFileSystemPath(entry));
}

function resolveWorkspaceRoots(roots: { uri: string }[]): string[] {
  return [
    ...new Set([
      ...roots.map((root) => toFileSystemPath(root.uri)),
      ...getConfiguredWorkspaceRoots(),
    ]),
  ];
}

/** Omit coverageHtmlPath when empty, uncoverableLines when empty/absent. */
function toMatchResponse(m: CoverageFileResult): Record<string, unknown> {
  const { coverageHtmlPath, uncoverableLines, ...rest } = m;
  return {
    ...rest,
    ...(coverageHtmlPath ? { coverageHtmlPath } : {}),
    ...(uncoverableLines?.length ? { uncoverableLines } : {}),
  };
}

/** Build a CoverageFileResult-shaped match from a resolver record (for coverage_file response). */
function recordToMatch(record: CoverageRecord): CoverageFileResult {
  const uncoverableSorted =
    record.uncoverableLines.size > 0
      ? [...record.uncoverableLines].sort((a, b) => a - b)
      : undefined;
  return {
    filePath: record.sourcePath,
    ...(record.coverageHtmlPath
      ? { coverageHtmlPath: record.coverageHtmlPath }
      : {}),
    lineCoveragePercent: record.lineCoveragePercent,
    coveredLines: record.coveredLines.size,
    uncoveredLines: record.uncoveredLines.size,
    coveredLineNumbers: [...record.coveredLines].sort((a, b) => a - b),
    uncoveredLineNumbers: [...record.uncoveredLines].sort((a, b) => a - b),
    ...(uncoverableSorted ? { uncoverableLines: uncoverableSorted } : {}),
  };
}

async function main(): Promise<void> {
  process.stderr.write(ANSI_TEXT_LOGO);

  const server = new McpServer({
    name: "eyecov",
    version: process.env.EYECOV_EXTENSION_VERSION ?? "0.0.0",
  });

  server.registerTool(
    "coverage_file",
    {
      title: "Coverage File",
      description: "Resolve coverage for one file path or basename query.",
      inputSchema: FILE_INPUT_SCHEMA,
      outputSchema: z.object({
        query: z.string(),
        resolved: z.boolean(),
        workspaceRoots: z.array(z.string()),
        message: z.string(),
        matchCount: z.number(),
        matches: z.array(
          z.object({
            filePath: z.string(),
            coverageHtmlPath: z.string().optional(),
            lineCoveragePercent: z.number().nullable(),
            coveredLines: z.number(),
            uncoveredLines: z.number(),
            coveredLineNumbers: z.array(z.number()),
            uncoveredLineNumbers: z.array(z.number()),
            uncoverableLines: z.array(z.number()).optional(),
          }),
        ),
      }),
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ query }) => {
      const rootsResponse = await server.server
        .listRoots()
        .catch(() => ({ roots: [] }));
      const workspaceRoots = resolveWorkspaceRoots(rootsResponse.roots);
      const config = loadCoverageConfig(workspaceRoots[0] ?? "");
      const coverageHtmlDir = getPhpUnitHtmlDir(config);
      const sourceSegment = getPhpUnitHtmlSourceSegment(config);
      const resolver = new CoverageResolver({
        workspaceRoots,
        adapters: createAdaptersFromConfig(config),
      });
      const candidatePaths = getCandidatePathsForQuery(query, workspaceRoots, {
        coverageHtmlDir,
        sourceSegment,
      });
      const records: CoverageRecord[] = [];
      for (const filePath of candidatePaths) {
        const result = await resolver.getCoverage(filePath);
        if (result.record) records.push(result.record);
      }
      const sourceLabel =
        records.length > 0
          ? records[0].sourceFormat === "phpunit-html"
            ? "coverage-html"
            : (records[0].sourceFormat ?? "coverage")
          : "coverage";
      const response = {
        query,
        resolved: records.length > 0,
        workspaceRoots,
        message:
          records.length === 0
            ? "No matching files were found in workspace coverage."
            : records.length === 1
              ? `Resolved one file match from ${sourceLabel}.`
              : `Resolved multiple file matches from ${sourceLabel}.`,
        matchCount: records.length,
        matches: records.map((r) => toMatchResponse(recordToMatch(r))),
      };

      return {
        structuredContent: response,
        content: [
          {
            type: "text",
            text: JSON.stringify(response),
          },
        ],
      };
    },
  );

  server.registerTool(
    "coverage_line_tests",
    {
      title: "Coverage Line Tests",
      description:
        "Return covering tests for a file and line(s). Accepts query (or file_path), and either line or line_start+line_end (end exclusive).",
      inputSchema: LINE_TESTS_INPUT_SCHEMA,
      outputSchema: z.object({
        query: z.string(),
        line: z.number().optional(),
        line_start: z.number().optional(),
        line_end: z.number().optional(),
        lines: z.array(z.number()).optional(),
        resolved: z.boolean(),
        workspaceRoots: z.array(z.string()),
        message: z.string(),
        matchCount: z.number(),
        matches: z.array(
          z.object({
            filePath: z.string(),
            coverageHtmlPath: z.string().optional(),
            lineState: z.enum(["covered", "uncovered", "not-executable"]),
            tests: z.array(
              z.object({
                raw: z.string(),
                className: z.string(),
                decodedPath: z.string(),
                description: z.string(),
                testFilePath: z.string(),
              }),
            ),
            /** Present when this coverage format does not provide per-line test data. */
            lineTestsNotSupported: z.string().optional(),
          }),
        ),
      }),
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args) => {
      const query = args.query ?? args.file_path ?? "";
      const lines: number[] =
        args.line_start != null && args.line_end != null
          ? Array.from(
              { length: args.line_end - args.line_start },
              (_, i) => args.line_start! + i,
            )
          : args.line != null
            ? [args.line]
            : [];

      const rootsResponse = await server.server
        .listRoots()
        .catch(() => ({ roots: [] }));
      const workspaceRoots = resolveWorkspaceRoots(rootsResponse.roots);
      const config = loadCoverageConfig(workspaceRoots[0] ?? "");
      const coverageHtmlDir = getPhpUnitHtmlDir(config);
      const sourceSegment = getPhpUnitHtmlSourceSegment(config);
      const resolver = new CoverageResolver({
        workspaceRoots,
        adapters: createAdaptersFromConfig(config),
      });
      const candidatePaths = getCandidatePathsForQuery(query, workspaceRoots, {
        coverageHtmlDir,
        sourceSegment,
      });
      const records: CoverageRecord[] = [];
      for (const filePath of candidatePaths) {
        const result = await resolver.getCoverage(filePath);
        if (result.record) records.push(result.record);
      }

      const response = {
        query,
        line: lines.length === 1 ? lines[0] : undefined,
        line_start: args.line_start,
        line_end: args.line_end,
        lines,
        resolved: records.length > 0,
        workspaceRoots,
        message:
          records.length === 0
            ? "No matching files were found in workspace coverage."
            : records.length === 1
              ? lines.length === 1
                ? "Resolved one file match for the requested line."
                : `Resolved one file match for lines ${lines[0]}-${lines[lines.length - 1]} (${lines.length} lines).`
              : lines.length === 1
                ? "Resolved multiple file matches for the requested line."
                : `Resolved multiple file matches for lines ${lines[0]}-${lines[lines.length - 1]}.`,
        matchCount: records.length,
        matches: records.map((record) => {
          const testsByLine = record.testsByLine ?? new Map<number, string[]>();
          const coveredSet = record.coveredLines;
          const uncoveredSet = record.uncoveredLines;
          const allTestsRaw = new Set<string>();
          let anyCovered = false;
          let anyUncovered = false;
          for (const lineNum of lines) {
            for (const raw of testsByLine.get(lineNum) ?? [])
              allTestsRaw.add(raw);
            if (coveredSet.has(lineNum)) anyCovered = true;
            if (uncoveredSet.has(lineNum)) anyUncovered = true;
          }
          const lineState = anyUncovered
            ? "uncovered"
            : anyCovered
              ? "covered"
              : "not-executable";
          const workspaceRoot =
            workspaceRoots.find(
              (r) =>
                path.resolve(record.sourcePath) === path.resolve(r) ||
                path
                  .resolve(record.sourcePath)
                  .startsWith(path.resolve(r) + path.sep),
            ) ?? workspaceRoots[0];
          const tests = [...allTestsRaw].map((raw) => {
            const normalized = parseTestName(raw);
            const testFilePath = workspaceRoot
              ? path.join(workspaceRoot, normalized.path)
              : normalized.path;
            return {
              raw,
              className: normalized.class,
              decodedPath: normalized.path,
              description: normalized.description,
              testFilePath: path.normalize(testFilePath),
            };
          });
          const lineTestsNotSupported = !record.coverageHtmlPath
            ? lineTestsNotSupportedMessage(record.sourceFormat ?? "non-HTML")
            : undefined;
          return {
            filePath: record.sourcePath,
            ...(record.coverageHtmlPath
              ? { coverageHtmlPath: record.coverageHtmlPath }
              : {}),
            lineState,
            tests,
            ...(lineTestsNotSupported ? { lineTestsNotSupported } : {}),
          };
        }),
      };

      const lineLabel =
        lines.length === 1
          ? `line ${lines[0]}`
          : `lines ${lines[0]}-${lines[lines.length - 1]} (${lines.length} lines)`;
      const summaryLines: string[] = [
        `Covering tests for ${lineLabel} (${response.matchCount} file(s) matched)`,
        "",
      ];
      for (const m of response.matches) {
        summaryLines.push(`${path.basename(m.filePath)} (${m.lineState})`);
        if (m.lineTestsNotSupported) {
          summaryLines.push(`  ${m.lineTestsNotSupported}`);
        } else {
          const byTestFile = new Map<string, typeof m.tests>();
          for (const t of m.tests) {
            const key = t.testFilePath;
            if (!byTestFile.has(key)) byTestFile.set(key, []);
            byTestFile.get(key)!.push(t);
          }
          for (const [testFilePath, tests] of byTestFile) {
            summaryLines.push(
              `  ${path.basename(testFilePath)}: ${testFilePath}`,
            );
            for (const t of tests) {
              summaryLines.push(
                `    - ${t.description || t.className || t.decodedPath}`,
              );
            }
          }
        }
        summaryLines.push("");
      }

      return {
        structuredContent: response,
        content: [
          { type: "text", text: summaryLines.join("\n").trimEnd() },
          { type: "text", text: "\n\n" + JSON.stringify(response) },
        ],
      };
    },
  );

  server.registerTool(
    "coverage_path",
    {
      title: "Coverage Path",
      description:
        "Aggregate coverage for one or more path/folder prefixes. Supply path (string) or paths (array of strings) to aggregate over those directories.",
      inputSchema: COVERAGE_PATH_INPUT_SCHEMA,
      outputSchema: z.object({
        paths: z.array(z.string()),
        aggregateCoveragePercent: z.number().nullable(),
        totalFiles: z.number(),
        coveredFiles: z.number(),
        missingCoverageFiles: z.number(),
        staleCoverageFiles: z.number(),
        worstFiles: z.array(
          z.object({
            filePath: z.string(),
            lineCoveragePercent: z.number().nullable(),
          }),
        ),
        cacheState: z.enum(["on-demand", "partial", "full"]),
        zeroCoverageFiles: z
          .array(
            z.object({
              filePath: z.string(),
              lineCoveragePercent: z.number().nullable(),
              coveredLines: z.number().optional(),
            }),
          )
          .optional(),
      }),
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args) => {
      const rootsResponse = await server.server
        .listRoots()
        .catch(() => ({ roots: [] }));
      const workspaceRoots = resolveWorkspaceRoots(rootsResponse.roots);
      const root = workspaceRoots[0];
      const pathPrefixes =
        args.paths != null && args.paths.length > 0
          ? args.paths
          : args.path != null
            ? [args.path]
            : [];
      const cache = root ? readCoverageCache(root) : null;
      const worstFilesLimit = args.worstFilesLimit ?? 10;
      if (cache && pathPrefixes.length > 0) {
        const response = pathAggregateFromCache(
          cache,
          root,
          pathPrefixes,
          worstFilesLimit,
        );
        return {
          structuredContent: response as unknown as Record<string, unknown>,
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      }
      const config = loadCoverageConfig(root ?? "");
      const resolver = new CoverageResolver({
        workspaceRoots,
        adapters: createAdaptersFromConfig(config),
      });
      const pathInput =
        pathPrefixes.length > 0
          ? { paths: pathPrefixes }
          : { path: args.path! };
      const response = await getPathAggregateResponse({
        workspaceRoots,
        config,
        ...pathInput,
        getCoverage: (p) => resolver.getCoverage(p).then((r) => r.record),
        worstFilesLimit,
        zeroCoverageFilesLimit: args.zeroCoverageFilesLimit,
        coveredLinesCutoff: args.coveredLinesCutoff,
      });
      return {
        structuredContent: response as unknown as Record<string, unknown>,
        content: [
          {
            type: "text",
            text: JSON.stringify(response),
          },
        ],
      };
    },
  );

  server.registerTool(
    "coverage_project",
    {
      title: "Coverage Project",
      description:
        "Aggregate workspace-wide coverage. Returns aggregate percent, file counts, detected format, and cache state (full when prewarm cache exists, otherwise on-demand).",
      inputSchema: z.object({
        worstFilesLimit: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Max number of worst-coverage files to return (default 0).",
          ),
        zeroCoverageFilesLimit: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "When set with coveredLinesCutoff, include up to this many files with covered lines <= cutoff in zeroCoverageFiles.",
          ),
        coveredLinesCutoff: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "Used with zeroCoverageFilesLimit: files with covered lines <= this go into zeroCoverageFiles.",
          ),
      }),
      outputSchema: z.object({
        aggregateCoveragePercent: z.number().nullable(),
        totalFiles: z.number(),
        coveredFiles: z.number(),
        missingCoverageFiles: z.number(),
        staleCoverageFiles: z.number(),
        detectedFormat: z.string(),
        cacheState: z.enum(["on-demand", "partial", "full"]),
        zeroCoverageFiles: z
          .array(
            z.object({
              filePath: z.string(),
              lineCoveragePercent: z.number().nullable(),
              coveredLines: z.number().optional(),
            }),
          )
          .optional(),
      }),
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args) => {
      const rootsResponse = await server.server
        .listRoots()
        .catch(() => ({ roots: [] }));
      const workspaceRoots = resolveWorkspaceRoots(rootsResponse.roots);
      const root = workspaceRoots[0];
      const cache = root ? readCoverageCache(root) : null;
      if (cache) {
        const response = projectAggregateFromCache(cache);
        return {
          structuredContent: response as unknown as Record<string, unknown>,
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      }
      const config = loadCoverageConfig(root ?? "");
      const resolver = new CoverageResolver({
        workspaceRoots,
        adapters: createAdaptersFromConfig(config),
      });
      const response = await getProjectAggregateResponse({
        workspaceRoots,
        config,
        getCoverage: (p) => resolver.getCoverage(p).then((r) => r.record),
        worstFilesLimit: args.worstFilesLimit,
        zeroCoverageFilesLimit: args.zeroCoverageFilesLimit,
        coveredLinesCutoff: args.coveredLinesCutoff,
      });
      return {
        structuredContent: response as unknown as Record<string, unknown>,
        content: [
          {
            type: "text",
            text: JSON.stringify(response),
          },
        ],
      };
    },
  );

  const COVERAGE_TEST_PRIORITY_INPUT_SCHEMA = z.object({
    includeNoCoverage: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        'When true (default), include files with no coverage as top priority. Set to false for "where to add tests except where coverage is zero".',
      ),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(20)
      .describe("Maximum number of items to return (default 20)."),
  });

  server.registerTool(
    "coverage_test_priority",
    {
      title: "Coverage Test Priority",
      description:
        "Recommend where to add tests first using coverage data: files with no coverage (highest priority), then low line coverage % and high uncovered line count. Optional includeNoCoverage=false excludes zero-coverage files; limit caps results (default 20).",
      inputSchema: COVERAGE_TEST_PRIORITY_INPUT_SCHEMA,
      outputSchema: z.object({
        scope: z.literal("project"),
        cacheState: z.enum(["on-demand", "full"]),
        items: z.array(
          z.object({
            filePath: z.string(),
            priorityScore: z.number(),
            lineCoveragePercent: z.number().nullable(),
            uncoveredLines: z.number(),
            reasons: z.array(z.string()),
          }),
        ),
      }),
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args) => {
      const rootsResponse = await server.server
        .listRoots()
        .catch(() => ({ roots: [] }));
      const workspaceRoots = resolveWorkspaceRoots(rootsResponse.roots);
      const root = workspaceRoots[0];
      const includeNoCoverage = args?.includeNoCoverage ?? true;
      const limit = args?.limit ?? 20;
      const cache = root ? readCoverageCache(root) : null;

      if (cache) {
        const items = computeTestPriorityItems({
          filesWithCoverage: cache.files,
          missingPaths: includeNoCoverage ? (cache.missingPaths ?? []) : [],
          limit,
          fromCache: true,
          includeNoCoverage,
        });
        const response = {
          scope: "project" as const,
          cacheState: "full" as const,
          items,
        };
        return {
          structuredContent: response as unknown as Record<string, unknown>,
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      }

      const config = loadCoverageConfig(root ?? "");
      const resolver = new CoverageResolver({
        workspaceRoots,
        adapters: createAdaptersFromConfig(config),
      });
      const { paths: filePaths } = listCoveredPathsFromFirstFormat(
        workspaceRoots,
        config,
      );
      if (filePaths.length === 0) {
        const response = {
          scope: "project" as const,
          cacheState: "on-demand" as const,
          items: [],
        };
        return {
          structuredContent: response as unknown as Record<string, unknown>,
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      }

      const records: CoverageRecord[] = [];
      const missingPaths: string[] = [];
      for (const p of filePaths) {
        const result = await resolver.getCoverage(p);
        if (result.record) {
          records.push(result.record);
        } else if (includeNoCoverage) {
          missingPaths.push(p);
        }
      }
      const filesWithCoverage = records.map((r) => ({
        filePath: r.sourcePath,
        lineCoveragePercent: r.lineCoveragePercent,
        coveredLines: r.coveredLines.size,
        uncoveredLines: r.uncoveredLines.size,
        uncoverableLines: r.uncoverableLines.size,
      }));
      const items = computeTestPriorityItems({
        filesWithCoverage,
        missingPaths,
        limit,
        fromCache: false,
        includeNoCoverage,
      });
      const response = {
        scope: "project" as const,
        cacheState: "on-demand" as const,
        items,
      };
      return {
        structuredContent: response as unknown as Record<string, unknown>,
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
