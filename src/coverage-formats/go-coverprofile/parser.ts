import { lineCoveragePercent } from "../xml/shared";

export interface GoCoverprofileFileRecord {
  sourcePath: string;
  coveredLines: number[];
  uncoveredLines: number[];
}

export interface GoCoverprofileParseResult {
  files: GoCoverprofileFileRecord[];
  totals: {
    coveredLines: number;
    executableLines: number;
    aggregateCoveragePercent: number | null;
  };
}

export function parseGoCoverprofile(
  content: string,
): GoCoverprofileParseResult {
  const byFile = new Map<
    string,
    { coveredLines: Set<number>; uncoveredLines: Set<number> }
  >();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("mode:")) {
      continue;
    }
    const match = line.match(/^(.+):(\d+)\.\d+,(\d+)\.\d+\s+\d+\s+(\d+)$/);
    if (!match) {
      continue;
    }
    const [, sourcePath, startLineRaw, endLineRaw, countRaw] = match;
    const startLine = Number.parseInt(startLineRaw, 10);
    const endLine = Number.parseInt(endLineRaw, 10);
    const count = Number.parseInt(countRaw, 10);
    if (
      !Number.isInteger(startLine) ||
      !Number.isInteger(endLine) ||
      !Number.isInteger(count)
    ) {
      continue;
    }

    const entry = byFile.get(sourcePath) ?? {
      coveredLines: new Set<number>(),
      uncoveredLines: new Set<number>(),
    };
    for (let currentLine = startLine; currentLine <= endLine; currentLine++) {
      if (count > 0) {
        entry.coveredLines.add(currentLine);
        entry.uncoveredLines.delete(currentLine);
      } else if (!entry.coveredLines.has(currentLine)) {
        entry.uncoveredLines.add(currentLine);
      }
    }
    byFile.set(sourcePath, entry);
  }

  const files = [...byFile.entries()]
    .map(([sourcePath, entry]) => ({
      sourcePath,
      coveredLines: [...entry.coveredLines].sort((a, b) => a - b),
      uncoveredLines: [...entry.uncoveredLines].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

  let coveredLines = 0;
  let executableLines = 0;
  for (const file of files) {
    coveredLines += file.coveredLines.length;
    executableLines += file.coveredLines.length + file.uncoveredLines.length;
  }

  return {
    files,
    totals: {
      coveredLines,
      executableLines,
      aggregateCoveragePercent: lineCoveragePercent(
        coveredLines,
        executableLines - coveredLines,
      ),
    },
  };
}
