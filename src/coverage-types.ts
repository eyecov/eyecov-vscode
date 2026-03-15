/**
 * Editor-facing coverage types. Used by the extension for status and decorations.
 */

export interface FileCoverage {
  fileId: number;
  sourceFile: string;
  lineCoveragePercent: number | null;
  totalLines: number | null;
  coveredLines: number | null;
}

export interface CoverageData {
  file: FileCoverage;
  coveredLines: Set<number>;
  uncoveredLines: Set<number>;
  uncoverableLines: Set<number>;
  lineStatuses: Map<number, number>;
}
