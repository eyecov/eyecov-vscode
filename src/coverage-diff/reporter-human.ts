import type { CoverageDiffResult } from "./index";

function formatLineRanges(ranges: Array<[number, number]>): string {
  return ranges
    .map(([startLine, endLineExclusive]) =>
      endLineExclusive - startLine <= 1
        ? `${startLine}`
        : `${startLine}-${endLineExclusive - 1}`,
    )
    .join(", ");
}

export function renderHumanCoverageDiff(output: CoverageDiffResult): string {
  const lines = [
    `Coverage diff against ${output.comparisonMode}(${output.baseRef}..${output.headRef})`,
    "",
    `${output.filesChanged} changed files`,
    `${output.filesUncovered} files with uncovered changed lines`,
    `${output.filesMissingCoverage} files missing coverage`,
    `${output.filesStale} files stale`,
  ];

  for (const item of output.items) {
    lines.push("", item.filePath);
    if (item.status === "uncovered") {
      if (item.changedLineRanges && item.changedLineRanges.length > 0) {
        lines.push(
          `  changed executable lines: ${formatLineRanges(item.changedLineRanges)}`,
        );
      }
      lines.push(
        `  uncovered changed lines: ${item.uncoveredLines?.join(", ") ?? ""}`,
      );
      continue;
    }

    if (item.status === "missing") {
      lines.push("  missing coverage");
      continue;
    }

    if (item.status === "stale") {
      lines.push("  stale coverage");
      continue;
    }

    if (item.status === "unsupported") {
      lines.push(`  unsupported: ${item.reason ?? "Unsupported diff shape."}`);
      continue;
    }

    lines.push("  covered");
  }

  return `${lines.join("\n")}\n`;
}
