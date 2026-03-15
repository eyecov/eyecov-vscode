import { describe, it, expect } from 'vitest';
import { parseFixtureCoverage } from './parser';

describe('parseFixtureCoverage', () => {
  it('parses valid single-entry JSON and returns one entry with computed percent', () => {
    const json = JSON.stringify({
      sourcePath: 'src/example.ts',
      coveredLines: [1, 2, 3],
      uncoveredLines: [4, 5],
    });
    const entries = parseFixtureCoverage(json);
    expect(entries).toHaveLength(1);
    expect(entries[0].sourcePath).toBe('src/example.ts');
    expect(entries[0].coveredLines).toEqual([1, 2, 3]);
    expect(entries[0].uncoveredLines).toEqual([4, 5]);
    expect(entries[0].lineCoveragePercent).toBe(60); // 3/(3+2)*100
  });

  it('parses optional uncoverableLines and tests/testsByLine', () => {
    const json = JSON.stringify({
      sourcePath: 'src/foo.ts',
      coveredLines: [1],
      uncoveredLines: [2],
      uncoverableLines: [3],
      tests: [{ id: 1, raw: 'FooTest::it_works', displayName: 'it works', decodedPath: 'tests/FooTest.php' }],
      testsByLine: { '1': [1] },
    });
    const entries = parseFixtureCoverage(json);
    expect(entries).toHaveLength(1);
    expect(entries[0].uncoverableLines).toEqual([3]);
    expect(entries[0].tests).toHaveLength(1);
    expect(entries[0].tests![0].raw).toBe('FooTest::it_works');
    expect(entries[0].testsByLine).toEqual({ '1': [1] });
  });

  it('parses valid multi-entry files array', () => {
    const json = JSON.stringify({
      files: [
        { sourcePath: 'src/a.ts', coveredLines: [1], uncoveredLines: [] },
        { sourcePath: 'src/b.ts', coveredLines: [], uncoveredLines: [1, 2] },
      ],
    });
    const entries = parseFixtureCoverage(json);
    expect(entries).toHaveLength(2);
    expect(entries[0].sourcePath).toBe('src/a.ts');
    expect(entries[0].lineCoveragePercent).toBe(100);
    expect(entries[1].sourcePath).toBe('src/b.ts');
    expect(entries[1].lineCoveragePercent).toBe(0);
  });

  it('uses explicit lineCoveragePercent when provided', () => {
    const json = JSON.stringify({
      sourcePath: 'src/x.ts',
      coveredLines: [1, 2],
      uncoveredLines: [3],
      lineCoveragePercent: 66.67,
    });
    const entries = parseFixtureCoverage(json);
    expect(entries[0].lineCoveragePercent).toBe(66.67);
  });

  it('returns null percent when no executable lines', () => {
    const json = JSON.stringify({
      sourcePath: 'src/empty.ts',
      coveredLines: [],
      uncoveredLines: [],
    });
    const entries = parseFixtureCoverage(json);
    expect(entries[0].lineCoveragePercent).toBeNull();
  });

  it('throws on invalid JSON', () => {
    expect(() => parseFixtureCoverage('not json')).toThrow();
    expect(() => parseFixtureCoverage('')).toThrow();
  });
});
