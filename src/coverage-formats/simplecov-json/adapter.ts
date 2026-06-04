import fs from "node:fs";
import path from "node:path";
import type {
  AdapterCoverageResult,
  CoverageAdapter,
} from "../../coverage-resolver";
import { isCoverageStale } from "../../coverage-staleness";
import { lineCoveragePercent } from "../xml/shared";
import { parseSimpleCovJson } from "./parser";

const DEFAULT_SIMPLECOV_JSON_PATH = "coverage/.resultset.json";

export interface SimpleCovJsonAdapterOptions {
  path?: string;
}

function resolveSimpleCovSourcePath(
  workspaceRoot: string,
  sourcePath: string,
): string {
  return path.isAbsolute(sourcePath)
    ? path.resolve(sourcePath)
    : path.resolve(workspaceRoot, sourcePath);
}

export function listSimpleCovJsonSourcePaths(
  workspaceRoots: string[],
  options: SimpleCovJsonAdapterOptions = {},
): string[] {
  const artifactPath = options.path ?? DEFAULT_SIMPLECOV_JSON_PATH;
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const root of workspaceRoots) {
    const fullPath = path.join(root, artifactPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      continue;
    }

    const parsed = parseSimpleCovJson(fs.readFileSync(fullPath, "utf8"));
    for (const record of parsed.files) {
      const resolved = resolveSimpleCovSourcePath(root, record.sourcePath);
      if (seen.has(resolved)) {
        continue;
      }
      seen.add(resolved);
      paths.push(resolved);
    }
  }

  return paths.sort();
}

export class SimpleCovJsonAdapter implements CoverageAdapter {
  private readonly artifactPath: string;

  constructor(options: SimpleCovJsonAdapterOptions = {}) {
    this.artifactPath = options.path ?? DEFAULT_SIMPLECOV_JSON_PATH;
  }

  async getCoverage(
    filePath: string,
    workspaceRoots: string[],
  ): Promise<AdapterCoverageResult> {
    const normalizedPath = path.resolve(filePath);

    for (const root of workspaceRoots) {
      const artifactPath = path.join(root, this.artifactPath);
      if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
        continue;
      }

      const parsed = parseSimpleCovJson(fs.readFileSync(artifactPath, "utf8"));
      for (const record of parsed.files) {
        if (
          resolveSimpleCovSourcePath(root, record.sourcePath) !== normalizedPath
        ) {
          continue;
        }

        if (isCoverageStale(normalizedPath, artifactPath)) {
          return { record: null, rejectReason: "stale" };
        }

        return {
          record: {
            sourcePath: normalizedPath,
            coveredLines: new Set(record.coveredLines),
            uncoveredLines: new Set(record.uncoveredLines),
            uncoverableLines: new Set<number>(),
            lineCoveragePercent: lineCoveragePercent(
              record.coveredLines.length,
              record.uncoveredLines.length,
            ),
            sourceFormat: "simplecov-json",
          },
        };
      }
    }

    return { record: null, rejectReason: "no-artifact" };
  }
}
