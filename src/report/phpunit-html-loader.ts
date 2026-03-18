import path from "node:path";
import { isCoverageStale } from "../coverage-staleness";
import type { CoverageRecord } from "../coverage-resolver";
import {
  buildCoverageFileResult,
  listCoverageHtmlSourcePaths,
  resolveCoverageHtmlPath,
} from "../coverage-formats/phpunit-html";
import type { LoadedArtifact } from "./artifact-loader";

export async function loadPhpUnitHtmlArtifact(
  artifactPath: string,
  workspaceRoot: string,
): Promise<LoadedArtifact> {
  const warnings: string[] = [];
  const records: CoverageRecord[] = [];
  const coverageHtmlDir = path.relative(workspaceRoot, artifactPath);
  const sourcePaths = listCoverageHtmlSourcePaths([workspaceRoot], {
    coverageHtmlDir,
  });

  for (const sourcePath of sourcePaths) {
    const coverageHtmlPath = resolveCoverageHtmlPath(sourcePath, [workspaceRoot], {
      coverageHtmlDir,
    });
    if (!coverageHtmlPath) {
      warnings.push(
        `Skipped unresolved PHPUnit HTML source path: ${sourcePath}`,
      );
      continue;
    }
    if (isCoverageStale(sourcePath, coverageHtmlPath)) {
      warnings.push(`Included stale PHPUnit HTML record for ${sourcePath}`);
    }

    const result = buildCoverageFileResult(sourcePath, coverageHtmlPath);
    records.push({
      sourcePath,
      coveredLines: new Set(result.coveredLineNumbers),
      uncoveredLines: new Set(result.uncoveredLineNumbers),
      uncoverableLines: new Set(result.uncoverableLines ?? []),
      lineCoveragePercent: result.lineCoveragePercent,
      sourceFormat: "phpunit-html",
      coverageHtmlPath: result.coverageHtmlPath,
      testsByLine: result.testsByLine,
      lineStatuses: result.lineStatuses,
    });
  }

  return {
    format: "phpunit-html",
    artifactPath,
    workspaceRoot,
    records,
    warnings,
    reportTotals: null,
    derivedTotals: null,
    hasUnresolvedEntries: false,
  };
}
