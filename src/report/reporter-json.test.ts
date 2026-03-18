import { describe, expect, it } from "vitest";
import { renderJsonReport } from "./reporter-json";
import type { ReportCliOutput } from "./types";

describe("renderJsonReport", () => {
  it("matches the documented JSON shape", () => {
    const output: ReportCliOutput = {
      format: "cobertura",
      artifactPath: "/abs/path/to/cobertura-coverage.xml",
      workspaceRoot: "/abs/path/to/repo",
      parsed: true,
      filesDiscovered: 1,
      totals: {
        coveredLines: 3,
        uncoveredLines: 1,
        executableLines: 4,
        aggregateCoveragePercent: 75,
      },
      verification: {
        supported: true,
        matches: true,
        metrics: [
          {
            name: "coveredLines",
            report: 3,
            eyecov: 3,
            match: true,
          },
        ],
      },
      samples: [
        {
          filePath: "/abs/path/to/file.ts",
          coveredLines: 3,
          uncoveredLines: 1,
          lineCoveragePercent: 75,
        },
      ],
      warnings: [],
    };

    expect(JSON.parse(renderJsonReport(output))).toEqual(output);
  });
});
