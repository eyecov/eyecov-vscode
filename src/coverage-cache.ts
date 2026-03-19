/**
 * Coverage cache: write/read .eyecov/coverage-cache.json so coverage_path and
 * coverage_project can skip re-aggregation when a valid cache exists (Step 5).
 */

import fs from "node:fs";
import path from "node:path";
import type { CoverageRecord } from "./coverage-resolver";

export const COVERAGE_CACHE_FILENAME = "coverage-cache.json";

export interface ArtifactFingerprint {
  mtime: number;
  size: number;
}

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
  /** Fingerprints of the coverage artifacts used to build this cache. */
  globalFingerprint?: Record<string, ArtifactFingerprint>;
  /** Whether this cache represents a full project crawl or a partial update. Default: "full" */
  cacheState?: "partial" | "full";
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
  /** Fingerprints of the coverage artifacts used to build this cache. */
  globalFingerprint?: Record<string, ArtifactFingerprint>;
  /** Whether this cache represents a full project crawl or a partial update. Default: "full" */
  cacheState?: "partial" | "full";
}

/**
 * Write coverage cache to workspaceRoot/.eyecov/coverage-cache.json.
 * Creates .eyecov directory if needed.
 */
export function writeCoverageCache(
  workspaceRoot: string,
  payload: CoverageCachePayload,
): void {
  const dir = path.join(workspaceRoot, ".eyecov");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const cachePath = path.join(dir, COVERAGE_CACHE_FILENAME);
  const tempPath = path.join(
    dir,
    `${COVERAGE_CACHE_FILENAME}.${process.pid}.${Date.now()}.tmp`,
  );
  const written: CoverageCacheWritten = {
    version: 2,
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
    ...(payload.globalFingerprint != null
      ? { globalFingerprint: payload.globalFingerprint }
      : {}),
    cacheState: payload.cacheState ?? "full",
  };
  const serialized = JSON.stringify(written, null, 0);
  let fd: number | undefined;
  try {
    fd = fs.openSync(tempPath, "w");
    fs.writeFileSync(fd, serialized, "utf-8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, cachePath);
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close failure while surfacing original error
      }
    }
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore temp cleanup failure
    }
    throw error;
  }
}

export interface BuildCoverageCachePayloadOptions {
  workspaceRoot: string;
  detectedFormat: string;
  records: CoverageRecord[];
  /** Total number of paths that were considered (listed); missingCoverageFiles = totalPathCount - records.length */
  totalPathCount: number;
  /** Full list of paths from the format; when provided, missingPaths = paths with no record. */
  paths?: string[];
  /** Fingerprints of the coverage artifacts used to build this cache. */
  globalFingerprint?: Record<string, ArtifactFingerprint>;
  /** Whether this cache represents a full project crawl or a partial update. Default: "full" */
  cacheState?: "partial" | "full";
}

/**
 * Build cache payload from resolved coverage records and path count.
 * Aggregate percent is computed from sum(covered) / sum(executable) across all records.
 */
export function buildCoverageCachePayload(
  options: BuildCoverageCachePayloadOptions,
): CoverageCachePayload {
  const {
    workspaceRoot,
    detectedFormat,
    records,
    totalPathCount,
    paths,
    globalFingerprint,
    cacheState,
  } = options;
  const coveredFiles = records.length;
  const missingCoverageFiles = totalPathCount - coveredFiles;
  const recordPathSet = new Set(records.map((r) => path.resolve(r.sourcePath)));
  const missingPaths =
    paths != null
      ? paths.filter((p) => !recordPathSet.has(path.resolve(p)))
      : undefined;
  const files: CoverageCacheFileEntry[] = records.map((r) => ({
    filePath: r.sourcePath,
    lineCoveragePercent: r.lineCoveragePercent,
    coveredLines: r.coveredLines.size,
    uncoveredLines: r.uncoveredLines.size,
    uncoverableLines: r.uncoverableLines.size,
  }));
  let totalExecutable = 0;
  let totalCovered = 0;
  for (const r of records) {
    totalCovered += r.coveredLines.size;
    totalExecutable += r.coveredLines.size + r.uncoveredLines.size;
  }
  const aggregateCoveragePercent =
    totalExecutable > 0
      ? Number(((totalCovered / totalExecutable) * 100).toFixed(2))
      : null;
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
    ...(globalFingerprint != null ? { globalFingerprint } : {}),
    cacheState: cacheState ?? "full",
  };
}

/**
 * Read coverage cache from workspaceRoot/.eyecov/coverage-cache.json.
 * Returns null if file is missing, malformed, or has invalid/unsupported version.
 */
export function readCoverageCache(
  workspaceRoot: string,
): CoverageCacheWritten | null {
  const cachePath = path.join(
    workspaceRoot,
    ".eyecov",
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
  if (obj.version !== 2) {
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
  if (result.cacheState == null) {
    result.cacheState = "full";
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
    ".eyecov",
    COVERAGE_CACHE_FILENAME,
  );
  try {
    fs.unlinkSync(cachePath);
  } catch {
    // ignore (file may not exist)
  }
}
