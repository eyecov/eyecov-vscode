import { describe, it, expect } from "vitest";
import { LINE_STATUS } from "./coverage-types";
import {
  getDecorationPlan,
  getLinesByStatusCode,
  getStatusBarContent,
  recordToCoverageData,
} from "./coverage-data-mapper";
import type { CoverageRecord } from "./coverage-resolver";
import type { CoverageData } from "./coverage-types";

const decorationOptions = {
  showCovered: true,
  showUncovered: true,
  showLineCoverage: true,
  showGutterCoverage: true,
  totalLines: 10,
};

describe("recordToCoverageData", () => {
  it("uses record.lineStatuses when present instead of building from sets", () => {
    const lineStatuses = new Map<number, number>();
    lineStatuses.set(1, LINE_STATUS.COVERED_SMALL);
    lineStatuses.set(2, LINE_STATUS.UNCOVERED);
    const record: CoverageRecord = {
      sourcePath: "/app/Foo.php",
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

  it("builds lineStatuses from covered/uncovered sets when record has no lineStatuses", () => {
    const record: CoverageRecord = {
      sourcePath: "/app/Bar.php",
      coveredLines: new Set([1, 3]),
      uncoveredLines: new Set([2]),
      uncoverableLines: new Set(),
      lineCoveragePercent: 66.67,
    };

    const result = recordToCoverageData(record);

    expect(result.lineStatuses.get(1)).toBe(LINE_STATUS.COVERED_SMALL);
    expect(result.lineStatuses.get(2)).toBe(LINE_STATUS.UNCOVERED);
    expect(result.lineStatuses.get(3)).toBe(LINE_STATUS.COVERED_SMALL);
  });
});

describe("getDecorationPlan", () => {
  it("returns simple plan with covered/uncovered/uncoverable line numbers in 1..totalLines", () => {
    const coverage: CoverageData = {
      file: {
        fileId: 0,
        sourceFile: "/x",
        lineCoveragePercent: 50,
        totalLines: 3,
        coveredLines: 2,
      },
      coveredLines: new Set([1, 5]),
      uncoveredLines: new Set([2]),
      uncoverableLines: new Set(),
      lineStatuses: new Map([
        [1, LINE_STATUS.COVERED_SMALL],
        [2, LINE_STATUS.UNCOVERED],
        [5, LINE_STATUS.COVERED_SMALL],
      ]),
    };

    const plan = getDecorationPlan(coverage, decorationOptions);

    expect(plan.useGranular).toBe(false);
    expect(plan.covered).toEqual([1, 5]);
    expect(plan.uncovered).toEqual([2]);
    expect(plan.uncoverable).toEqual([]);
  });

  it("omits covered lines when showCovered is false", () => {
    const coverage: CoverageData = {
      file: {
        fileId: 0,
        sourceFile: "/x",
        lineCoveragePercent: 66,
        totalLines: 5,
        coveredLines: 2,
      },
      coveredLines: new Set([1, 3]),
      uncoveredLines: new Set([2]),
      uncoverableLines: new Set(),
      lineStatuses: new Map([
        [1, LINE_STATUS.COVERED_SMALL],
        [2, LINE_STATUS.UNCOVERED],
        [3, LINE_STATUS.COVERED_SMALL],
      ]),
    };

    const plan = getDecorationPlan(coverage, {
      ...decorationOptions,
      showCovered: false,
    });

    expect(plan.covered).toEqual([]);
    expect(plan.uncovered).toEqual([2]);
  });

  it("returns granular plan with byStatus when coverage has multiple status codes", () => {
    const coverage: CoverageData = {
      file: {
        fileId: 0,
        sourceFile: "/x",
        lineCoveragePercent: 50,
        totalLines: 10,
        coveredLines: 2,
      },
      coveredLines: new Set([1, 5]),
      uncoveredLines: new Set([2]),
      uncoverableLines: new Set([3]),
      lineStatuses: new Map([
        [1, LINE_STATUS.COVERED_SMALL],
        [2, LINE_STATUS.UNCOVERED],
        [3, LINE_STATUS.UNCOVERABLE],
        [5, LINE_STATUS.COVERED_LARGE],
      ]),
    };

    const plan = getDecorationPlan(coverage, decorationOptions);

    expect(plan.useGranular).toBe(true);
    expect(plan.byStatus).toBeDefined();
    expect(plan.byStatus!.get(LINE_STATUS.COVERED_SMALL)).toEqual([1]);
    expect(plan.byStatus!.get(LINE_STATUS.COVERED_LARGE)).toEqual([5]);
    expect(plan.byStatus!.get(LINE_STATUS.UNCOVERED)).toEqual([2]);
    expect(plan.byStatus!.get(LINE_STATUS.UNCOVERABLE)).toEqual([3]);
  });
});

describe("getStatusBarContent", () => {
  it("returns show false and default text when no coverage or coverage disabled", () => {
    expect(getStatusBarContent(null, true).show).toBe(false);
    expect(getStatusBarContent(null, true).text).toContain("Coverage");
    expect(getStatusBarContent(null, false).show).toBe(false);
    const coverage: CoverageData = {
      file: {
        fileId: 0,
        sourceFile: "/x",
        lineCoveragePercent: 50,
        totalLines: 10,
        coveredLines: 5,
      },
      coveredLines: new Set([1, 2, 3, 4, 5]),
      uncoveredLines: new Set(),
      uncoverableLines: new Set(),
      lineStatuses: new Map(),
    };
    expect(getStatusBarContent(coverage, false).show).toBe(false);
  });

  it("returns percent text and theme color id when coverage enabled and percent set", () => {
    const coverage: CoverageData = {
      file: {
        fileId: 0,
        sourceFile: "/x",
        lineCoveragePercent: 85,
        totalLines: 10,
        coveredLines: 8,
      },
      coveredLines: new Set(),
      uncoveredLines: new Set(),
      uncoverableLines: new Set(),
      lineStatuses: new Map(),
    };
    const out = getStatusBarContent(coverage, true);
    expect(out.show).toBe(true);
    expect(out.text).toContain("85.0%");
    expect(out.text).toContain("8/10");
    expect(out.backgroundColor).toBe("statusBarItem.prominentBackground");
  });
});

describe("getLinesByStatusCode", () => {
  it("groups line numbers by status code from coverage.lineStatuses", () => {
    const lineStatuses = new Map<number, number>();
    lineStatuses.set(1, LINE_STATUS.COVERED_SMALL);
    lineStatuses.set(2, LINE_STATUS.UNCOVERED);
    lineStatuses.set(3, LINE_STATUS.COVERED_SMALL);
    const coverage: CoverageData = {
      file: {
        fileId: 0,
        sourceFile: "/x",
        lineCoveragePercent: 50,
        totalLines: 3,
        coveredLines: 2,
      },
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
