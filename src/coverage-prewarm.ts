/**
 * Background prewarm: build coverage cache for a workspace root in chunks,
 * yielding to the event loop between batches. Used when eyecov.prewarmCoverageCache is true.
 */

import fs from "node:fs";
import path from "node:path";
import type { CoverageRecord } from "./coverage-resolver";
import {
  ArtifactFingerprint,
  buildCoverageCachePayload,
  readCoverageCache,
  writeCoverageCache,
} from "./coverage-cache";

export interface PrewarmCoverageForRootOptions {
  /** Returns paths to resolve and the detected format type. */
  listPaths: () => { paths: string[]; formatType: string };
  getCoverage: (path: string) => Promise<CoverageRecord | null>;
  /** Artifact paths to stat for fingerprinting. */
  artifactPaths?: string[];
  /** Batch size for getCoverage calls before yielding (default 20). */
  batchSize?: number;
  /** When aborted, prewarm stops and does not write cache. */
  signal?: AbortSignal;
  /** Callback to log messages (optional). */
  log?: (message: string) => void;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function getGlobalFingerprint(
  artifactPaths: string[],
): Record<string, ArtifactFingerprint> {
  const fingerprint: Record<string, ArtifactFingerprint> = {};
  for (const p of artifactPaths) {
    try {
      if (fs.existsSync(p)) {
        const stats = fs.statSync(p);
        fingerprint[p] = {
          mtime: stats.mtimeMs,
          size: stats.size,
        };
      }
    } catch {
      // ignore stat failures
    }
  }
  return fingerprint;
}

function fingerprintsMatch(
  a: Record<string, ArtifactFingerprint>,
  b: Record<string, ArtifactFingerprint>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (!b[key] || a[key].mtime !== b[key].mtime || a[key].size !== b[key].size) {
      return false;
    }
  }
  return true;
}

/**
 * Prewarm coverage cache for one workspace root: list paths, resolve coverage in batches,
 * then write .eyecov/coverage-cache.json. Yields between batches so the UI stays responsive.
 * If signal is aborted, exits without writing.
 */
export async function prewarmCoverageForRoot(
  workspaceRoot: string,
  options: PrewarmCoverageForRootOptions,
): Promise<void> {
  const {
    listPaths,
    getCoverage,
    signal,
    batchSize = 20,
    artifactPaths = [],
    log,
  } = options;

  // Phase 1: Global Fingerprinting + Skip
  const currentFingerprint = getGlobalFingerprint(artifactPaths);
  const existingCache = readCoverageCache(workspaceRoot);
  if (
    existingCache &&
    existingCache.globalFingerprint &&
    fingerprintsMatch(currentFingerprint, existingCache.globalFingerprint)
  ) {
    log?.(`[prewarm] skip: fingerprints match existing cache for ${workspaceRoot}`);
    return;
  }

  const { paths, formatType } = listPaths();
  const records: CoverageRecord[] = [];

  for (let i = 0; i < paths.length; i += batchSize) {
    if (signal?.aborted) {
      return;
    }
    const batch = paths.slice(i, i + batchSize);
    for (const p of batch) {
      const record = await getCoverage(p);
      if (record) {
        records.push(record);
      }
    }
    await yieldToEventLoop();
  }

  if (signal?.aborted) {
    return;
  }

  const payload = buildCoverageCachePayload({
    workspaceRoot,
    detectedFormat: formatType,
    records,
    totalPathCount: paths.length,
    paths,
    globalFingerprint: currentFingerprint,
    cacheState: "full",
  });
  writeCoverageCache(workspaceRoot, payload);
}
