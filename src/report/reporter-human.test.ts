import { describe, expect, it } from "vitest";
import { createTheme } from "./theme";
import { renderHumanReport } from "./reporter-human";
import type { ReportCliOutput } from "./types";

const output: ReportCliOutput = {
  format: "lcov",
  artifactPath: "/abs/path/to/lcov.info",
  workspaceRoot: "/abs/path/to/repo",
  parsed: true,
  filesDiscovered: 2,
  totals: {
    coveredLines: 4,
    uncoveredLines: 2,
    executableLines: 6,
    aggregateCoveragePercent: 66.67,
  },
  verification: {
    supported: true,
    matches: false,
    metrics: [
      {
        name: "coveredLines",
        report: 5,
        eyecov: 4,
        match: false,
      },
    ],
  },
  samples: [
    {
      filePath: "/abs/path/to/a.ts",
      coveredLines: 1,
      uncoveredLines: 2,
      lineCoveragePercent: 33.33,
    },
  ],
  warnings: ["Skipped stale LCOV record for /abs/path/to/b.ts"],
};

describe("renderHumanReport", () => {
  it("renders stable plain output sections", () => {
    const rendered = renderHumanReport(output, createTheme(false));

    expect(rendered).toContain("EyeCov Report");
    expect(rendered).toContain("Summary");
    expect(rendered).toContain("Verification");
    expect(rendered).toContain("Sample Files");
    expect(rendered).toContain("Warnings");
    expect(rendered).toContain("coveredLines: report=5 eyecov=4 mismatch");
  });

  it("renders ANSI output when colors are enabled", () => {
    const rendered = renderHumanReport(output, createTheme(true));

    expect(rendered).toContain("\u001B[");
  });
});
