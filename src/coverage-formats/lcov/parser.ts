/**
 * Parser for LCOV coverage format. Extracts per-file line coverage from
 * lcov.info content (SF:, DA: lines). Used by LcovAdapter.
 */

export interface LcovFileRecord {
  sourceFile: string;
  coveredLines: number[];
  uncoveredLines: number[];
}

export function parseLcov(content: string): LcovFileRecord[] {
  const records: LcovFileRecord[] = [];
  const blocks = content.split("end_of_record");
  for (const block of blocks) {
    const lines = block.trim().split("\n").filter(Boolean);
    let sf: string | null = null;
    const covered: number[] = [];
    const uncovered: number[] = [];
    for (const line of lines) {
      if (line.startsWith("SF:")) {
        sf = line.slice(3).trim();
      } else if (line.startsWith("DA:")) {
        const rest = line.slice(3);
        const [lineNum, count] = rest.split(",").map((s) => parseInt(s, 10));
        if (Number.isInteger(lineNum) && Number.isInteger(count)) {
          if (count > 0) covered.push(lineNum);
          else uncovered.push(lineNum);
        }
      }
    }
    if (sf !== null) {
      records.push({
        sourceFile: sf,
        coveredLines: covered,
        uncoveredLines: uncovered,
      });
    }
  }
  return records;
}

export function lineCoveragePercent(
  covered: number,
  uncovered: number,
): number | null {
  const total = covered + uncovered;
  if (total === 0) return null;
  return Number(((covered / total) * 100).toFixed(2));
}
