/**
 * Fixture coverage adapter (test-only). Reads a JSON fixture file per workspace root
 * and returns CoverageRecord when the requested file matches an entry.
 */

import fs from "node:fs";
import path from "node:path";
import type { CoverageAdapter, CoverageRecord } from "../../coverage-resolver";
import { parseFixtureCoverage } from "./parser";

export interface FixtureAdapterOptions {
  /** Path to fixture JSON relative to each workspace root. */
  path: string;
  /** If false, run staleness check (source vs artifact mtime). Default true for tests. */
  skipStalenessCheck?: boolean;
}

export class FixtureAdapter implements CoverageAdapter {
  private readonly fixturePath: string;
  private readonly skipStalenessCheck: boolean;

  constructor(options: FixtureAdapterOptions) {
    this.fixturePath = options.path;
    this.skipStalenessCheck = options.skipStalenessCheck ?? true;
  }

  async getCoverage(
    filePath: string,
    workspaceRoots: string[],
  ): Promise<CoverageRecord | null> {
    const normalizedPath = path.resolve(filePath);
    for (const root of workspaceRoots) {
      const fullFixturePath = path.join(root, this.fixturePath);
      if (
        !fs.existsSync(fullFixturePath) ||
        !fs.statSync(fullFixturePath).isFile()
      ) {
        continue;
      }
      const content = fs.readFileSync(fullFixturePath, "utf8");
      const entries = parseFixtureCoverage(content);
      for (const entry of entries) {
        const resolvedSource = path.resolve(root, entry.sourcePath);
        if (resolvedSource === normalizedPath) {
          return {
            sourcePath: normalizedPath,
            coveredLines: new Set(entry.coveredLines),
            uncoveredLines: new Set(entry.uncoveredLines),
            uncoverableLines: new Set(entry.uncoverableLines ?? []),
            lineCoveragePercent: entry.lineCoveragePercent ?? null,
          };
        }
      }
    }
    return null;
  }
}
