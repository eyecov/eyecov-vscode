/**
 * Clover coverage adapter. Reads Clover XML under workspace roots and returns
 * a normalized coverage record for a requested source file.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  AdapterCoverageResult,
  CoverageAdapter,
} from "../../coverage-resolver";
import { isCoverageStale } from "../../coverage-staleness";
import {
  getSharedArtifactPaths,
  normalizeLineCoverage,
  resolveCoverageSourcePath,
} from "../xml/shared";
import { parseCloverCoverage } from "./parser";

const DEFAULT_CLOVER_PATH = "coverage/clover.xml";

export interface CloverAdapterOptions {
  /** Path to clover.xml relative to each workspace root. Default "coverage/clover.xml". */
  path?: string;
}

export function listCloverSourcePaths(
  workspaceRoots: string[],
  options: CloverAdapterOptions = {},
): string[] {
  const artifactPath = options.path ?? DEFAULT_CLOVER_PATH;
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const [index, cloverPath] of getSharedArtifactPaths(
    workspaceRoots,
    artifactPath,
  ).entries()) {
    const rootPath = workspaceRoots[index];
    if (!rootPath) continue;
    const root = path.resolve(rootPath);
    if (!fs.existsSync(cloverPath) || !fs.statSync(cloverPath).isFile()) {
      continue;
    }
    const content = fs.readFileSync(cloverPath, "utf8");
    for (const rec of parseCloverCoverage(content).files) {
      const resolved = resolveCoverageSourcePath(root, rec.sourcePath);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      paths.push(resolved);
    }
  }

  return paths.sort();
}

export class CloverAdapter implements CoverageAdapter {
  private readonly cloverPath: string;

  constructor(options: CloverAdapterOptions = {}) {
    this.cloverPath = options.path ?? DEFAULT_CLOVER_PATH;
  }

  async getCoverage(
    filePath: string,
    workspaceRoots: string[],
  ): Promise<AdapterCoverageResult> {
    const normalizedPath = path.resolve(filePath);
    for (const root of workspaceRoots) {
      const cloverPath = path.join(root, this.cloverPath);
      if (!fs.existsSync(cloverPath) || !fs.statSync(cloverPath).isFile()) {
        continue;
      }
      const content = fs.readFileSync(cloverPath, "utf8");
      const records = parseCloverCoverage(content).files;
      for (const rec of records) {
        const resolved = resolveCoverageSourcePath(root, rec.sourcePath);
        if (resolved !== normalizedPath) continue;
        if (isCoverageStale(normalizedPath, cloverPath)) {
          return { record: null, rejectReason: "stale" };
        }
        const normalized = normalizeLineCoverage({
          coveredLines: rec.coveredLines,
          uncoveredLines: rec.uncoveredLines,
        });
        return {
          record: {
            sourcePath: normalizedPath,
            coveredLines: new Set(normalized.coveredLines),
            uncoveredLines: new Set(normalized.uncoveredLines),
            uncoverableLines: new Set<number>(),
            lineCoveragePercent: normalized.lineCoveragePercent,
            sourceFormat: "clover",
          },
        };
      }
    }
    return { record: null, rejectReason: "no-artifact" };
  }
}
