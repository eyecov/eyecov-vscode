import { describe, it, expect } from 'vitest';
import { LINE_STATUS } from './coverage-types';
import { getLinesByStatusCode, recordToCoverageData } from './coverage-data-mapper';
import type { CoverageRecord } from './coverage-resolver';
import type { CoverageData } from './coverage-types';

describe('recordToCoverageData', () => {
  it('uses record.lineStatuses when present instead of building from sets', () => {
    const lineStatuses = new Map<number, number>();
    lineStatuses.set(1, LINE_STATUS.COVERED_SMALL);
    lineStatuses.set(2, LINE_STATUS.UNCOVERED);
    const record: CoverageRecord = {
      sourcePath: '/app/Foo.php',
      coveredLines: new Set([1]),
      uncoveredLines: new Set([2]),
      uncoverableLines: new Set(),
      lineCoveragePercent: 50,
      lineStatuses,
    };

    const result = recordToCoverageData(record);

    expect(result.lineStatuses.get(1)).toBe(LINE_STATUS.COVERED_SMALL);
    expect(result.lineStatuses.get(2)).toBe(LINE_STATUS.UNCOVERED);
  });

  it('builds lineStatuses from covered/uncovered sets when record has no lineStatuses', () => {
    const record: CoverageRecord = {
      sourcePath: '/app/Bar.php',
      coveredLines: new Set([1, 3]),
      uncoveredLines: new Set([2]),
      uncoverableLines: new Set(),
      lineCoveragePercent: 66.67,
    };

    const result = recordToCoverageData(record);

    expect(result.lineStatuses.get(1)).toBe(1);
    expect(result.lineStatuses.get(2)).toBe(2);
    expect(result.lineStatuses.get(3)).toBe(1);
  });
});

describe('getLinesByStatusCode', () => {
  it('groups line numbers by status code from coverage.lineStatuses', () => {
    const lineStatuses = new Map<number, number>();
    lineStatuses.set(1, LINE_STATUS.COVERED_SMALL);
    lineStatuses.set(2, LINE_STATUS.UNCOVERED);
    lineStatuses.set(3, LINE_STATUS.COVERED_SMALL);
    const coverage: CoverageData = {
      file: { fileId: 0, sourceFile: '/x', lineCoveragePercent: 50, totalLines: 3, coveredLines: 2 },
      coveredLines: new Set([1, 3]),
      uncoveredLines: new Set([2]),
      uncoverableLines: new Set(),
      lineStatuses,
    };

    const result = getLinesByStatusCode(coverage);

    expect(result.get(LINE_STATUS.COVERED_SMALL)).toEqual([1, 3]);
    expect(result.get(LINE_STATUS.UNCOVERED)).toEqual([2]);
  });
});
