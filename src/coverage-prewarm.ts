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
  /** Paths to prioritize (move to the front of the queue). */
  priorityPaths?: string[];
  /** Batch size for getCoverage calls before yielding (default 20). */
  batchSize?: number;
  /** When aborted, prewarm stops and does not write cache. */
  signal?: AbortSignal;
  /** Callback to log messages (optional). */
  log?: (message: string) => void;
  /** Callback for progress updates (current, total). */
  onProgress?: (current: number, total: number) => void;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function processPathsInBatches(
  paths: string[],
  getCoverage: (path: string) => Promise<CoverageRecord | null>,
  records: CoverageRecord[],
  batchSize: number,
  signal: AbortSignal | undefined,
  onProgress: ((current: number, total: number) => void) | undefined,
  progressStart: number,
  progressTotal: number,
): Promise<number> {
  let processed = progressStart;

  for (let i = 0; i < paths.length; i += batchSize) {
    if (signal?.aborted) {
      return processed;
    }
    const batch = paths.slice(i, i + batchSize);
    for (const p of batch) {
      const record = await getCoverage(p);
      if (record) {
        records.push(record);
      }
    }
    processed += batch.length;
    onProgress?.(processed, progressTotal);
    await yieldToEventLoop();
  }

  return processed;
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
    if (
      !b[key] ||
      a[key].mtime !== b[key].mtime ||
      a[key].size !== b[key].size
    ) {
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
    priorityPaths = [],
    log,
    onProgress,
  } = options;

  // Phase 1: Global Fingerprinting + Skip
  const currentFingerprint = getGlobalFingerprint(artifactPaths);
  const existingCache = readCoverageCache(workspaceRoot);
  if (
    existingCache &&
    existingCache.globalFingerprint &&
    fingerprintsMatch(currentFingerprint, existingCache.globalFingerprint)
  ) {
    log?.(
      `[prewarm] skip: fingerprints match existing cache for ${workspaceRoot}`,
    );
    return;
  }

  const { paths: allPaths, formatType } = listPaths();
  if (allPaths.length === 0) {
    log?.(`[prewarm] skip: no coverage paths found for ${workspaceRoot}`);
    onProgress?.(0, 0);
    return;
  }

  // Phase 2: Path Prioritization
  const allPathsByResolved = new Map(
    allPaths.map((p) => [path.resolve(p), p] as const),
  );
  const prioritySet = new Set(priorityPaths.map((p) => path.resolve(p)));
  const prioritized: string[] = [];
  for (const p of priorityPaths) {
    const matched = allPathsByResolved.get(path.resolve(p));
    if (matched && !prioritized.includes(matched)) {
      prioritized.push(matched);
    }
  }
  const remaining = allPaths.filter((p) => !prioritySet.has(path.resolve(p)));

  const records: CoverageRecord[] = [];
  const total = allPaths.length;
  onProgress?.(0, total);

  let processed = 0;
  processed = await processPathsInBatches(
    prioritized,
    getCoverage,
    records,
    batchSize,
    signal,
    onProgress,
    processed,
    total,
  );

  if (signal?.aborted) {
    return;
  }

  if (prioritized.length > 0 && remaining.length > 0) {
    const partialPayload = buildCoverageCachePayload({
      workspaceRoot,
      detectedFormat: formatType,
      records,
      totalPathCount: prioritized.length,
      paths: prioritized,
      globalFingerprint: currentFingerprint,
      cacheState: "partial",
    });
    writeCoverageCache(workspaceRoot, partialPayload);
    log?.(
      `[prewarm] wrote partial cache for ${workspaceRoot} (${prioritized.length}/${total} path(s))`,
    );
  }

  await processPathsInBatches(
    remaining,
    getCoverage,
    records,
    batchSize,
    signal,
    onProgress,
    processed,
    total,
  );

  if (signal?.aborted) {
    return;
  }

  const payload = buildCoverageCachePayload({
    workspaceRoot,
    detectedFormat: formatType,
    records,
    totalPathCount: allPaths.length,
    paths: allPaths,
    globalFingerprint: currentFingerprint,
    cacheState: "full",
  });
  writeCoverageCache(workspaceRoot, payload);
}
