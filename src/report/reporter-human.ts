import type { ReportTheme } from "./theme";
import type { ReportCliOutput } from "./types";

function formatVerification(
  output: ReportCliOutput,
  theme: ReportTheme,
): string[] {
  if (!output.verification.supported) {
    return [
      theme.heading("Verification"),
      output.verification.warning ?? "Verification unsupported",
    ];
  }

  return [
    theme.heading("Verification"),
    ...output.verification.metrics.map((metric) => {
      const status = metric.match
        ? theme.success("match")
        : theme.danger("mismatch");
      return `${metric.name}: report=${metric.report} eyecov=${metric.eyecov} ${status}`;
    }),
  ];
}

export function renderHumanReport(
  output: ReportCliOutput,
  theme: ReportTheme,
): string {
  const lines = [
    theme.heading("EyeCov Report"),
    `format: ${output.format}`,
    `artifact: ${output.artifactPath}`,
    `workspace: ${output.workspaceRoot}`,
    "",
    theme.heading("Summary"),
    `filesDiscovered: ${output.filesDiscovered}`,
    `coveredLines: ${output.totals.coveredLines}`,
    `uncoveredLines: ${output.totals.uncoveredLines}`,
    `executableLines: ${output.totals.executableLines}`,
    `aggregateCoveragePercent: ${output.totals.aggregateCoveragePercent ?? "N/A"}`,
    "",
    ...formatVerification(output, theme),
    "",
    theme.heading("Sample Files"),
    ...(output.samples.length > 0
      ? output.samples.map(
          (sample) =>
            `${sample.filePath} covered=${sample.coveredLines} uncovered=${sample.uncoveredLines} percent=${sample.lineCoveragePercent ?? "N/A"}`,
        )
      : ["No sample files"]),
  ];

  if (output.warnings.length > 0) {
    lines.push("", theme.heading("Warnings"));
    for (const warning of output.warnings) {
      lines.push(theme.warning(warning));
    }
  }

  return `${lines.join("\n")}\n`;
}
