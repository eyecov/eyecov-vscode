/**
 * Background prewarm: build coverage cache for a workspace root in chunks,
 * yielding to the event loop between batches. Used when eyecov.prewarmCoverageCache is true.
 */

import type { CoverageRecord } from "./coverage-resolver";
import {
  buildCoverageCachePayload,
  writeCoverageCache,
} from "./coverage-cache";

export interface PrewarmCoverageForRootOptions {
  /** Returns paths to resolve and the detected format type. */
  listPaths: () => { paths: string[]; formatType: string };
  getCoverage: (path: string) => Promise<CoverageRecord | null>;
  /** Batch size for getCoverage calls before yielding (default 20). */
  batchSize?: number;
  /** When aborted, prewarm stops and does not write cache. */
  signal?: AbortSignal;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
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
  const { listPaths, getCoverage, signal, batchSize = 20 } = options;
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
  });
  writeCoverageCache(workspaceRoot, payload);
}
