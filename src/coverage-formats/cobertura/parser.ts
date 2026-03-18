/**
 * Parser for Cobertura XML coverage reports.
 *
 * Supports the common Cobertura shape:
 * - <coverage>
 * - <sources><source>...</source></sources>
 * - <packages><package><classes><class filename="..."><lines><line .../></lines>
 *
 * The parser is intentionally defensive: malformed XML returns an empty result
 * instead of throwing.
 */

import {
  getAttribute,
  getNodeText,
  normalizeLineCoverage,
  parseInteger,
  parseXmlDocument,
  toArray,
  type XmlNode,
} from "../xml/shared";

export interface CoberturaFileRecord {
  sourcePath: string;
  coveredLines: number[];
  uncoveredLines: number[];
}

export interface CoberturaParseResult {
  sourceRoots: string[];
  files: CoberturaFileRecord[];
  totals: {
    coveredLines: number | null;
    executableLines: number | null;
    aggregateCoveragePercent: number | null;
  };
}

function collectSourceRoots(coverageNode: XmlNode): string[] {
  const sourcesNode = coverageNode.sources;
  if (!sourcesNode || typeof sourcesNode !== "object") {
    return [];
  }
  const rawSources = toArray((sourcesNode as XmlNode).source);
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const rawSource of rawSources) {
    const text = getNodeText(rawSource);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    roots.push(text);
  }
  return roots;
}

function collectClassNodes(root: unknown): XmlNode[] {
  const classes: XmlNode[] = [];
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
    const filename = getAttribute(objectNode, "filename");
    if (filename) {
      classes.push(objectNode);
    }

    for (const [key, value] of Object.entries(objectNode)) {
      if (key === "$") {
        continue;
      }
      visit(value);
    }
  };

  visit(root);
  return classes;
}

function parseLineEntries(classNode: XmlNode): {
  coveredLines: number[];
  uncoveredLines: number[];
} {
  const linesNode = classNode.lines;
  const rawLines =
    linesNode && typeof linesNode === "object"
      ? toArray((linesNode as XmlNode).line)
      : toArray(classNode.line);

  const coveredLines: number[] = [];
  const uncoveredLines: number[] = [];

  for (const rawLine of rawLines) {
    if (!rawLine || typeof rawLine !== "object" || Array.isArray(rawLine)) {
      continue;
    }
    const lineNode = rawLine as XmlNode;
    const lineNumber = parseInteger(getAttribute(lineNode, "number"));
    const hits = parseInteger(getAttribute(lineNode, "hits"));
    if (lineNumber === null || lineNumber <= 0 || hits === null) {
      continue;
    }
    if (hits > 0) {
      coveredLines.push(lineNumber);
    } else {
      uncoveredLines.push(lineNumber);
    }
  }

  return normalizeLineCoverage({ coveredLines, uncoveredLines });
}

/**
 * Parse Cobertura XML. Returns source roots plus one record per resolved source file.
 * Invalid or malformed XML returns an empty result.
 */
export function parseCoberturaXml(xml: string): CoberturaParseResult {
  const coverageNode = parseXmlDocument(xml, "coverage");
  if (!coverageNode) {
    return {
      sourceRoots: [],
      files: [],
      totals: {
        coveredLines: null,
        executableLines: null,
        aggregateCoveragePercent: null,
      },
    };
  }

  const sourceRoots = collectSourceRoots(coverageNode as XmlNode);
  const classNodes = collectClassNodes(coverageNode);
  const filesBySourcePath = new Map<
    string,
    { coveredLines: number[]; uncoveredLines: number[] }
  >();

  for (const classNode of classNodes) {
    const sourcePath = getAttribute(classNode, "filename");
    if (!sourcePath) {
      continue;
    }
    const lineCoverage = parseLineEntries(classNode);
    const existing = filesBySourcePath.get(sourcePath);
    if (!existing) {
      filesBySourcePath.set(sourcePath, lineCoverage);
    } else {
      existing.coveredLines.push(...lineCoverage.coveredLines);
      existing.uncoveredLines.push(...lineCoverage.uncoveredLines);
    }
  }

  const files = [...filesBySourcePath.entries()]
    .map(([sourcePath, lineCoverage]) => ({
      sourcePath,
      ...normalizeLineCoverage(lineCoverage),
    }))
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

  const coveredLines = parseInteger(
    getAttribute(coverageNode, "lines-covered"),
  );
  const executableLines = parseInteger(
    getAttribute(coverageNode, "lines-valid"),
  );
  const lineRate = Number.parseFloat(
    getAttribute(coverageNode, "line-rate") ?? "",
  );

  return {
    sourceRoots,
    files,
    totals: {
      coveredLines,
      executableLines,
      aggregateCoveragePercent: Number.isFinite(lineRate)
        ? Number((lineRate * 100).toFixed(2))
        : null,
    },
  };
}
