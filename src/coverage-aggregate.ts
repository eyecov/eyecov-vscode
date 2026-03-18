/**
 * On-demand path/project coverage aggregation. Walks a list of paths,
 * resolves coverage via getCoverage, and returns aggregate stats.
 * Used by MCP coverage_path and coverage_project (step 1).
 */

import path from "node:path";
import type { CoverageConfig } from "./coverage-config";
import type { CoverageCacheWritten } from "./coverage-cache";
import type { CoverageRecord } from "./coverage-resolver";
import { listCoverageHtmlSourcePaths } from "./coverage-formats/phpunit-html";
import { listLcovSourcePaths } from "./coverage-formats/lcov";

export interface PathAggregateResult {
  aggregateCoveragePercent: number | null;
  totalFiles: number;
  coveredFiles: number;
  missingCoverageFiles: number;
  staleCoverageFiles: number;
  worstFiles: Array<{ filePath: string; lineCoveragePercent: number | null }>;
  /** Files with coveredLines <= cutoff; only present when options include zeroCoverageFilesLimit. */
  zeroCoverageFiles?: Array<{
    filePath: string;
    lineCoveragePercent: number | null;
    coveredLines?: number;
  }>;
}

export interface AggregateCoverageOptions {
  paths: string[];
  getCoverage: (path: string) => Promise<CoverageRecord | null>;
  /** Max entries in worstFiles (default 10). */
  worstFilesLimit?: number;
  /** Max entries in zeroCoverageFiles (default 10 when cutoff/limit used). */
  zeroCoverageFilesLimit?: number;
  /** Files with coveredLines.size <= this go into zeroCoverageFiles; files above go into worstFiles (default 0). */
  coveredLinesCutoff?: number;
}

export async function aggregateCoverage(
  options: AggregateCoverageOptions,
): Promise<PathAggregateResult> {
  const {
    paths,
    getCoverage,
    worstFilesLimit = 10,
    zeroCoverageFilesLimit,
    coveredLinesCutoff = 0,
  } = options;
  const records: (CoverageRecord | null)[] = [];
  for (const p of paths) {
    records.push(await getCoverage(p));
  }
  const covered = records.filter((r): r is CoverageRecord => r !== null);
  const coveredFiles = covered.length;
  const missingCoverageFiles = paths.length - coveredFiles;
  let totalExecutable = 0;
  let totalCovered = 0;
  for (const r of covered) {
    totalCovered += r.coveredLines.size;
    totalExecutable += r.coveredLines.size + r.uncoveredLines.size;
  }
  const aggregateCoveragePercent =
    totalExecutable > 0
      ? Number(((totalCovered / totalExecutable) * 100).toFixed(2))
      : null;

  const withPercentAndCovered = covered.map((r) => ({
    filePath: r.sourcePath,
    lineCoveragePercent: r.lineCoveragePercent,
    coveredCount: r.coveredLines.size,
  }));

  const useCutoff = zeroCoverageFilesLimit !== undefined;
  let aboveCutoff = withPercentAndCovered;
  const atOrBelowCutoff: typeof withPercentAndCovered = [];
  if (useCutoff) {
    aboveCutoff = [];
    for (const x of withPercentAndCovered) {
      if (x.coveredCount > coveredLinesCutoff) {
        aboveCutoff.push(x);
      } else {
        atOrBelowCutoff.push(x);
      }
    }
  }

  const sortedWorst = [...aboveCutoff].sort((a, b) => {
    const pa = a.lineCoveragePercent ?? 101;
    const pb = b.lineCoveragePercent ?? 101;
    return pa - pb;
  });
  const worstFiles = sortedWorst
    .slice(0, worstFilesLimit)
    .map(({ filePath, lineCoveragePercent }) => ({
      filePath,
      lineCoveragePercent,
    }));

  const result: PathAggregateResult = {
    aggregateCoveragePercent,
    totalFiles: paths.length,
    coveredFiles,
    missingCoverageFiles,
    staleCoverageFiles: 0,
    worstFiles,
  };
  if (useCutoff) {
    result.zeroCoverageFiles = atOrBelowCutoff
      .slice(0, zeroCoverageFilesLimit!)
      .map((x) => ({
        filePath: x.filePath,
        lineCoveragePercent: x.lineCoveragePercent,
        coveredLines: x.coveredCount,
      }));
  }
  return result;
}

export interface ListCoveredPathsOptions {
  workspaceRoots: string[];
  config: CoverageConfig;
  /** Optional single path prefix. Ignored when pathPrefixes is non-empty. */
  pathPrefix?: string | null;
  /** Optional array of path prefixes. Files under any prefix are included (union). */
  pathPrefixes?: string[] | null;
}

