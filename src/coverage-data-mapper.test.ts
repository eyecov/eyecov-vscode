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

  it("passes through sourceFormat from record to file", () => {
    const record: CoverageRecord = {
      sourcePath: "/workspace/src/foo.ts",
      coveredLines: new Set([1]),
      uncoveredLines: new Set([2]),
      uncoverableLines: new Set(),
      lineCoveragePercent: 33.33,
      sourceFormat: "lcov",
    };

    const result = recordToCoverageData(record);

    expect(result.file.sourceFormat).toBe("lcov");
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
  it("shows no-source when coverage is null and no context (hasSource falsy)", () => {
    const out = getStatusBarContent(null, { coverageEnabled: true });
    expect(out.show).toBe(true);
    expect(out.text).toContain("no source");
    expect(out.tooltip).toContain("No coverage config");
  });

  it("shows Coverage (off) when coverageEnabled is false", () => {
    expect(
      getStatusBarContent(null, { coverageEnabled: false }).text,
    ).toContain("(off)");
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
    expect(
      getStatusBarContent(coverage, { coverageEnabled: false }).text,
    ).toContain("(off)");
  });

  it("shows No coverage without path text when hasSource but no data", () => {
    const out = getStatusBarContent(null, {
      coverageEnabled: true,
      noCoverageContext: {
        hasSource: true,
        workspaceFolder: "/workspace",
        activeFilePath: "/workspace/src/Service/Foo.php",
      },
    });
    expect(out.show).toBe(true);
    expect(out.text).toBe("$(test-view-icon) No coverage");
    expect(out.tooltip).toContain("No coverage data for this file");
  });

  it("shows invalidated (red) when noCoverageReason is stale", () => {
    const out = getStatusBarContent(null, {
      coverageEnabled: true,
      noCoverageContext: { hasSource: true, noCoverageReason: "stale" },
    });
    expect(out.show).toBe(true);
    expect(out.text).toContain("invalidated");
    expect(out.backgroundColor).toBe("statusBarItem.errorBackground");
    expect(out.tooltip).toContain("older than the source file");
  });

  it("shows No coverage without path when no workspaceFolder", () => {
    const out = getStatusBarContent(null, {
      coverageEnabled: true,
      noCoverageContext: { hasSource: true },
    });
    expect(out.text).toContain("No coverage");
    expect(out.text).not.toContain("•");
  });

  it("returns percent, source format and prominent background for high coverage", () => {
    const coverage: CoverageData = {
      file: {
        fileId: 0,
        sourceFile: "/workspace/app/Foo.php",
        lineCoveragePercent: 85,
        totalLines: 10,
        coveredLines: 8,
        sourceFormat: "phpunit-html",
      },
      coveredLines: new Set(),
      uncoveredLines: new Set(),
      uncoverableLines: new Set(),
      lineStatuses: new Map(),
    };
    const out = getStatusBarContent(coverage, {
      coverageEnabled: true,
      noCoverageContext: {
        hasSource: true,
        workspaceFolder: "/workspace",
      },
    });
    expect(out.show).toBe(true);
    expect(out.text).toContain("85.0%");
    expect(out.text).toContain("8/10");
    expect(out.text).toContain("phpunit-html");
    expect(out.text).not.toContain("app/Foo.php");
    expect(out.backgroundColor).toBe("statusBarItem.prominentBackground");
  });

  it("returns warning background for medium coverage (50–79%)", () => {
    const coverage: CoverageData = {
      file: {
        fileId: 0,
        sourceFile: "/x",
        lineCoveragePercent: 60,
        totalLines: 10,
        coveredLines: 6,
        sourceFormat: "lcov",
      },
      coveredLines: new Set(),
      uncoveredLines: new Set(),
      uncoverableLines: new Set(),
      lineStatuses: new Map(),
    };
    const out = getStatusBarContent(coverage, {
      coverageEnabled: true,
      noCoverageContext: { hasSource: true },
    });
    expect(out.backgroundColor).toBe("statusBarItem.warningBackground");
    expect(out.text).toContain("lcov");
  });

  it("returns error background for low coverage (<50%)", () => {
    const coverage: CoverageData = {
      file: {
        fileId: 0,
        sourceFile: "/x",
        lineCoveragePercent: 30,
        totalLines: 10,
        coveredLines: 3,
      },
      coveredLines: new Set(),
      uncoveredLines: new Set(),
      uncoverableLines: new Set(),
      lineStatuses: new Map(),
    };
    const out = getStatusBarContent(coverage, {
      coverageEnabled: true,
      noCoverageContext: { hasSource: true },
    });
    expect(out.backgroundColor).toBe("statusBarItem.errorBackground");
  });

  it("tooltip includes source, path, covered lines and total when coverage present", () => {
    const coverage: CoverageData = {
      file: {
        fileId: 0,
        sourceFile: "/workspace/src/bar.ts",
        lineCoveragePercent: 75,
        totalLines: 20,
        coveredLines: 15,
        sourceFormat: "lcov",
      },
      coveredLines: new Set(),
      uncoveredLines: new Set(),
      uncoverableLines: new Set(),
      lineStatuses: new Map(),
    };
    const out = getStatusBarContent(coverage, {
      coverageEnabled: true,
      noCoverageContext: {
        hasSource: true,
        workspaceFolder: "/workspace",
      },
    });
    expect(out.tooltip).toContain("75.0%");
    expect(out.tooltip).toContain("Source: lcov");
    expect(out.tooltip).toContain("src/bar.ts");
    expect(out.tooltip).toContain("Covered lines: 15");
    expect(out.tooltip).toContain("Total lines: 20");
    expect(out.tooltip).toContain("Click to toggle");
  });

  it("shows N/A with source format when percent is null", () => {
    const coverage: CoverageData = {
      file: {
        fileId: 0,
        sourceFile: "/x",
        lineCoveragePercent: null,
        totalLines: 0,
        coveredLines: 0,
        sourceFormat: "phpunit-html",
      },
      coveredLines: new Set(),
      uncoveredLines: new Set(),
      uncoverableLines: new Set(),
      lineStatuses: new Map(),
    };
    const out = getStatusBarContent(coverage, {
      coverageEnabled: true,
      noCoverageContext: { hasSource: true },
    });
    expect(out.text).toContain("N/A");
    expect(out.text).toContain("phpunit-html");
    expect(out.backgroundColor).toBeUndefined();
  });

  it("uses fallback 'coverage' when sourceFormat is missing", () => {
    const coverage: CoverageData = {
      file: {
        fileId: 0,
        sourceFile: "/x",
        lineCoveragePercent: 50,
        totalLines: 4,
        coveredLines: 2,
      },
      coveredLines: new Set(),
      uncoveredLines: new Set(),
      uncoverableLines: new Set(),
      lineStatuses: new Map(),
    };
    const out = getStatusBarContent(coverage, {
      coverageEnabled: true,
      noCoverageContext: { hasSource: true },
    });
    expect(out.text).toContain("coverage");
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
