import fs from "node:fs";
import path from "node:path";
import type {
  AdapterCoverageResult,
  CoverageAdapter,
} from "../../coverage-resolver";
import { isCoverageStale } from "../../coverage-staleness";
import { lineCoveragePercent } from "../xml/shared";
import { parseOpenCoverXml } from "./parser";

export interface OpenCoverAdapterOptions {
  path?: string;
}

export function listOpenCoverSourcePaths(
  workspaceRoots: string[],
  options: OpenCoverAdapterOptions = {},
): string[] {
  const artifactPath = options.path ?? "";
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const root of workspaceRoots) {
    if (!artifactPath) {
      continue;
    }
    const fullPath = path.join(root, artifactPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      continue;
    }
    const parsed = parseOpenCoverXml(fs.readFileSync(fullPath, "utf8"));
    for (const record of parsed.files) {
      const resolved = path.isAbsolute(record.sourcePath)
        ? path.normalize(record.sourcePath)
        : path.resolve(root, record.sourcePath);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      paths.push(resolved);
    }
  }

  return paths.sort();
}

export class OpenCoverAdapter implements CoverageAdapter {
  private readonly artifactPath: string;

  constructor(options: OpenCoverAdapterOptions = {}) {
    this.artifactPath = options.path ?? "";
  }

  async getCoverage(
    filePath: string,
    workspaceRoots: string[],
  ): Promise<AdapterCoverageResult> {
    if (!this.artifactPath) {
      return { record: null, rejectReason: "no-artifact" };
    }
    const normalizedPath = path.resolve(filePath);
    for (const root of workspaceRoots) {
      const artifactPath = path.join(root, this.artifactPath);
      if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
        continue;
      }
      const parsed = parseOpenCoverXml(fs.readFileSync(artifactPath, "utf8"));
      for (const record of parsed.files) {
        const resolved = path.isAbsolute(record.sourcePath)
          ? path.normalize(record.sourcePath)
          : path.resolve(root, record.sourcePath);
        if (resolved !== normalizedPath) {
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
            sourceFormat: "opencover",
          },
        };
      }
    }

    return { record: null, rejectReason: "no-artifact" };
  }
}
