/**
 * On-demand path/project coverage aggregation. Walks a list of paths,
 * resolves coverage via getCoverage, and returns aggregate stats.
 * Used by MCP coverage_path and coverage_project (step 1).
 */

import path from 'node:path';
import type { CovfluxConfig } from './covflux-config';
import type { CoverageCacheWritten } from './coverage-cache';
import type { CoverageRecord } from './coverage-resolver';
import { listCoverageHtmlSourcePaths } from './coverage-formats/phpunit-html';
import { listLcovSourcePaths } from './coverage-formats/lcov';

export interface PathAggregateResult {
  aggregateCoveragePercent: number | null;
  totalFiles: number;
  coveredFiles: number;
  missingCoverageFiles: number;
  staleCoverageFiles: number;
  worstFiles: Array<{ filePath: string; lineCoveragePercent: number | null }>;
}

export interface AggregateCoverageOptions {
  paths: string[];
  getCoverage: (path: string) => Promise<CoverageRecord | null>;
  /** Max entries in worstFiles (default 10). */
  worstFilesLimit?: number;
}

export async function aggregateCoverage(
  options: AggregateCoverageOptions
): Promise<PathAggregateResult> {
  const { paths, getCoverage, worstFilesLimit = 10 } = options;
  const records: (CoverageRecord | null)[] = [];
  for (const p of paths) {
    records.push(await getCoverage(p));
  }
  const covered = records.filter((r): r is CoverageRecord => r !== null);
  const coveredFiles = covered.length;
  const missingCoverageFiles = paths.length - coveredFiles;
  const totalExecutable =
    covered.reduce((sum, r) => {
      const exec = r.coveredLines.size + r.uncoveredLines.size;
      return sum + exec;
    }, 0);
  const totalCovered = covered.reduce((sum, r) => sum + r.coveredLines.size, 0);
  const aggregateCoveragePercent =
    totalExecutable > 0
      ? Number(((totalCovered / totalExecutable) * 100).toFixed(2))
      : null;

  const withPercent = covered.map((r) => ({
    filePath: r.sourcePath,
    lineCoveragePercent: r.lineCoveragePercent,
  }));
  const sorted = [...withPercent].sort((a, b) => {
    const pa = a.lineCoveragePercent ?? 101;
    const pb = b.lineCoveragePercent ?? 101;
    return pa - pb;
  });
  const worstFiles = sorted.slice(0, worstFilesLimit);

  return {
    aggregateCoveragePercent,
    totalFiles: paths.length,
    coveredFiles,
    missingCoverageFiles,
    staleCoverageFiles: 0,
    worstFiles,
  };
}

export interface ListCoveredPathsOptions {
  workspaceRoots: string[];
  config: CovfluxConfig;
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
  prefixNorm: string
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
      entry.type === 'phpunit-html'
        ? listCoverageHtmlSourcePaths(workspaceRoots, { coverageHtmlDir: entry.path })
        : entry.type === 'lcov'
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
      ? pathPrefixes.map((p) => p.replace(/\/+$/, ''))
      : pathPrefix != null && pathPrefix !== ''
        ? [pathPrefix.replace(/\/+$/, '')]
        : null;
  if (prefixesToUse != null) {
    result = result.filter((filePath) =>
      prefixesToUse.some((prefixNorm) =>
        underPrefix(filePath, workspaceRoots, prefixNorm)
      )
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
  config: CovfluxConfig
): { paths: string[]; formatType: string } {
  for (const entry of config.formats) {
    const paths =
      entry.type === 'phpunit-html'
        ? listCoverageHtmlSourcePaths(workspaceRoots, { coverageHtmlDir: entry.path })
        : entry.type === 'lcov'
          ? listLcovSourcePaths(workspaceRoots, { path: entry.path })
          : [];
    if (paths.length > 0) {
      return { paths: [...paths].sort(), formatType: entry.type };
    }
  }
  const firstType = config.formats[0]?.type ?? '';
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
  cacheState: 'on-demand' | 'partial' | 'full';
}

export interface GetPathAggregateResponseOptions {
  workspaceRoots: string[];
  config: CovfluxConfig;
  /** Single path prefix (use when querying one path). */
  path?: string;
  /** Multiple path prefixes; aggregate over union of files. Takes precedence over path when both provided. */
  paths?: string[];
  getCoverage: (path: string) => Promise<CoverageRecord | null>;
  worstFilesLimit?: number;
}

/**
 * Build the path-aggregate response for the coverage_path tool.
 * Accepts either path (string) or paths (string[]); paths array allows querying multiple prefixes in one call.
 */
export async function getPathAggregateResponse(
  options: GetPathAggregateResponseOptions
): Promise<PathAggregateResponse> {
  const {
    workspaceRoots,
    config,
    path: singlePath,
    paths: pathArray,
    getCoverage,
    worstFilesLimit,
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
  });
  return {
    paths: pathsRequested,
    ...aggregate,
    cacheState: 'on-demand',
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
  cacheState: 'on-demand' | 'partial' | 'full';
}

export interface GetProjectAggregateResponseOptions {
  workspaceRoots: string[];
  config: CovfluxConfig;
  getCoverage: (path: string) => Promise<CoverageRecord | null>;
}

/**
 * Build the project-aggregate response for the coverage_project tool.
 * Workspace-wide: no path filter; includes detectedFormat (first format with data) and cacheState "on-demand".
 */
export async function getProjectAggregateResponse(
  options: GetProjectAggregateResponseOptions
): Promise<ProjectAggregateResponse> {
  const { workspaceRoots, config, getCoverage } = options;
  const { paths: filePaths, formatType } = listCoveredPathsFromFirstFormat(
    workspaceRoots,
    config
  );
  const aggregate = await aggregateCoverage({
    paths: filePaths,
    getCoverage,
    worstFilesLimit: 0,
  });
  return {
    aggregateCoveragePercent: aggregate.aggregateCoveragePercent,
    totalFiles: aggregate.totalFiles,
    coveredFiles: aggregate.coveredFiles,
    missingCoverageFiles: aggregate.missingCoverageFiles,
    staleCoverageFiles: aggregate.staleCoverageFiles,
    detectedFormat: formatType,
    cacheState: 'on-demand',
  };
}

/**
 * Build project-aggregate response from a valid coverage cache (cacheState: 'full').
 */
export function projectAggregateFromCache(
  cache: CoverageCacheWritten
): ProjectAggregateResponse {
  return {
    aggregateCoveragePercent: cache.aggregateCoveragePercent,
    totalFiles: cache.totalFiles,
    coveredFiles: cache.coveredFiles,
    missingCoverageFiles: cache.missingCoverageFiles,
    staleCoverageFiles: cache.staleCoverageFiles,
    detectedFormat: cache.detectedFormat,
    cacheState: 'full',
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
  worstFilesLimit = 10
): PathAggregateResponse {
  const prefixNorm = pathPrefixes.map((p) => p.replace(/\/+$/, ''));
  const filtered = cache.files.filter((f) => {
    const normalized = path.resolve(f.filePath);
    for (const p of prefixNorm) {
      const prefixFull = path.resolve(workspaceRoot, p);
      if (
        normalized === prefixFull ||
        normalized.startsWith(prefixFull + path.sep)
      ) {
        return true;
      }
    }
    return false;
  });
  const totalCovered = filtered.reduce((s, f) => s + f.coveredLines, 0);
  const totalUncovered = filtered.reduce((s, f) => s + f.uncoveredLines, 0);
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
    cacheState: 'full',
  };
}
