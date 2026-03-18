import path from "node:path";
import type { CoverageFormatType } from "../coverage-config";
import type { CoverageRecord } from "../coverage-resolver";
import { loadPhpUnitHtmlArtifact } from "./phpunit-html-loader";
import { loadSharedArtifact } from "./loader-shared";

export interface ReportTotalsMetadata {
  coveredLines: number;
  executableLines: number;
  aggregateCoveragePercent: number | null;
}

export interface LoadedArtifact {
  format: CoverageFormatType;
  artifactPath: string;
  workspaceRoot: string;
  records: CoverageRecord[];
  warnings: string[];
  reportTotals: ReportTotalsMetadata | null;
  derivedTotals: ReportTotalsMetadata | null;
  hasUnresolvedEntries: boolean;
}

export interface LoadCoverageArtifactOptions {
  format: CoverageFormatType;
  artifactPath: string;
  workspaceRoot: string;
}

export async function loadCoverageArtifact(
  options: LoadCoverageArtifactOptions,
): Promise<LoadedArtifact> {
  const artifactPath = path.resolve(options.artifactPath);
  const workspaceRoot = path.resolve(options.workspaceRoot);

  if (options.format === "phpunit-html") {
    return loadPhpUnitHtmlArtifact(artifactPath, workspaceRoot);
  }

  return loadSharedArtifact(options.format, artifactPath, workspaceRoot);
}