/**
 * Discover all source file paths that have coverage data from configured formats.
 * Merges PHPUnit HTML and LCOV lists, dedupes, and optionally filters by pathPrefix.
 */
function underPrefix(
  filePath: string,
  workspaceRoots: string[],
  prefixNorm: string,
): boolean {
  const normalized = path.resolve(filePath);
  for (const root of workspaceRoots) {
    const prefixFull = path.resolve(root, prefixNorm);
    if (
      normalized === prefixFull ||
      normalized.startsWith(prefixFull + path.sep)
    ) {
      return true;
    }
  }
  return false;
}

export function listCoveredPaths(options: ListCoveredPathsOptions): string[] {
  const { workspaceRoots, config, pathPrefix, pathPrefixes } = options;
  const seen = new Set<string>();
  for (const entry of config.formats) {
    const paths =
      entry.type === "phpunit-html"
        ? listCoverageHtmlSourcePaths(workspaceRoots, {
            coverageHtmlDir: entry.path,
            sourceSegment: entry.sourceSegment ?? "auto",
          })
        : entry.type === "lcov"
          ? listLcovSourcePaths(workspaceRoots, { path: entry.path })
          : [];
    for (const p of paths) {
      const resolved = path.resolve(p);
      seen.add(resolved);
    }
  }
  let result = [...seen].sort();
  const prefixesToUse =
    pathPrefixes != null && pathPrefixes.length > 0
      ? pathPrefixes.map((p) => p.replace(/\/+$/, ""))
      : pathPrefix != null && pathPrefix !== ""
        ? [pathPrefix.replace(/\/+$/, "")]
        : null;
  if (prefixesToUse != null) {
    result = result.filter((filePath) =>
      prefixesToUse.some((prefixNorm) =>
        underPrefix(filePath, workspaceRoots, prefixNorm),
      ),
    );
  }
  return result;
}

/**
 * Discover paths from the first configured format that has any coverage data (priority order).
 * Used for coverage_project so aggregation is per single format, not merged.
 */
export function listCoveredPathsFromFirstFormat(
  workspaceRoots: string[],
  config: CoverageConfig,
): { paths: string[]; formatType: string } {
  for (const entry of config.formats) {
    const paths =
      entry.type === "phpunit-html"
        ? listCoverageHtmlSourcePaths(workspaceRoots, {
            coverageHtmlDir: entry.path,
            sourceSegment: entry.sourceSegment ?? "auto",
          })
        : entry.type === "lcov"
          ? listLcovSourcePaths(workspaceRoots, { path: entry.path })
          : [];
    if (paths.length > 0) {
      return { paths: [...paths].sort(), formatType: entry.type };
    }
  }
  const firstType = config.formats[0]?.type ?? "";
  return { paths: [], formatType: firstType };
}

/** Response shape for coverage_path tool (single or multiple path prefixes). */
export interface PathAggregateResponse {
  paths: string[];
  aggregateCoveragePercent: number | null;
  totalFiles: number;
  coveredFiles: number;
  missingCoverageFiles: number;
  staleCoverageFiles: number;
  worstFiles: Array<{ filePath: string; lineCoveragePercent: number | null }>;
  cacheState: "on-demand" | "partial" | "full";
  /** Present when options include zeroCoverageFilesLimit. */
  zeroCoverageFiles?: PathAggregateResult["zeroCoverageFiles"];
}

export interface GetPathAggregateResponseOptions {
  workspaceRoots: string[];
  config: CoverageConfig;
  /** Single path prefix (use when querying one path). */
  path?: string;
  /** Multiple path prefixes; aggregate over union of files. Takes precedence over path when both provided. */
  paths?: string[];
  getCoverage: (path: string) => Promise<CoverageRecord | null>;
  worstFilesLimit?: number;
  zeroCoverageFilesLimit?: number;
  coveredLinesCutoff?: number;
}

/**
 * Build the path-aggregate response for the coverage_path tool.
 * Accepts either path (string) or paths (string[]); paths array allows querying multiple prefixes in one call.
 */
export async function getPathAggregateResponse(
  options: GetPathAggregateResponseOptions,
): Promise<PathAggregateResponse> {
  const {
    workspaceRoots,
    config,
    path: singlePath,
    paths: pathArray,
    getCoverage,
    worstFilesLimit,
    zeroCoverageFilesLimit,
    coveredLinesCutoff,
  } = options;
  const pathsRequested =
    pathArray != null && pathArray.length > 0
      ? pathArray
      : singlePath != null
        ? [singlePath]
        : [];
  const filePaths = listCoveredPaths({
    workspaceRoots,
    config,
    pathPrefixes: pathsRequested.length > 0 ? pathsRequested : undefined,
  });
  const aggregate = await aggregateCoverage({
    paths: filePaths,
    getCoverage,
    worstFilesLimit,
    zeroCoverageFilesLimit,
    coveredLinesCutoff,
  });
  return {
    paths: pathsRequested,
    ...aggregate,
    cacheState: "on-demand",
  };
}

