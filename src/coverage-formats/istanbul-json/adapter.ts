import fs from "node:fs";
import path from "node:path";
import type {
  AdapterCoverageResult,
  CoverageAdapter,
} from "../../coverage-resolver";
import { isCoverageStale } from "../../coverage-staleness";
import { lineCoveragePercent } from "../xml/shared";
import { readArtifactUtf8WithLimit } from "../artifact-guardrails";
import { parseIstanbulJson } from "./parser";

const DEFAULT_ISTANBUL_JSON_PATH = "coverage/coverage-final.json";

export interface IstanbulJsonAdapterOptions {
  path?: string;
}

export function listIstanbulJsonSourcePaths(
  workspaceRoots: string[],
  options: IstanbulJsonAdapterOptions = {},
): string[] {
  const artifactPath = options.path ?? DEFAULT_ISTANBUL_JSON_PATH;
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const root of workspaceRoots) {
    const fullPath = path.join(root, artifactPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      continue;
    }
    let parsed;
    try {
      parsed = parseIstanbulJson(
        readArtifactUtf8WithLimit(fullPath, "Istanbul JSON"),
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

export class IstanbulJsonAdapter implements CoverageAdapter {
  private readonly artifactPath: string;

  constructor(options: IstanbulJsonAdapterOptions = {}) {
    this.artifactPath = options.path ?? DEFAULT_ISTANBUL_JSON_PATH;
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
        parsed = parseIstanbulJson(
          readArtifactUtf8WithLimit(artifactPath, "Istanbul JSON"),
        );
      } catch {
        return { record: null, rejectReason: "no-artifact" };
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
            sourceFormat: "istanbul-json",
          },
        };
      }
    }

    return { record: null, rejectReason: "no-artifact" };
  }
}
