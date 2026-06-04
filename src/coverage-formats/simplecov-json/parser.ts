import { lineCoveragePercent } from "../xml/shared";

export interface SimpleCovJsonFileRecord {
  sourcePath: string;
  coveredLines: number[];
  uncoveredLines: number[];
}

export interface SimpleCovJsonParseResult {
  files: SimpleCovJsonFileRecord[];
  totals: {
    coveredLines: number | null;
    executableLines: number | null;
    aggregateCoveragePercent: number | null;
  };
}

interface MutableLineCoverage {
  coveredLines: Set<number>;
  uncoveredLines: Set<number>;
}

function emptyResult(): SimpleCovJsonParseResult {
  return {
    files: [],
    totals: {
      coveredLines: null,
      executableLines: null,
      aggregateCoveragePercent: null,
    },
  };
}

function lineDataFromCoverageEntry(entry: unknown): unknown[] | null {
  if (Array.isArray(entry)) {
    return entry;
  }

  if (entry && typeof entry === "object") {
    const lines = (entry as { lines?: unknown }).lines;
    return Array.isArray(lines) ? lines : null;
  }

  return null;
}

export function parseSimpleCovJson(content: string): SimpleCovJsonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return emptyResult();
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyResult();
  }

  const filesByPath = new Map<string, MutableLineCoverage>();

  for (const suite of Object.values(parsed as Record<string, unknown>)) {
    if (!suite || typeof suite !== "object" || Array.isArray(suite)) {
      continue;
    }

    const coverage = (suite as { coverage?: unknown }).coverage;
    if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
      continue;
    }

    for (const [sourcePath, coverageEntry] of Object.entries(
      coverage as Record<string, unknown>,
    )) {
      const lines = lineDataFromCoverageEntry(coverageEntry);
      if (!lines) {
        continue;
      }

      let file = filesByPath.get(sourcePath);
      if (!file) {
        file = {
          coveredLines: new Set<number>(),
          uncoveredLines: new Set<number>(),
        };
        filesByPath.set(sourcePath, file);
      }

      lines.forEach((hitCount, index) => {
        const lineNumber = index + 1;
        if (!Number.isInteger(hitCount)) {
          return;
        }

        if ((hitCount as number) > 0) {
          file.coveredLines.add(lineNumber);
          file.uncoveredLines.delete(lineNumber);
        } else if (!file.coveredLines.has(lineNumber)) {
          file.uncoveredLines.add(lineNumber);
        }
      });
    }
  }

  const files = [...filesByPath.entries()]
    .map(([sourcePath, file]) => ({
      sourcePath,
      coveredLines: [...file.coveredLines].sort((a, b) => a - b),
      uncoveredLines: [...file.uncoveredLines].sort((a, b) => a - b),
    }))
    .filter(
      (file) => file.coveredLines.length > 0 || file.uncoveredLines.length > 0,
    )
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

  const coveredLines = files.reduce(
    (total, file) => total + file.coveredLines.length,
    0,
  );
  const uncoveredLines = files.reduce(
    (total, file) => total + file.uncoveredLines.length,
    0,
  );
  const executableLines = coveredLines + uncoveredLines;

  return {
    files,
    totals: {
      coveredLines,
      executableLines,
      aggregateCoveragePercent: lineCoveragePercent(
        coveredLines,
        uncoveredLines,
      ),
    },
  };
}