/** Response shape for coverage_project tool (workspace-wide). */
export interface ProjectAggregateResponse {
  aggregateCoveragePercent: number | null;
  totalFiles: number;
  coveredFiles: number;
  missingCoverageFiles: number;
  staleCoverageFiles: number;
  detectedFormat: string;
  cacheState: "on-demand" | "partial" | "full";
  /** Present when options include zeroCoverageFilesLimit. */
  zeroCoverageFiles?: PathAggregateResult["zeroCoverageFiles"];
}

export interface GetProjectAggregateResponseOptions {
  workspaceRoots: string[];
  config: CoverageConfig;
  getCoverage: (path: string) => Promise<CoverageRecord | null>;
  worstFilesLimit?: number;
  zeroCoverageFilesLimit?: number;
  coveredLinesCutoff?: number;
}

/**
 * Build the project-aggregate response for the coverage_project tool.
 * Workspace-wide: no path filter; includes detectedFormat (first format with data) and cacheState "on-demand".
 */
export async function getProjectAggregateResponse(
  options: GetProjectAggregateResponseOptions,
): Promise<ProjectAggregateResponse> {
  const {
    workspaceRoots,
    config,
    getCoverage,
    worstFilesLimit = 0,
    zeroCoverageFilesLimit,
    coveredLinesCutoff,
  } = options;
  const { paths: filePaths, formatType } = listCoveredPathsFromFirstFormat(
    workspaceRoots,
    config,
  );
  const aggregate = await aggregateCoverage({
    paths: filePaths,
    getCoverage,
    worstFilesLimit,
    zeroCoverageFilesLimit,
    coveredLinesCutoff,
  });
  return {
    aggregateCoveragePercent: aggregate.aggregateCoveragePercent,
    totalFiles: aggregate.totalFiles,
    coveredFiles: aggregate.coveredFiles,
    missingCoverageFiles: aggregate.missingCoverageFiles,
    staleCoverageFiles: aggregate.staleCoverageFiles,
    detectedFormat: formatType,
    cacheState: "on-demand",
    ...(aggregate.zeroCoverageFiles != null && {
      zeroCoverageFiles: aggregate.zeroCoverageFiles,
    }),
  };
}

/**
 * Build project-aggregate response from a valid coverage cache (cacheState: 'full').
 */
export function projectAggregateFromCache(
  cache: CoverageCacheWritten,
): ProjectAggregateResponse {
  return {
    aggregateCoveragePercent: cache.aggregateCoveragePercent,
    totalFiles: cache.totalFiles,
    coveredFiles: cache.coveredFiles,
    missingCoverageFiles: cache.missingCoverageFiles,
    staleCoverageFiles: cache.staleCoverageFiles,
    detectedFormat: cache.detectedFormat,
    cacheState: "full",
  };
}

/**
 * Build path-aggregate response from a valid coverage cache by filtering files
 * by path prefix(es) and aggregating (cacheState: 'full').
 */
export function pathAggregateFromCache(
  cache: CoverageCacheWritten,
  workspaceRoot: string,
  pathPrefixes: string[],
  worstFilesLimit = 10,
): PathAggregateResponse {
  const prefixNorm = pathPrefixes.map((p) => p.replace(/\/+$/, ""));
  const filtered = cache.files.filter((f) =>
    prefixNorm.some((p) => underPrefix(f.filePath, [workspaceRoot], p)),
  );
  let totalCovered = 0;
  let totalUncovered = 0;
  for (const f of filtered) {
    totalCovered += f.coveredLines;
    totalUncovered += f.uncoveredLines;
  }
  const totalExecutable = totalCovered + totalUncovered;
  const aggregateCoveragePercent =
    totalExecutable > 0
      ? Number(((totalCovered / totalExecutable) * 100).toFixed(2))
      : null;
  const sorted = [...filtered].sort((a, b) => {
    const pa = a.lineCoveragePercent ?? 101;
    const pb = b.lineCoveragePercent ?? 101;
    return pa - pb;
  });
  const worstFiles = sorted.slice(0, worstFilesLimit).map((f) => ({
    filePath: f.filePath,
    lineCoveragePercent: f.lineCoveragePercent,
  }));
  return {
    paths: pathPrefixes,
    aggregateCoveragePercent,
    totalFiles: filtered.length,
    coveredFiles: filtered.length,
    missingCoverageFiles: 0,
    staleCoverageFiles: 0,
    worstFiles,
    cacheState: "full",
  };
}
