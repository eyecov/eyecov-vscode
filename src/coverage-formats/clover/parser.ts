/**
 * Parser for Clover XML coverage format. Extracts per-file line coverage
 * from <file ...> blocks and <line num="..." count="..."/> entries.
 */

import {
  getAttribute,
  normalizeLineCoverage,
  parseInteger,
  parseXmlDocument,
  toArray,
  type XmlNode,
} from "../xml/shared";

export interface CloverFileRecord {
  sourcePath: string;
  coveredLines: number[];
  uncoveredLines: number[];
}

export interface CloverParseResult {
  files: CloverFileRecord[];
  totals: {
    coveredLines: number | null;
    executableLines: number | null;
    aggregateCoveragePercent: number | null;
  };
}

function collectFileNodes(root: unknown): XmlNode[] {
  const files: XmlNode[] = [];

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child);
      }
      return;
    }

    const objectNode = node as XmlNode;
    const hasLineEntries = toArray(objectNode.line).some(
      (lineNode) =>
        lineNode &&
        typeof lineNode === "object" &&
        !Array.isArray(lineNode) &&
        getAttribute(lineNode as XmlNode, "num") !== undefined,
    );
    const sourcePath =
      getAttribute(objectNode, "path") ?? getAttribute(objectNode, "name");
    if (sourcePath && hasLineEntries) {
      files.push(objectNode);
      return;
    }

    for (const [key, value] of Object.entries(objectNode)) {
      if (key === "$") {
        continue;
      }
      visit(value);
    }
  };

  visit(root);
  return files;
}

function parseLineEntries(fileNode: XmlNode): {
  coveredLines: number[];
  uncoveredLines: number[];
} {
  const rawLines = toArray(fileNode.line);
  const coveredLines: number[] = [];
  const uncoveredLines: number[] = [];

  for (const rawLine of rawLines) {
    if (!rawLine || typeof rawLine !== "object" || Array.isArray(rawLine)) {
      continue;
    }
    const lineNode = rawLine as XmlNode;
    const lineNum = parseInteger(getAttribute(lineNode, "num"));
    const count = parseInteger(getAttribute(lineNode, "count"));
    const type = getAttribute(lineNode, "type");
    if (lineNum === null || count === null || lineNum <= 0) {
      continue;
    }
    if (type !== undefined && type !== "stmt") {
      continue;
    }
    if (count > 0) {
      coveredLines.push(lineNum);
    } else {
      uncoveredLines.push(lineNum);
    }
  }

  return normalizeLineCoverage({ coveredLines, uncoveredLines });
}

export function parseCloverCoverage(xml: string): CloverParseResult {
  const coverageNode = parseXmlDocument(xml, "coverage");
  if (!coverageNode) {
    return {
      files: [],
      totals: {
        coveredLines: null,
        executableLines: null,
        aggregateCoveragePercent: null,
      },
    };
  }

  const filesBySourcePath = new Map<
    string,
    { coveredLines: number[]; uncoveredLines: number[] }
  >();

  for (const fileNode of collectFileNodes(coverageNode)) {
    const sourcePath =
      getAttribute(fileNode, "path") ?? getAttribute(fileNode, "name");
    if (!sourcePath) {
      continue;
    }
    const lineCoverage = parseLineEntries(fileNode);
    const existing = filesBySourcePath.get(sourcePath);
    if (!existing) {
      filesBySourcePath.set(sourcePath, lineCoverage);
    } else {
      existing.coveredLines.push(...lineCoverage.coveredLines);
      existing.uncoveredLines.push(...lineCoverage.uncoveredLines);
    }
  }

  const files = [...filesBySourcePath.entries()]
    .map(([sourcePath, lineCoverage]) => {
      const normalized = normalizeLineCoverage(lineCoverage);
      return {
        sourcePath,
        coveredLines: normalized.coveredLines,
        uncoveredLines: normalized.uncoveredLines,
      };
    })
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

  const projectNode =
    coverageNode.project && typeof coverageNode.project === "object"
      ? (coverageNode.project as XmlNode)
      : null;
  const metricsNode =
    projectNode?.metrics && typeof projectNode.metrics === "object"
      ? (projectNode.metrics as XmlNode)
      : null;
  const coveredLines = parseInteger(
    metricsNode ? getAttribute(metricsNode, "coveredstatements") : undefined,
  );
  const executableLines = parseInteger(
    metricsNode ? getAttribute(metricsNode, "statements") : undefined,
  );

  return {
    files,
    totals: {
      coveredLines,
      executableLines,
      aggregateCoveragePercent:
        coveredLines !== null && executableLines !== null && executableLines > 0
          ? Number(((coveredLines / executableLines) * 100).toFixed(2))
          : null,
    },
  };
}
