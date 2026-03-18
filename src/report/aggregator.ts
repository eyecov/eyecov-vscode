import type { CoverageRecord } from "../coverage-resolver";

export interface ReportSampleFile {
  filePath: string;
  coveredLines: number;
  uncoveredLines: number;
  lineCoveragePercent: number | null;
}

export interface ReportTotals {
  coveredLines: number;
  uncoveredLines: number;
  executableLines: number;
  aggregateCoveragePercent: number | null;
}

export interface AggregatedReport {
  filesDiscovered: number;
  totals: ReportTotals;
  samples: ReportSampleFile[];
}

export function aggregateReportRecords(
  records: CoverageRecord[],
  sampleFiles: number,
): AggregatedReport {
  let coveredLines = 0;
  let uncoveredLines = 0;

  const samples = records
    .map((record) => {
      const covered = record.coveredLines.size;
      const uncovered = record.uncoveredLines.size;
      coveredLines += covered;
      uncoveredLines += uncovered;

      return {
        filePath: record.sourcePath,
        coveredLines: covered,
        uncoveredLines: uncovered,
        lineCoveragePercent: record.lineCoveragePercent,
      };
    })
    .sort((left, right) => {
      const leftPercent = left.lineCoveragePercent ?? 101;
      const rightPercent = right.lineCoveragePercent ?? 101;
      if (leftPercent !== rightPercent) {
        return leftPercent - rightPercent;
      }
      return left.filePath.localeCompare(right.filePath);
    })
    .slice(0, Math.max(0, sampleFiles));

  const executableLines = coveredLines + uncoveredLines;

  return {
    filesDiscovered: records.length,
    totals: {
      coveredLines,
      uncoveredLines,
      executableLines,
      aggregateCoveragePercent:
        executableLines > 0
          ? Number(((coveredLines / executableLines) * 100).toFixed(2))
          : null,
    },
    samples,
  };
}
