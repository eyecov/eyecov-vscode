import type { AggregatedReport } from "./types";
import type { LoadedArtifact } from "./artifact-loader";
import { readPhpUnitHtmlSummary } from "./phpunit-html-summary";
import type { VerificationMetric, VerificationResult } from "./types";
import { lineCoveragePercent } from "../coverage-formats/xml/shared";

function buildMetrics(
  report: {
    coveredLines: number;
    executableLines: number;
    aggregateCoveragePercent: number | null;
  },
  aggregated: AggregatedReport,
  options?: {
    percentOnly?: boolean;
  },
): VerificationMetric[] {
  const percent = aggregated.totals.aggregateCoveragePercent ?? 0;
  if (options?.percentOnly) {
    return [
      {
        name: "aggregateCoveragePercent",
        report: report.aggregateCoveragePercent ?? 0,
        eyecov: percent,
        match: (report.aggregateCoveragePercent ?? 0) === percent,
      },
    ];
  }
  return [
    {
      name: "coveredLines",
      report: report.coveredLines,
      eyecov: aggregated.totals.coveredLines,
      match: report.coveredLines === aggregated.totals.coveredLines,
    },
    {
      name: "executableLines",
      report: report.executableLines,
      eyecov: aggregated.totals.executableLines,
      match: report.executableLines === aggregated.totals.executableLines,
    },
    {
      name: "aggregateCoveragePercent",
      report: report.aggregateCoveragePercent ?? 0,
      eyecov: percent,
      match: (report.aggregateCoveragePercent ?? 0) === percent,
    },
  ];
}

export function verifyLoadedArtifact(
  loaded: LoadedArtifact,
  aggregated: AggregatedReport,
): VerificationResult {
  if (loaded.hasUnresolvedEntries) {
    return {
      supported: false,
      matches: null,
      metrics: [],
      warning: `Verification unsupported for ${loaded.format} because some report paths could not be resolved locally.`,
    };
  }

  const reportTotals =
    loaded.format === "phpunit-html"
      ? readPhpUnitHtmlSummary(loaded.artifactPath)
      : loaded.reportTotals;

  if (!reportTotals) {
    return {
      supported: false,
      matches: null,
      metrics: [],
      warning: `Verification unsupported for ${loaded.format} because report totals are unavailable.`,
    };
  }

  if (loaded.format === "cobertura") {
    const coveredLinesMatch =
      reportTotals.coveredLines === aggregated.totals.coveredLines;
    const executableLinesDrift =
      reportTotals.executableLines !== aggregated.totals.executableLines;
    const derivedTotalsMatchAggregate =
      loaded.derivedTotals?.coveredLines === aggregated.totals.coveredLines &&
      loaded.derivedTotals?.executableLines === aggregated.totals.executableLines &&
      loaded.derivedTotals?.aggregateCoveragePercent ===
        aggregated.totals.aggregateCoveragePercent;
    const derivedTotalsDriftFromReport =
      loaded.derivedTotals?.coveredLines === reportTotals.coveredLines &&
      loaded.derivedTotals?.executableLines !== reportTotals.executableLines &&
      loaded.derivedTotals?.aggregateCoveragePercent ===
        lineCoveragePercent(
          loaded.derivedTotals.coveredLines,
          loaded.derivedTotals.executableLines -
            loaded.derivedTotals.coveredLines,
        );
    const toleratedArtifactDrift =
      coveredLinesMatch &&
      executableLinesDrift &&
      derivedTotalsMatchAggregate &&
      Boolean(derivedTotalsDriftFromReport);
    const metrics = toleratedArtifactDrift
      ? [
          {
            name: "coveredLines" as const,
            report: reportTotals.coveredLines,
            eyecov: aggregated.totals.coveredLines,
            match: coveredLinesMatch,
          },
        ]
      : buildMetrics(reportTotals, aggregated);

    return {
      supported: true,
      matches: metrics.every((metric) => metric.match),
      metrics,
      warning:
        toleratedArtifactDrift
          ? "Cobertura report totals may include executable lines that do not appear in normalized per-line entries; executable-line drift is reported as an artifact inconsistency."
          : undefined,
    };
  }

  const metrics = buildMetrics(reportTotals, aggregated, {
    percentOnly: loaded.format === "clover",
  });

  return {
    supported: true,
    matches: metrics.every((metric) => metric.match),
    metrics,
  };
}
