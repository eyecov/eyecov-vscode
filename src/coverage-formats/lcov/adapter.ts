/**
 * LCOV coverage adapter. Reads lcov.info under workspace roots
 * and returns a CoverageRecord when the file appears in the report.
 * Path is configurable (e.g. coverage/lcov.info).
 */

import fs from "node:fs";
import path from "node:path";
import type {
  AdapterCoverageResult,
  CoverageAdapter,
} from "../../coverage-resolver";
import { isCoverageStale } from "../../coverage-staleness";
import { parseLcov, lineCoveragePercent } from "./parser";

const DEFAULT_LCOV_PATH = "coverage/lcov.info";

/**
 * List all source file paths that appear in lcov.info under the given roots.
 * Used for on-demand path/project aggregation (discovery).
 */
export function listLcovSourcePaths(
  workspaceRoots: string[],
  options: LcovAdapterOptions = {},
): string[] {
  const lcovPath = options.path ?? DEFAULT_LCOV_PATH;
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const root of workspaceRoots) {
    const fullPath = path.join(root, lcovPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
    const content = fs.readFileSync(fullPath, "utf8");
    const records = parseLcov(content);
    for (const rec of records) {
      const resolved = path.resolve(root, rec.sourceFile);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      paths.push(resolved);
    }
  }
  return paths.sort();
}

export interface LcovAdapterOptions {
  /** Path to lcov.info relative to each workspace root. Default "coverage/lcov.info". */
  path?: string;
}

export class LcovAdapter implements CoverageAdapter {
  private readonly lcovPath: string;

  constructor(options: LcovAdapterOptions = {}) {
    this.lcovPath = options.path ?? DEFAULT_LCOV_PATH;
  }

  async getCoverage(
    filePath: string,
    workspaceRoots: string[],
  ): Promise<AdapterCoverageResult> {
    const normalizedPath = path.resolve(filePath);
    for (const root of workspaceRoots) {
      const lcovPath = path.join(root, this.lcovPath);
      if (!fs.existsSync(lcovPath) || !fs.statSync(lcovPath).isFile()) {
        continue;
      }
      const content = fs.readFileSync(lcovPath, "utf8");
      const records = parseLcov(content);
      for (const rec of records) {
        const resolved = path.resolve(root, rec.sourceFile);
        if (resolved === normalizedPath) {
          if (isCoverageStale(normalizedPath, lcovPath)) {
            return { record: null, rejectReason: "stale" };
          }
          const coveredSet = new Set(rec.coveredLines);
          const uncoveredSet = new Set(rec.uncoveredLines);
          const percent = lineCoveragePercent(
            rec.coveredLines.length,
            rec.uncoveredLines.length,
          );
          return {
            record: {
              sourcePath: normalizedPath,
              coveredLines: coveredSet,
              uncoveredLines: uncoveredSet,
              uncoverableLines: new Set<number>(),
              lineCoveragePercent: percent,
              sourceFormat: "lcov",
            },
          };
        }
      }
    }
    return { record: null, rejectReason: "no-artifact" };
  }
}
