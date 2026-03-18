import fs from "node:fs";
import path from "node:path";
import type { CoverageFormatType } from "../coverage-config";
import { isCoverageStale } from "../coverage-staleness";
import type { CoverageRecord } from "../coverage-resolver";
import { parseCoveragePyJson } from "../coverage-formats/coveragepy-json";
import {
  readArtifactUtf8WithLimit,
  toCoverageArtifactWarning,
} from "../coverage-formats/artifact-guardrails";
import {
  parseCoberturaXml,
  type CoberturaParseResult,
} from "../coverage-formats/cobertura";
import { parseCloverCoverage } from "../coverage-formats/clover";
import { parseGoCoverprofile } from "../coverage-formats/go-coverprofile";
import {
  istanbulJsonTotals,
  parseIstanbulJson,
} from "../coverage-formats/istanbul-json";
import { parseJaCoCoXml } from "../coverage-formats/jacoco";
import { parseLcov } from "../coverage-formats/lcov";
import { parseOpenCoverXml } from "../coverage-formats/opencover";
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

function rejectedArtifact(
  format: Exclude<CoverageFormatType, "phpunit-html">,
  artifactPath: string,
  workspaceRoot: string,
  warning: string,
): LoadedArtifact {
  return {
    format,
    artifactPath,
    workspaceRoot,
    records: [],
    warnings: [warning],
    reportTotals: null,
    derivedTotals: null,
    hasUnresolvedEntries: false,
  };
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
        warnings.push(
          `Skipped unresolved LCOV source path: ${entry.sourceFile}`,
        );
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

  if (format === "go-coverprofile") {
    const warnings: string[] = [];
    const records: CoverageRecord[] = [];
    let parsed;
    try {
      parsed = parseGoCoverprofile(
        readArtifactUtf8WithLimit(artifactPath, "go coverprofile"),
      );
    } catch (error) {
      return rejectedArtifact(
        format,
        artifactPath,
        workspaceRoot,
        toCoverageArtifactWarning(error, "go coverprofile"),
      );
    }
    let hasUnresolvedEntries = false;

    for (const entry of parsed.files) {
      const resolved = resolveSharedSourcePath(workspaceRoot, entry.sourcePath);
      if (!resolved) {
        warnings.push(
          `Skipped unresolved go-coverprofile source path: ${entry.sourcePath}`,
        );
        hasUnresolvedEntries = true;
        continue;
      }
      if (isCoverageStale(resolved, artifactPath)) {
        warnings.push(`Included stale go-coverprofile record for ${resolved}`);
      }
      records.push(
        createCoverageRecord(
          resolved,
          entry.coveredLines,
          entry.uncoveredLines,
          "go-coverprofile",
        ),
      );
    }

    return {
      format,
      artifactPath,
      workspaceRoot,
      records,
      warnings,
      reportTotals: parsed.totals,
      derivedTotals: parsed.totals,
      hasUnresolvedEntries,
    };
  }

  if (format === "coveragepy-json") {
    const warnings: string[] = [];
    const records: CoverageRecord[] = [];
    const parsed = parseCoveragePyJson(fs.readFileSync(artifactPath, "utf8"));
    let hasUnresolvedEntries = false;

    for (const entry of parsed.files) {
      const resolved = resolveSharedSourcePath(workspaceRoot, entry.sourcePath);
      if (!resolved) {
        warnings.push(
          `Skipped unresolved coverage.py JSON source path: ${entry.sourcePath}`,
        );
        hasUnresolvedEntries = true;
        continue;
      }
      if (isCoverageStale(resolved, artifactPath)) {
        warnings.push(`Included stale coverage.py JSON record for ${resolved}`);
      }
      records.push(
        createCoverageRecord(
          resolved,
          entry.coveredLines,
          entry.uncoveredLines,
          "coveragepy-json",
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
      derivedTotals: buildTotalsFromRecords(parsed.files),
      hasUnresolvedEntries,
    };
  }

  if (format === "istanbul-json") {
    const warnings: string[] = [];
    const records: CoverageRecord[] = [];
    let parsed;
    try {
      parsed = parseIstanbulJson(
        readArtifactUtf8WithLimit(artifactPath, "Istanbul JSON"),
      );
    } catch (error) {
      return rejectedArtifact(
        format,
        artifactPath,
        workspaceRoot,
        toCoverageArtifactWarning(error, "Istanbul JSON"),
      );
    }
    let hasUnresolvedEntries = false;

    for (const entry of parsed.files) {
      const resolved = resolveSharedSourcePath(workspaceRoot, entry.sourcePath);
      if (!resolved) {
        warnings.push(
          `Skipped unresolved Istanbul JSON source path: ${entry.sourcePath}`,
        );
        hasUnresolvedEntries = true;
        continue;
      }
      if (isCoverageStale(resolved, artifactPath)) {
        warnings.push(`Included stale Istanbul JSON record for ${resolved}`);
      }
      records.push(
        createCoverageRecord(
          resolved,
          entry.coveredLines,
          entry.uncoveredLines,
          "istanbul-json",
        ),
      );
    }

    return {
      format,
      artifactPath,
      workspaceRoot,
      records,
      warnings,
      reportTotals: null,
      derivedTotals: istanbulJsonTotals(parsed),
      hasUnresolvedEntries,
    };
  }

  if (format === "jacoco") {
    const warnings: string[] = [];
    const records: CoverageRecord[] = [];
    const parsed = parseJaCoCoXml(fs.readFileSync(artifactPath, "utf8"));
    let hasUnresolvedEntries = false;

    for (const entry of parsed.files) {
      const resolved = resolveSharedSourcePath(workspaceRoot, entry.sourcePath);
      if (!resolved) {
        warnings.push(
          `Skipped unresolved JaCoCo source path: ${entry.sourcePath}`,
        );
        hasUnresolvedEntries = true;
        continue;
      }
      if (isCoverageStale(resolved, artifactPath)) {
        warnings.push(`Included stale JaCoCo record for ${resolved}`);
      }
      records.push(
        createCoverageRecord(
          resolved,
          entry.coveredLines,
          entry.uncoveredLines,
          "jacoco",
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
      derivedTotals: buildTotalsFromRecords(parsed.files),
      hasUnresolvedEntries,
    };
  }

  if (format === "opencover") {
    const warnings: string[] = [];
    const records: CoverageRecord[] = [];
    const parsed = parseOpenCoverXml(fs.readFileSync(artifactPath, "utf8"));
    let hasUnresolvedEntries = false;

    for (const entry of parsed.files) {
      const resolved = resolveSharedSourcePath(workspaceRoot, entry.sourcePath);
      if (!resolved) {
        warnings.push(
          `Skipped unresolved OpenCover source path: ${entry.sourcePath}`,
        );
        hasUnresolvedEntries = true;
        continue;
      }
      if (isCoverageStale(resolved, artifactPath)) {
        warnings.push(`Included stale OpenCover record for ${resolved}`);
      }
      records.push(
        createCoverageRecord(
          resolved,
          entry.coveredLines,
          entry.uncoveredLines,
          "opencover",
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
      derivedTotals: buildTotalsFromRecords(parsed.files),
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
      warnings.push(
        `Skipped unresolved Clover source path: ${entry.sourcePath}`,
      );
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
