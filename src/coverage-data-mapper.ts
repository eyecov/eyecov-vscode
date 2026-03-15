/**
 * Maps CoverageRecord to CoverageData for the editor.
 * Extracted so recordToCoverageData can be unit tested.
 */

import type { CoverageRecord } from "./coverage-resolver";
import type { CoverageData } from "./coverage-types";
import { LINE_STATUS } from "./coverage-types";

export function recordToCoverageData(record: CoverageRecord): CoverageData {
  const totalLines = record.coveredLines.size + record.uncoveredLines.size;
  const lineStatuses =
    record.lineStatuses != null && record.lineStatuses.size > 0
      ? new Map(record.lineStatuses)
      : (() => {
          const m = new Map<number, number>();
          for (const line of record.coveredLines)
            m.set(line, LINE_STATUS.COVERED_SMALL);
          for (const line of record.uncoveredLines)
            m.set(line, LINE_STATUS.UNCOVERED);
          return m;
        })();
  return {
    file: {
      fileId: 0,
      sourceFile: record.sourcePath,
      lineCoveragePercent: record.lineCoveragePercent,
      totalLines,
      coveredLines: record.coveredLines.size,
    },
    coveredLines: record.coveredLines,
    uncoveredLines: record.uncoveredLines,
    uncoverableLines: record.uncoverableLines,
    lineStatuses,
  };
}

/** Group line numbers by status code for decoration lookup. Returns Map<statusCode, lineNumbers[]>. */
export function getLinesByStatusCode(
  coverage: CoverageData,
): Map<number, number[]> {
  const byStatus = new Map<number, number[]>();
  for (const [line, code] of coverage.lineStatuses) {
    const list = byStatus.get(code) ?? [];
    list.push(line);
    byStatus.set(code, list);
  }
  for (const list of byStatus.values()) {
    list.sort((a, b) => a - b);
  }
  return byStatus;
}
