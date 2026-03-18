import path from "node:path";
import { Parser } from "xml2js";

export interface XmlLineCoverage {
  coveredLines: number[];
  uncoveredLines: number[];
}

export type XmlNode = Record<string, unknown>;

export function getSharedArtifactPaths(
  workspaceRoots: string[],
  artifactPath: string,
): string[] {
  return workspaceRoots.map((root) => path.resolve(root, artifactPath));
}

export function resolveCoverageSourcePath(
  workspaceRoot: string,
  sourcePath: string,
): string {
  return path.isAbsolute(sourcePath)
    ? path.normalize(sourcePath)
    : path.resolve(workspaceRoot, sourcePath);
}

export function lineCoveragePercent(
  covered: number,
  uncovered: number,
): number | null {
  const total = covered + uncovered;
  if (total === 0) return null;
  return Number(((covered / total) * 100).toFixed(2));
}

export function normalizeLineCoverage(
  input: XmlLineCoverage,
): XmlLineCoverage & {
  coveredLines: number[];
  uncoveredLines: number[];
  lineCoveragePercent: number | null;
} {
  const covered = new Set<number>();
  const uncovered = new Set<number>();

  for (const line of input.coveredLines) {
    if (Number.isInteger(line) && line > 0) {
      covered.add(line);
    }
  }
  for (const line of input.uncoveredLines) {
    if (!Number.isInteger(line) || line <= 0 || covered.has(line)) {
      continue;
    }
    uncovered.add(line);
  }

  const coveredLines = [...covered].sort((a, b) => a - b);
  const uncoveredLines = [...uncovered].sort((a, b) => a - b);

  return {
    coveredLines,
    uncoveredLines,
    lineCoveragePercent: lineCoveragePercent(
      coveredLines.length,
      uncoveredLines.length,
    ),
  };
}

export function lineTestsNotSupportedMessage(formatLabel: string): string {
  return `Covering tests not supported for the ${formatLabel} coverage format.`;
}

export function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function getNodeText(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const node = value as Record<string, unknown>;
    if (typeof node._ === "string") {
      return node._.trim();
    }
  }
  return null;
}

export function getAttribute(node: XmlNode, key: string): string | undefined {
  const attrs = node.$ as XmlNode | undefined;
  const fromAttrs =
    attrs && typeof attrs[key] === "string" ? attrs[key] : undefined;
  if (fromAttrs) {
    return fromAttrs;
  }
  const direct = node[key];
  return typeof direct === "string" ? direct : undefined;
}

export function parseInteger(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export function parseXmlDocument(xml: string, rootKey: string): XmlNode | null {
  if (!xml || !xml.trim()) {
    return null;
  }

  let parsed: unknown;
  try {
    const parser = new Parser({
      explicitArray: false,
      explicitRoot: true,
      mergeAttrs: false,
      trim: true,
      normalize: false,
    });
    parser.parseString(xml, (err: Error | null, result: unknown) => {
      if (err) {
        throw err;
      }
      parsed = result;
    });
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const rootNode = (parsed as XmlNode)[rootKey];
  if (!rootNode || typeof rootNode !== "object" || Array.isArray(rootNode)) {
    return null;
  }

  return rootNode as XmlNode;
}
