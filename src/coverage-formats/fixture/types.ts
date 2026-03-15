/**
 * Types for the fixture coverage format (test-only JSON).
 */

export interface FixtureTest {
  id: number;
  raw: string;
  displayName?: string;
  decodedPath?: string;
}

export interface FixtureCoverageEntry {
  sourcePath: string;
  coveredLines: number[];
  uncoveredLines: number[];
  uncoverableLines?: number[];
  lineCoveragePercent?: number | null;
  tests?: FixtureTest[];
  testsByLine?: Record<string, number[]>;
}

/** Root shape: single entry or multi-file. */
export interface FixtureFile {
  sourcePath?: string;
  coveredLines?: number[];
  uncoveredLines?: number[];
  uncoverableLines?: number[];
  lineCoveragePercent?: number | null;
  tests?: FixtureTest[];
  testsByLine?: Record<string, number[]>;
  files?: FixtureCoverageEntry[];
}
