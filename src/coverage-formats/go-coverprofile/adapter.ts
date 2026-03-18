import fs from "node:fs";
import path from "node:path";
import type {
  AdapterCoverageResult,
  CoverageAdapter,
} from "../../coverage-resolver";
import { isCoverageStale } from "../../coverage-staleness";
import { lineCoveragePercent } from "../xml/shared";
import { readArtifactUtf8WithLimit } from "../artifact-guardrails";
import { parseGoCoverprofile } from "./parser";

const DEFAULT_GO_COVERPROFILE_PATH = "coverage.out";

export interface GoCoverprofileAdapterOptions {
  path?: string;
}

export function listGoCoverprofileSourcePaths(
  workspaceRoots: string[],
  options: GoCoverprofileAdapterOptions = {},
): string[] {
  const artifactPath = options.path ?? DEFAULT_GO_COVERPROFILE_PATH;
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const root of workspaceRoots) {
    const fullPath = path.join(root, artifactPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      continue;
    }
    let parsed;
    try {
      parsed = parseGoCoverprofile(
        readArtifactUtf8WithLimit(fullPath, "go coverprofile"),
      );
    } catch {
      continue;
    }
    for (const record of parsed.files) {
      const resolved = path.resolve(root, record.sourcePath);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      paths.push(resolved);
    }
  }

  return paths.sort();
}

export class GoCoverprofileAdapter implements CoverageAdapter {
  private readonly artifactPath: string;

  constructor(options: GoCoverprofileAdapterOptions = {}) {
    this.artifactPath = options.path ?? DEFAULT_GO_COVERPROFILE_PATH;
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
      let parsed;
      try {
        parsed = parseGoCoverprofile(
          readArtifactUtf8WithLimit(artifactPath, "go coverprofile"),
        );
      } catch {
        return {
          record: null,
          rejectReason: "no-artifact",
        };
      }
      for (const record of parsed.files) {
        if (path.resolve(root, record.sourcePath) !== normalizedPath) {
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
            sourceFormat: "go-coverprofile",
          },
        };
      }
    }

    return { record: null, rejectReason: "no-artifact" };
  }
}
