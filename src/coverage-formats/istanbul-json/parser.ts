import { lineCoveragePercent } from "../xml/shared";
import {
  COVERAGE_ARTIFACT_LIMITS,
  CoverageArtifactError,
} from "../artifact-guardrails";

export interface IstanbulJsonFileRecord {
  sourcePath: string;
  coveredLines: number[];
  uncoveredLines: number[];
}

export interface IstanbulJsonParseResult {
  files: IstanbulJsonFileRecord[];
}

export function parseIstanbulJson(content: string): IstanbulJsonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return { files: [] };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { files: [] };
  }

  let statementCount = 0;
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    statementCount += Object.keys(
      (value as { statementMap?: Record<string, unknown> }).statementMap ?? {},
    ).length;

    if (statementCount > COVERAGE_ARTIFACT_LIMITS.maxIstanbulStatements) {
      throw new CoverageArtifactError(
        `Istanbul JSON artifact has too many statements (${statementCount}). Maximum supported statement count is ${COVERAGE_ARTIFACT_LIMITS.maxIstanbulStatements}.`,
      );
    }
  }

  const files = Object.entries(parsed as Record<string, unknown>)
    .map(([fallbackPath, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      const file = value as {
        path?: string;
        statementMap?: Record<string, { start?: { line?: number } }>;
        s?: Record<string, number>;
      };
      const covered = new Set<number>();
      const uncovered = new Set<number>();

      for (const [statementId, loc] of Object.entries(
        file.statementMap ?? {},
      )) {
        const line = loc.start?.line;
        const count = file.s?.[statementId];
        if (
          !Number.isInteger(line) ||
          typeof count !== "number" ||
          !Number.isInteger(count)
        ) {
          continue;
        }
        const normalizedLine = Number(line);
        if (count > 0) {
          covered.add(normalizedLine);
          uncovered.delete(normalizedLine);
        } else if (!covered.has(normalizedLine)) {
          uncovered.add(normalizedLine);
        }
      }

      return {
        sourcePath: file.path ?? fallbackPath,
        coveredLines: [...covered].sort((a, b) => a - b),
        uncoveredLines: [...uncovered].sort((a, b) => a - b),
      };
    })
    .filter((entry): entry is IstanbulJsonFileRecord => entry !== null)
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

  return { files };
}

export function istanbulJsonTotals(result: IstanbulJsonParseResult): {
  coveredLines: number;
  executableLines: number;
  aggregateCoveragePercent: number | null;
} {
  let coveredLines = 0;
  let executableLines = 0;
  for (const file of result.files) {
    coveredLines += file.coveredLines.length;
    executableLines += file.coveredLines.length + file.uncoveredLines.length;
  }
  return {
    coveredLines,
    executableLines,
    aggregateCoveragePercent: lineCoveragePercent(
      coveredLines,
      executableLines - coveredLines,
    ),
  };
}
