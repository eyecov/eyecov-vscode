import fs from "node:fs";
import path from "node:path";
import type { CoverageFormatType } from "../coverage-config";
import { isCoverageStale } from "../coverage-staleness";
import type { CoverageRecord } from "../coverage-resolver";
import {
  parseCoberturaXml,
  type CoberturaParseResult,
} from "../coverage-formats/cobertura";
import { parseCloverCoverage } from "../coverage-formats/clover";
import { parseLcov } from "../coverage-formats/lcov";
import {
  lineCoveragePercent,
  resolveCoverageSourcePath,
} from "../coverage-formats/xml/shared";
import type { LoadedArtifact, ReportTotalsMetadata } from "./artifact-loader";

function createCoverageRecord(
  sourcePath: string,
  coveredLines: number[],
  uncoveredLines: number[],
  sourceFormat: CoverageFormatType,
): CoverageRecord {
  return {
    sourcePath,
    coveredLines: new Set(coveredLines),
    uncoveredLines: new Set(uncoveredLines),
    uncoverableLines: new Set<number>(),
    lineCoveragePercent: lineCoveragePercent(
      coveredLines.length,
      uncoveredLines.length,
    ),
    sourceFormat,
  };
}

function buildTotalsFromRecords(
  records: Array<{ coveredLines: number[]; uncoveredLines: number[] }>,
): ReportTotalsMetadata {
  let coveredLines = 0;
  let uncoveredLines = 0;
  for (const record of records) {
    coveredLines += record.coveredLines.length;
    uncoveredLines += record.uncoveredLines.length;
  }

  const executableLines = coveredLines + uncoveredLines;
  return {
    coveredLines,
    executableLines,
    aggregateCoveragePercent: lineCoveragePercent(coveredLines, uncoveredLines),
  };
}

function toMetadataOrNull(totals: {
  coveredLines: number | null;
  executableLines: number | null;
  aggregateCoveragePercent: number | null;
}): ReportTotalsMetadata | null {
  if (totals.coveredLines === null || totals.executableLines === null) {
    return null;
  }

  return {
    coveredLines: totals.coveredLines,
    executableLines: totals.executableLines,
    aggregateCoveragePercent: totals.aggregateCoveragePercent,
  };
}

function resolveCoberturaSourcePath(
  workspaceRoot: string,
  report: CoberturaParseResult,
  sourcePath: string,
): string | null {
  const candidates = new Set<string>();
  if (path.isAbsolute(sourcePath)) {
    candidates.add(path.normalize(sourcePath));
  }
  for (const root of report.sourceRoots) {
    candidates.add(
      path.resolve(resolveCoverageSourcePath(workspaceRoot, root), sourcePath),
    );
  }
  candidates.add(resolveCoverageSourcePath(workspaceRoot, sourcePath));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }

  return null;
}

function resolveSharedSourcePath(
  workspaceRoot: string,
  sourcePath: string,
): string | null {
  const resolved = resolveCoverageSourcePath(workspaceRoot, sourcePath);
  return fs.existsSync(resolved) ? path.resolve(resolved) : null;
}

export async function loadSharedArtifact(
  format: Exclude<CoverageFormatType, "phpunit-html">,
  artifactPath: string,
  workspaceRoot: string,
): Promise<LoadedArtifact> {
  if (format === "lcov") {
    const warnings: string[] = [];
    const records: CoverageRecord[] = [];
    const parsed = parseLcov(fs.readFileSync(artifactPath, "utf8"));
    let hasUnresolvedEntries = false;

    for (const entry of parsed) {
      const resolved = resolveSharedSourcePath(workspaceRoot, entry.sourceFile);
      if (!resolved) {
        warnings.push(`Skipped unresolved LCOV source path: ${entry.sourceFile}`);
        hasUnresolvedEntries = true;
        continue;
      }
      if (isCoverageStale(resolved, artifactPath)) {
        warnings.push(`Included stale LCOV record for ${resolved}`);
      }
      records.push(
        createCoverageRecord(
          resolved,
          entry.coveredLines,
          entry.uncoveredLines,
          "lcov",
        ),
      );
    }

    return {
      format,
      artifactPath,
      workspaceRoot,
      records,
      warnings,
      reportTotals: buildTotalsFromRecords(parsed),
      derivedTotals: buildTotalsFromRecords(parsed),
      hasUnresolvedEntries,
    };
  }

  if (format === "cobertura") {
    const warnings: string[] = [];
    const records: CoverageRecord[] = [];
    const parsed = parseCoberturaXml(fs.readFileSync(artifactPath, "utf8"));
    const derivedTotals = buildTotalsFromRecords(parsed.files);
    let hasUnresolvedEntries = false;

    for (const entry of parsed.files) {
      const resolved = resolveCoberturaSourcePath(
        workspaceRoot,
        parsed,
        entry.sourcePath,
      );
      if (!resolved) {
        warnings.push(
          `Skipped unresolved Cobertura source path: ${entry.sourcePath}`,
        );
        hasUnresolvedEntries = true;
        continue;
      }
      if (isCoverageStale(resolved, artifactPath)) {
        warnings.push(`Included stale Cobertura record for ${resolved}`);
      }
      records.push(
        createCoverageRecord(
          resolved,
          entry.coveredLines,
          entry.uncoveredLines,
          "cobertura",
        ),
      );
    }

    return {
      format,
      artifactPath,
      workspaceRoot,
      records,
      warnings,
      reportTotals: toMetadataOrNull(parsed.totals),
      derivedTotals,
      hasUnresolvedEntries,
    };
  }

  const warnings: string[] = [];
  const records: CoverageRecord[] = [];
  const parsed = parseCloverCoverage(fs.readFileSync(artifactPath, "utf8"));
  const derivedTotals = buildTotalsFromRecords(parsed.files);
  let hasUnresolvedEntries = false;

  for (const entry of parsed.files) {
    const resolved = resolveSharedSourcePath(workspaceRoot, entry.sourcePath);
    if (!resolved) {
      warnings.push(`Skipped unresolved Clover source path: ${entry.sourcePath}`);
      hasUnresolvedEntries = true;
      continue;
    }
    if (isCoverageStale(resolved, artifactPath)) {
      warnings.push(`Included stale Clover record for ${resolved}`);
    }
    records.push(
      createCoverageRecord(
        resolved,
        entry.coveredLines,
        entry.uncoveredLines,
        "clover",
      ),
    );
  }

  return {
    format,
    artifactPath,
    workspaceRoot,
    records,
    warnings,
    reportTotals: toMetadataOrNull(parsed.totals),
    derivedTotals,
    hasUnresolvedEntries,
  };
}
