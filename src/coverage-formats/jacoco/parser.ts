import {
  getAttribute,
  lineCoveragePercent,
  parseInteger,
  parseXmlDocument,
  toArray,
  type XmlNode,
} from "../xml/shared";

export interface JacocoFileRecord {
  sourcePath: string;
  coveredLines: number[];
  uncoveredLines: number[];
}

export interface JacocoParseResult {
  files: JacocoFileRecord[];
  totals: {
    coveredLines: number | null;
    executableLines: number | null;
    aggregateCoveragePercent: number | null;
  };
}

function getLineCounter(node: XmlNode): {
  coveredLines: number | null;
  executableLines: number | null;
  aggregateCoveragePercent: number | null;
} {
  for (const counter of toArray(
    node.counter as XmlNode | XmlNode[] | undefined,
  )) {
    if (getAttribute(counter, "type") !== "LINE") {
      continue;
    }
    const coveredLines = parseInteger(getAttribute(counter, "covered"));
    const missedLines = parseInteger(getAttribute(counter, "missed"));
    const executableLines =
      coveredLines !== null && missedLines !== null
        ? coveredLines + missedLines
        : null;
    return {
      coveredLines,
      executableLines,
      aggregateCoveragePercent:
        coveredLines !== null && executableLines !== null
          ? lineCoveragePercent(coveredLines, executableLines - coveredLines)
          : null,
    };
  }

  return {
    coveredLines: null,
    executableLines: null,
    aggregateCoveragePercent: null,
  };
}

export function parseJaCoCoXml(xml: string): JacocoParseResult {
  const report = parseXmlDocument(xml, "report");
  if (!report) {
    return {
      files: [],
      totals: {
        coveredLines: null,
        executableLines: null,
        aggregateCoveragePercent: null,
      },
    };
  }

  const files: JacocoFileRecord[] = [];
  for (const pkg of toArray(
    report.package as XmlNode | XmlNode[] | undefined,
  )) {
    const packageName = getAttribute(pkg, "name") ?? "";
    for (const sourceFile of toArray(
      pkg.sourcefile as XmlNode | XmlNode[] | undefined,
    )) {
      const sourceName = getAttribute(sourceFile, "name");
      if (!sourceName) {
        continue;
      }
      const coveredLines = new Set<number>();
      const uncoveredLines = new Set<number>();
      for (const line of toArray(
        sourceFile.line as XmlNode | XmlNode[] | undefined,
      )) {
        const nr = parseInteger(getAttribute(line, "nr"));
        const ci = parseInteger(getAttribute(line, "ci")) ?? 0;
        const mi = parseInteger(getAttribute(line, "mi")) ?? 0;
        if (nr === null) {
          continue;
        }
        if (ci > 0) {
          coveredLines.add(nr);
          uncoveredLines.delete(nr);
        } else if (mi > 0 && !coveredLines.has(nr)) {
          uncoveredLines.add(nr);
        }
      }
      files.push({
        sourcePath: packageName ? `${packageName}/${sourceName}` : sourceName,
        coveredLines: [...coveredLines].sort((a, b) => a - b),
        uncoveredLines: [...uncoveredLines].sort((a, b) => a - b),
      });
    }
  }

  return {
    files,
    totals: getLineCounter(report),
  };
}
