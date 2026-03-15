/**
 * PHPUnit HTML coverage result types used by the adapter and shared with MCP/runtime.
 */

export type CoverageFileResult = {
  filePath: string;
  /** Omitted when empty (e.g. LCOV source). */
  coverageHtmlPath?: string;
  lineCoveragePercent: number | null;
  coveredLines: number;
  uncoveredLines: number;
  coveredLineNumbers: number[];
  uncoveredLineNumbers: number[];
  /** Omitted when empty or not provided by the source. */
  uncoverableLines?: number[];
};

export type ParsedCoverageFileResult = CoverageFileResult & {
  testsByLine: Map<number, string[]>;
  /** Per-line status codes (LINE_STATUS.*) from parser. */
  lineStatuses: Map<number, number>;
};
