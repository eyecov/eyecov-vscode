/**
 * Staleness check: reject coverage when the source file is newer than the
 * coverage artifact. Used by adapters before returning a CoverageRecord.
 */

import fs from "node:fs";

/**
 * Returns true if coverage should be rejected (stale or unreadable).
 * True when: source file is newer than artifact, or either path cannot be statted.
 * False when: source mtime <= artifact mtime (coverage is fresh).
 */
export function isCoverageStale(
  sourcePath: string,
  artifactPath: string,
): boolean {
  try {
    const sourceStat = fs.statSync(sourcePath);
    const artifactStat = fs.statSync(artifactPath);
    return sourceStat.mtimeMs > artifactStat.mtimeMs;
  } catch {
    return true;
  }
}
