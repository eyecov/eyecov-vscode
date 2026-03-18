import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CoverageFormatType } from "../coverage-config";
import type { CoverageRecord } from "../coverage-resolver";
import { aggregateReportRecords } from "./aggregator";
import type { LoadedArtifact } from "./artifact-loader";
import { verifyLoadedArtifact } from "./verifier";

const tempDirs: string[] = [];

function createRecord(
  sourcePath: string,
  coveredLines: number[],
  uncoveredLines: number[],
  sourceFormat: CoverageFormatType,
): CoverageRecord {
  const executableLines = coveredLines.length + uncoveredLines.length;
  return {
    sourcePath,
    coveredLines: new Set(coveredLines),
    uncoveredLines: new Set(uncoveredLines),
    uncoverableLines: new Set<number>(),
    lineCoveragePercent:
      executableLines > 0
        ? Number(((coveredLines.length / executableLines) * 100).toFixed(2))
        : null,
    sourceFormat,
  };
}

function createLoadedArtifact(
  format: CoverageFormatType,
  overrides: Partial<LoadedArtifact> = {},
): LoadedArtifact {
  return {
    format,
    artifactPath: "/tmp/artifact",
    workspaceRoot: "/tmp/workspace",
    records: [createRecord("/tmp/workspace/a.ts", [1], [2], format)],
    warnings: [],
    reportTotals: {
      coveredLines: 1,
      executableLines: 2,
      aggregateCoveragePercent: 50,
    },
    derivedTotals: {
      coveredLines: 1,
      executableLines: 2,
      aggregateCoveragePercent: 50,
    },
    hasUnresolvedEntries: false,
    ...overrides,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("verifyLoadedArtifact", () => {
  it("matches Cobertura totals when report and EyeCov totals agree", () => {
    const loaded = createLoadedArtifact("cobertura");
    const aggregated = aggregateReportRecords(loaded.records, 10);

    expect(verifyLoadedArtifact(loaded, aggregated)).toEqual({
      supported: true,
      matches: true,
      metrics: [
        { name: "coveredLines", report: 1, eyecov: 1, match: true },
        { name: "executableLines", report: 2, eyecov: 2, match: true },
        {
          name: "aggregateCoveragePercent",
          report: 50,
          eyecov: 50,
          match: true,
        },
      ],
    });
  });

  it("warns about executable-line drift only when the totals actually differ", () => {
    // No drift: reportTotals.executableLines === aggregated executableLines → no warning
    const noDrift = createLoadedArtifact("cobertura");
    const noDriftAgg = aggregateReportRecords(noDrift.records, 10);
    expect(verifyLoadedArtifact(noDrift, noDriftAgg).warning).toBeUndefined();

    // With drift: reportTotals says 4 executable, EyeCov sees 2 → warn
    const withDrift = createLoadedArtifact("cobertura", {
      reportTotals: {
        coveredLines: 1,
        executableLines: 4,
        aggregateCoveragePercent: 25,
      },
      derivedTotals: {
        coveredLines: 1,
        executableLines: 2,
        aggregateCoveragePercent: 50,
      },
    });
    const withDriftAgg = aggregateReportRecords(withDrift.records, 10);
    expect(verifyLoadedArtifact(withDrift, withDriftAgg).warning).toMatch(
      /Cobertura report totals/,
    );
  });

  it("does not suppress real Cobertura mismatches when aggregate totals drift from parser-derived totals", () => {
    const loaded = createLoadedArtifact("cobertura", {
      reportTotals: {
        coveredLines: 1,
        executableLines: 4,
        aggregateCoveragePercent: 25,
      },
      derivedTotals: {
        coveredLines: 1,
        executableLines: 4,
        aggregateCoveragePercent: 25,
      },
    });
    const aggregated = aggregateReportRecords(loaded.records, 10);

    expect(verifyLoadedArtifact(loaded, aggregated)).toEqual({
      supported: true,
      matches: false,
      metrics: [
        { name: "coveredLines", report: 1, eyecov: 1, match: true },
        { name: "executableLines", report: 4, eyecov: 2, match: false },
        {
          name: "aggregateCoveragePercent",
          report: 25,
          eyecov: 50,
          match: false,
        },
      ],
    });
  });

  it("reports mismatches for LCOV totals", () => {
    const loaded = createLoadedArtifact("lcov", {
      reportTotals: {
        coveredLines: 2,
        executableLines: 2,
        aggregateCoveragePercent: 100,
      },
    });
    const aggregated = aggregateReportRecords(loaded.records, 10);

    expect(verifyLoadedArtifact(loaded, aggregated)).toEqual({
      supported: true,
      matches: false,
      metrics: [
        { name: "coveredLines", report: 2, eyecov: 1, match: false },
        { name: "executableLines", report: 2, eyecov: 2, match: true },
        {
          name: "aggregateCoveragePercent",
          report: 100,
          eyecov: 50,
          match: false,
        },
      ],
    });
  });

  it("treats missing Cobertura totals as unsupported verification", () => {
    const loaded = createLoadedArtifact("cobertura", {
      reportTotals: null,
    });
    const aggregated = aggregateReportRecords(loaded.records, 10);

    expect(verifyLoadedArtifact(loaded, aggregated)).toEqual({
      supported: false,
      matches: null,
      metrics: [],
      warning: expect.stringContaining("unavailable"),
    });
  });

  it("keeps zero-coverage Cobertura totals matched when the aggregate is also zero", () => {
    const loaded = createLoadedArtifact("cobertura", {
      records: [createRecord("/tmp/workspace/a.ts", [], [1, 2], "cobertura")],
      reportTotals: {
        coveredLines: 0,
        executableLines: 2,
        aggregateCoveragePercent: 0,
      },
      derivedTotals: {
        coveredLines: 0,
        executableLines: 2,
        aggregateCoveragePercent: 0,
      },
    });
    const aggregated = aggregateReportRecords(loaded.records, 10);

    expect(verifyLoadedArtifact(loaded, aggregated)).toEqual({
      supported: true,
      matches: true,
      metrics: [
        { name: "coveredLines", report: 0, eyecov: 0, match: true },
        { name: "executableLines", report: 2, eyecov: 2, match: true },
        {
          name: "aggregateCoveragePercent",
          report: 0,
          eyecov: 0,
          match: true,
        },
      ],
    });
  });

  it("does not tolerate extreme Cobertura executable-line drift when the percent also diverges from EyeCov totals", () => {
    const loaded = createLoadedArtifact("cobertura", {
      reportTotals: {
        coveredLines: 1,
        executableLines: 10_000,
        aggregateCoveragePercent: 0.01,
      },
      derivedTotals: {
        coveredLines: 1,
        executableLines: 2,
        aggregateCoveragePercent: 50,
      },
    });
    const aggregated = aggregateReportRecords(loaded.records, 10);

    expect(verifyLoadedArtifact(loaded, aggregated)).toEqual({
      supported: true,
      matches: false,
      metrics: [
        { name: "coveredLines", report: 1, eyecov: 1, match: true },
        {
          name: "executableLines",
          report: 10_000,
          eyecov: 2,
          match: false,
        },
        {
          name: "aggregateCoveragePercent",
          report: 0.01,
          eyecov: 50,
          match: false,
        },
      ],
    });
  });

  it("verifies only aggregate percent for Clover", () => {
    const loaded = createLoadedArtifact("clover", {
      reportTotals: {
        coveredLines: 200,
        executableLines: 400,
        aggregateCoveragePercent: 50,
      },
    });
    const aggregated = aggregateReportRecords(loaded.records, 10);

    expect(verifyLoadedArtifact(loaded, aggregated)).toEqual({
      supported: true,
      matches: true,
      metrics: [
        {
          name: "aggregateCoveragePercent",
          report: 50,
          eyecov: 50,
          match: true,
        },
      ],
    });
  });

  it("uses the PHPUnit HTML root summary when available", () => {
    const coverageDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "eyecov-report-verify-"),
    );
    tempDirs.push(coverageDir);
    fs.writeFileSync(
      path.join(coverageDir, "index.html"),
      "<table><tr><td>Total</td><td>1 / 2</td><td>50%</td></tr></table>",
    );

    const loaded = createLoadedArtifact("phpunit-html", {
      artifactPath: coverageDir,
      reportTotals: null,
    });
    const aggregated = aggregateReportRecords(loaded.records, 10);

    expect(verifyLoadedArtifact(loaded, aggregated)).toEqual({
      supported: true,
      matches: true,
      metrics: [
        { name: "coveredLines", report: 1, eyecov: 1, match: true },
        { name: "executableLines", report: 2, eyecov: 2, match: true },
        {
          name: "aggregateCoveragePercent",
          report: 50,
          eyecov: 50,
          match: true,
        },
      ],
    });
  });

  it("degrades PHPUnit HTML verification to unsupported when the root summary is unavailable", () => {
    const coverageDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "eyecov-report-verify-"),
    );
    tempDirs.push(coverageDir);

    const loaded = createLoadedArtifact("phpunit-html", {
      artifactPath: coverageDir,
      reportTotals: null,
    });
    const aggregated = aggregateReportRecords(loaded.records, 10);

    expect(verifyLoadedArtifact(loaded, aggregated)).toEqual({
      supported: false,
      matches: null,
      metrics: [],
      warning: expect.stringContaining("unsupported"),
    });
  });

  it("treats unresolved shared-artifact paths as unsupported verification", () => {
    const loaded = createLoadedArtifact("lcov", {
      hasUnresolvedEntries: true,
    });
    const aggregated = aggregateReportRecords(loaded.records, 10);

    expect(verifyLoadedArtifact(loaded, aggregated)).toEqual({
      supported: false,
      matches: null,
      metrics: [],
      warning: expect.stringContaining("could not be resolved"),
    });
  });
});
