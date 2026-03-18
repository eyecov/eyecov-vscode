/**
 * Editor-facing coverage types. Used by the extension for status and decorations.
 */

import type { CoverageFormatType } from "./coverage-config";

/** Line status codes for coverage (compact, fast lookup). Used in lineStatuses Map<line, code>. */
export const LINE_STATUS = {
  COVERED_SMALL: 1,
  COVERED_MEDIUM: 2,
  COVERED_LARGE: 3,
  UNCOVERED: 4,
  WARNING: 5,
  UNCOVERABLE: 6,
} as const;

export type LineStatusCode = (typeof LINE_STATUS)[keyof typeof LINE_STATUS];

export interface FileCoverage {
  fileId: number;
  sourceFile: string;
  lineCoveragePercent: number | null;
  totalLines: number | null;
  coveredLines: number | null;
  /** Source format that produced this coverage (e.g. 'phpunit-html', 'lcov'). */
  sourceFormat?: CoverageFormatType;
}

export interface CoverageData {
  file: FileCoverage;
  coveredLines: Set<number>;
  uncoveredLines: Set<number>;
  uncoverableLines: Set<number>;
  lineStatuses: Map<number, number>;
}
