/**
 * Coverage cache: write/read .covflux/coverage-cache.json so coverage_path and
 * coverage_project can skip re-aggregation when a valid cache exists (Step 5).
 */

import fs from "node:fs";
import path from "node:path";
import type { CoverageRecord } from "./coverage-resolver";

export const COVERAGE_CACHE_FILENAME = "coverage-cache.json";

export interface CoverageCacheFileEntry {
  filePath: string;
  lineCoveragePercent: number | null;
  coveredLines: number;
  uncoveredLines: number;
  uncoverableLines: number;
}

export interface CoverageCachePayload {
  workspaceRoot: string;
  detectedFormat: string;
  aggregateCoveragePercent: number | null;
  totalFiles: number;
  coveredFiles: number;
  missingCoverageFiles: number;
  staleCoverageFiles: number;
  files: CoverageCacheFileEntry[];
  /** Paths that were listed but had no resolved coverage. Omitted when not computed. */
  missingPaths?: string[];
}

export interface CoverageCacheWritten {
  version: number;
  generatedAt: string;
  workspaceRoot: string;
  detectedFormat: string;
  aggregateCoveragePercent: number | null;
  totalFiles: number;
  coveredFiles: number;
  missingCoverageFiles: number;
  staleCoverageFiles: number;
  files: CoverageCacheFileEntry[];
  /** Paths that were listed but had no resolved coverage. Absent in old caches → treat as []. */
  missingPaths?: string[];
}

/**
 * Write coverage cache to workspaceRoot/.covflux/coverage-cache.json.
 * Creates .covflux directory if needed.
 */
export function writeCoverageCache(
  workspaceRoot: string,
  payload: CoverageCachePayload,
): void {
  const dir = path.join(workspaceRoot, ".covflux");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const cachePath = path.join(dir, COVERAGE_CACHE_FILENAME);
  const written: CoverageCacheWritten = {
    version: 1,
    generatedAt: new Date().toISOString(),
    workspaceRoot: payload.workspaceRoot,
    detectedFormat: payload.detectedFormat,
    aggregateCoveragePercent: payload.aggregateCoveragePercent,
    totalFiles: payload.totalFiles,
    coveredFiles: payload.coveredFiles,
    missingCoverageFiles: payload.missingCoverageFiles,
    staleCoverageFiles: payload.staleCoverageFiles,
    files: payload.files,
    ...(payload.missingPaths != null
      ? { missingPaths: payload.missingPaths }
      : {}),
  };
  fs.writeFileSync(cachePath, JSON.stringify(written, null, 0), "utf-8");
}

export interface BuildCoverageCachePayloadOptions {
  workspaceRoot: string;
  detectedFormat: string;
  records: CoverageRecord[];
  /** Total number of paths that were considered (listed); missingCoverageFiles = totalPathCount - records.length */
  totalPathCount: number;
  /** Full list of paths from the format; when provided, missingPaths = paths with no record. */
  paths?: string[];
}

/**
 * Build cache payload from resolved coverage records and path count.
 * Aggregate percent is computed from sum(covered) / sum(executable) across all records.
 */
function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

export function buildCoverageCachePayload(
  options: BuildCoverageCachePayloadOptions,
): CoverageCachePayload {
  const { workspaceRoot, detectedFormat, records, totalPathCount, paths } =
    options;
  const coveredFiles = records.length;
  const missingCoverageFiles = totalPathCount - coveredFiles;
  const missingPaths =
    paths != null
      ? paths.filter((p) => !records.some((r) => samePath(r.sourcePath, p)))
      : undefined;
  const files: CoverageCacheFileEntry[] = records.map((r) => ({
    filePath: r.sourcePath,
    lineCoveragePercent: r.lineCoveragePercent,
    coveredLines: r.coveredLines.size,
    uncoveredLines: r.uncoveredLines.size,
    uncoverableLines: r.uncoverableLines.size,
  }));
  let aggregateCoveragePercent: number | null = null;
  const totalExecutable = records.reduce(
    (sum, r) => sum + r.coveredLines.size + r.uncoveredLines.size,
    0,
  );
  const totalCovered = records.reduce((sum, r) => sum + r.coveredLines.size, 0);
  if (totalExecutable > 0) {
    aggregateCoveragePercent = Number(
      ((totalCovered / totalExecutable) * 100).toFixed(2),
    );
  }
  return {
    workspaceRoot,
    detectedFormat,
    aggregateCoveragePercent,
    totalFiles: totalPathCount,
    coveredFiles,
    missingCoverageFiles,
    staleCoverageFiles: 0,
    files,
    ...(missingPaths != null ? { missingPaths } : {}),
  };
}

/**
 * Read coverage cache from workspaceRoot/.covflux/coverage-cache.json.
 * Returns null if file is missing, malformed, or has invalid/unsupported version.
 */
export function readCoverageCache(
  workspaceRoot: string,
): CoverageCacheWritten | null {
  const cachePath = path.join(
    workspaceRoot,
    ".covflux",
    COVERAGE_CACHE_FILENAME,
  );
  if (!fs.existsSync(cachePath)) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
  } catch {
    return null;
  }
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) {
    return null;
  }
  if (
    typeof obj.workspaceRoot !== "string" ||
    typeof obj.detectedFormat !== "string" ||
    typeof obj.totalFiles !== "number" ||
    typeof obj.coveredFiles !== "number" ||
    typeof obj.missingCoverageFiles !== "number" ||
    typeof obj.staleCoverageFiles !== "number" ||
    !Array.isArray(obj.files)
  ) {
    return null;
  }
  const result = raw as CoverageCacheWritten;
  if (result.missingPaths == null) {
    result.missingPaths = [];
  }
  return result;
}

/**
 * Delete the coverage cache file for the workspace root (e.g. on invalidation).
 * No-op if the file does not exist.
 */
export function deleteCoverageCache(workspaceRoot: string): void {
  const cachePath = path.join(
    workspaceRoot,
    ".covflux",
    COVERAGE_CACHE_FILENAME,
  );
  try {
    fs.unlinkSync(cachePath);
  } catch {
    // ignore (file may not exist)
  }
}
