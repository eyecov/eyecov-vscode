import {
  getAttribute,
  lineCoveragePercent,
  parseInteger,
  parseXmlDocument,
  toArray,
  type XmlNode,
} from "../xml/shared";

export interface OpenCoverFileRecord {
  sourcePath: string;
  coveredLines: number[];
  uncoveredLines: number[];
}

export interface OpenCoverParseResult {
  files: OpenCoverFileRecord[];
  totals: {
    coveredLines: number | null;
    executableLines: number | null;
    aggregateCoveragePercent: number | null;
  };
}

export function parseOpenCoverXml(xml: string): OpenCoverParseResult {
  const root = parseXmlDocument(xml, "CoverageSession");
  if (!root) {
    return {
      files: [],
      totals: {
        coveredLines: null,
        executableLines: null,
        aggregateCoveragePercent: null,
      },
    };
  }

  const filesById = new Map<string, string>();
  const byFile = new Map<
    string,
    { coveredLines: Set<number>; uncoveredLines: Set<number> }
  >();
  const modules = toArray(
    (root.Modules as XmlNode | undefined)?.Module as
      | XmlNode
      | XmlNode[]
      | undefined,
  );

  for (const module of modules) {
    const filesNode = (module.Files as XmlNode | undefined)?.File;
    for (const fileNode of toArray(
      filesNode as XmlNode | XmlNode[] | undefined,
    )) {
      const uid = getAttribute(fileNode, "uid");
      const fullPath = getAttribute(fileNode, "fullPath");
      if (uid && fullPath) {
        filesById.set(uid, fullPath);
      }
    }

    const classNodes = toArray(
      (module.Classes as XmlNode | undefined)?.Class as
        | XmlNode
        | XmlNode[]
        | undefined,
    );
    for (const classNode of classNodes) {
      const methodNodes = toArray(
        (((classNode.Methods as XmlNode | undefined)?.Method as
          | XmlNode
          | XmlNode[]
          | undefined) ?? []) as XmlNode | XmlNode[] | undefined,
      );
      for (const methodNode of methodNodes) {
        const sequencePoints = toArray(
          (methodNode.SequencePoints as XmlNode | undefined)?.SequencePoint as
            | XmlNode
            | XmlNode[]
            | undefined,
        );
        for (const point of sequencePoints) {
          const fileId =
            getAttribute(point, "fileid") ?? getAttribute(point, "fileuid");
          const sourcePath = fileId ? filesById.get(fileId) : undefined;
          const line = parseInteger(getAttribute(point, "sl"));
          const visits = parseInteger(getAttribute(point, "vc")) ?? 0;
          if (!sourcePath || line === null) {
            continue;
          }
          const entry = byFile.get(sourcePath) ?? {
            coveredLines: new Set<number>(),
            uncoveredLines: new Set<number>(),
          };
          if (visits > 0) {
            entry.coveredLines.add(line);
            entry.uncoveredLines.delete(line);
          } else if (!entry.coveredLines.has(line)) {
            entry.uncoveredLines.add(line);
          }
          byFile.set(sourcePath, entry);
        }
      }
    }
  }

  const summaryNode = root.Summary as XmlNode | undefined;
  const coveredLines =
    parseInteger(getAttribute(summaryNode ?? {}, "visitedSequencePoints")) ??
    null;
  const executableLines =
    parseInteger(getAttribute(summaryNode ?? {}, "numSequencePoints")) ?? null;

  return {
    files: [...byFile.entries()]
      .map(([sourcePath, entry]) => ({
        sourcePath,
        coveredLines: [...entry.coveredLines].sort((a, b) => a - b),
        uncoveredLines: [...entry.uncoveredLines].sort((a, b) => a - b),
      }))
      .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)),
    totals: {
      coveredLines,
      executableLines,
      aggregateCoveragePercent:
        coveredLines !== null && executableLines !== null
          ? lineCoveragePercent(coveredLines, executableLines - coveredLines)
          : null,
    },
  };
}
