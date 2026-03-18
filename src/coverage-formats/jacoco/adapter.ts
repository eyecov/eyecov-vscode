import fs from "node:fs";
import path from "node:path";
import type {
  AdapterCoverageResult,
  CoverageAdapter,
} from "../../coverage-resolver";
import { isCoverageStale } from "../../coverage-staleness";
import { lineCoveragePercent } from "../xml/shared";
import { parseJaCoCoXml } from "./parser";

const DEFAULT_JACOCO_PATH = "target/site/jacoco/jacoco.xml";

export interface JacocoAdapterOptions {
  path?: string;
}

function resolveJacocoSourcePath(
  workspaceRoot: string,
  sourcePath: string,
): string {
  return path.resolve(workspaceRoot, sourcePath);
}

export function listJacocoSourcePaths(
  workspaceRoots: string[],
  options: JacocoAdapterOptions = {},
): string[] {
  const artifactPath = options.path ?? DEFAULT_JACOCO_PATH;
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const root of workspaceRoots) {
    const fullPath = path.join(root, artifactPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      continue;
    }
    const parsed = parseJaCoCoXml(fs.readFileSync(fullPath, "utf8"));
    for (const record of parsed.files) {
      const resolved = resolveJacocoSourcePath(root, record.sourcePath);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      paths.push(resolved);
    }
  }

  return paths.sort();
}

export class JacocoAdapter implements CoverageAdapter {
  private readonly artifactPath: string;

  constructor(options: JacocoAdapterOptions = {}) {
    this.artifactPath = options.path ?? DEFAULT_JACOCO_PATH;
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
      const parsed = parseJaCoCoXml(fs.readFileSync(artifactPath, "utf8"));
      for (const record of parsed.files) {
        if (
          resolveJacocoSourcePath(root, record.sourcePath) !== normalizedPath
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
            sourceFormat: "jacoco",
          },
        };
      }
    }

    return { record: null, rejectReason: "no-artifact" };
  }
}
