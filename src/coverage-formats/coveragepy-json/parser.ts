import { lineCoveragePercent } from "../xml/shared";

export interface CoveragePyJsonFileRecord {
  sourcePath: string;
  coveredLines: number[];
  uncoveredLines: number[];
}

export interface CoveragePyJsonParseResult {
  files: CoveragePyJsonFileRecord[];
  totals: {
    coveredLines: number | null;
    executableLines: number | null;
    aggregateCoveragePercent: number | null;
  };
}

export function parseCoveragePyJson(
  content: string,
): CoveragePyJsonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return {
      files: [],
      totals: {
        coveredLines: null,
        executableLines: null,
        aggregateCoveragePercent: null,
      },
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      files: [],
      totals: {
        coveredLines: null,
        executableLines: null,
        aggregateCoveragePercent: null,
      },
    };
  }

  const data = parsed as {
    files?: Record<
      string,
      {
        executed_lines?: number[];
        missing_lines?: number[];
      }
    >;
    totals?: {
      covered_lines?: number;
      num_statements?: number;
      percent_covered?: number;
    };
  };

  const files = Object.entries(data.files ?? {})
    .map(([sourcePath, file]) => ({
      sourcePath,
      coveredLines: [
        ...new Set((file.executed_lines ?? []).filter(Number.isInteger)),
      ].sort((a, b) => a - b),
      uncoveredLines: [
        ...new Set((file.missing_lines ?? []).filter(Number.isInteger)),
      ].sort((a, b) => a - b),
    }))
    .map((file) => ({
      ...file,
      uncoveredLines: file.uncoveredLines.filter(
        (line) => !file.coveredLines.includes(line),
      ),
    }))
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

  const coveredLines =
    typeof data.totals?.covered_lines === "number"
      ? data.totals.covered_lines
      : null;
  const executableLines =
    typeof data.totals?.num_statements === "number"
      ? data.totals.num_statements
      : null;
  const aggregateCoveragePercent =
    typeof data.totals?.percent_covered === "number"
      ? Number(data.totals.percent_covered.toFixed(2))
      : coveredLines !== null && executableLines !== null
        ? lineCoveragePercent(coveredLines, executableLines - coveredLines)
        : null;

  return {
    files,
    totals: {
      coveredLines,
      executableLines,
      aggregateCoveragePercent,
    },
  };
}
