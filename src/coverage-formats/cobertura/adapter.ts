/**
 * Cobertura XML coverage adapter.
 *
 * Reads a Cobertura XML artifact under each workspace root, resolves the
 * reported source file paths against the report's <sources> entries and the
 * workspace root, and returns a normalized CoverageRecord.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  AdapterCoverageResult,
  CoverageAdapter,
} from "../../coverage-resolver";
import { isCoverageStale } from "../../coverage-staleness";
import { resolveCoverageSourcePath } from "../xml/shared";
import { parseCoberturaXml, type CoberturaParseResult } from "./parser";

const DEFAULT_COBERTURA_PATH = "coverage/cobertura-coverage.xml";

export interface CoberturaAdapterOptions {
  /** Path to Cobertura XML relative to each workspace root. Default "coverage/cobertura-coverage.xml". */
  path?: string;
}

function readCoberturaReport(fullPath: string): CoberturaParseResult {
  const content = fs.readFileSync(fullPath, "utf8");
  return parseCoberturaXml(content);
}

function getCoberturaCandidatePaths(
  workspaceRoot: string,
  sourceRoots: string[],
  sourcePath: string,
): string[] {
  const candidates = new Set<string>();

  if (path.isAbsolute(sourcePath)) {
    candidates.add(path.normalize(sourcePath));
  }

  for (const sourceRoot of sourceRoots) {
    const resolvedRoot = resolveCoverageSourcePath(workspaceRoot, sourceRoot);
    candidates.add(path.resolve(resolvedRoot, sourcePath));
  }

  candidates.add(resolveCoverageSourcePath(workspaceRoot, sourcePath));
  return [...candidates];
}

function resolveCoberturaSourcePath(
  workspaceRoot: string,
  sourceRoots: string[],
  sourcePath: string,
): string {
  const candidates = getCoberturaCandidatePaths(
    workspaceRoot,
    sourceRoots,
    sourcePath,
  );
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }
  return path.resolve(
    candidates[0] ?? resolveCoverageSourcePath(workspaceRoot, sourcePath),
  );
}

/**
 * List all source file paths that appear in Cobertura XML under the given roots.
 * Used for on-demand path/project aggregation (discovery).
 */
export function listCoberturaSourcePaths(
  workspaceRoots: string[],
  options: CoberturaAdapterOptions = {},
): string[] {
  const coberturaPath = options.path ?? DEFAULT_COBERTURA_PATH;
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const root of workspaceRoots) {
    const fullPath = path.join(root, coberturaPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      continue;
    }
    const report = readCoberturaReport(fullPath);
    for (const file of report.files) {
      const resolved = resolveCoberturaSourcePath(
        root,
        report.sourceRoots,
        file.sourcePath,
      );
      if (seen.has(resolved)) {
        continue;
      }
      seen.add(resolved);
      paths.push(resolved);
    }
  }

  return paths.sort();
}

export class CoberturaAdapter implements CoverageAdapter {
  private readonly coberturaPath: string;

  constructor(options: CoberturaAdapterOptions = {}) {
    this.coberturaPath = options.path ?? DEFAULT_COBERTURA_PATH;
  }

  async getCoverage(
    filePath: string,
    workspaceRoots: string[],
  ): Promise<AdapterCoverageResult> {
    const normalizedPath = path.resolve(filePath);

    for (const root of workspaceRoots) {
      const coberturaPath = path.join(root, this.coberturaPath);
      if (
        !fs.existsSync(coberturaPath) ||
        !fs.statSync(coberturaPath).isFile()
      ) {
        continue;
      }

      const report = readCoberturaReport(coberturaPath);
      for (const file of report.files) {
        const resolvedSourcePath = resolveCoberturaSourcePath(
          root,
          report.sourceRoots,
          file.sourcePath,
        );
        if (resolvedSourcePath !== normalizedPath) {
          continue;
        }

        if (isCoverageStale(normalizedPath, coberturaPath)) {
          return { record: null, rejectReason: "stale" };
        }

        return {
          record: {
            sourcePath: normalizedPath,
            coveredLines: new Set(file.coveredLines),
            uncoveredLines: new Set(file.uncoveredLines),
            uncoverableLines: new Set<number>(),
            lineCoveragePercent:
              file.coveredLines.length + file.uncoveredLines.length > 0
                ? Number(
                    (
                      (file.coveredLines.length /
                        (file.coveredLines.length +
                          file.uncoveredLines.length)) *
                      100
                    ).toFixed(2),
                  )
                : null,
            sourceFormat: "cobertura",
          },
        };
      }
    }

    return { record: null, rejectReason: "no-artifact" };
  }
}
