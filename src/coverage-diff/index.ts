import { loadCoverageConfig } from "../coverage-config";
import {
  CoverageResolver,
  createAdaptersFromConfig,
  type ResolverCoverageResult,
} from "../coverage-resolver";
import { getGitDiffForRoot as getGitDiffForRootDefault } from "./git-diff";

export type CoverageDiffComparisonMode = "merge-base" | "direct";

export interface CoverageDiffOptions {
  workspaceRoots: string[];
  base: string;
  head?: string;
  comparison?: CoverageDiffComparisonMode;
  includeCoveredFiles?: boolean;
  contextLines?: number;
  limit?: number;
}

export interface CoverageDiffItemRegion {
  startLine: number;
  endLine: number;
  contextStartLine: number;
  contextEndLine: number;
}

export interface CoverageDiffItem {
  filePath: string;
  status: "covered" | "uncovered" | "missing" | "stale" | "unsupported";
  changedLineRanges?: Array<[number, number]>;
  coveredLines?: number[];
  uncoveredLines?: number[];
  uncoverableLines?: number[];
  nonExecutableChangedLines?: number[];
  uncoveredRegions?: CoverageDiffItemRegion[];
  lineCoveragePercent?: number | null;
  reason?: string;
}

export interface CoverageDiffResult {
  baseRef: string;
  headRef: string;
  comparisonMode: CoverageDiffComparisonMode;
  filesChanged: number;
  filesResolved: number;
  filesUncovered: number;
  filesMissingCoverage: number;
  filesStale: number;
  changedExecutableLines: number;
  changedCoveredLines: number;
  changedUncoveredLines: number;
  changedUncoverableLines: number;
  items: CoverageDiffItem[];
}

export interface GitDiffFile {
  repoRelativePath: string;
  absolutePath: string;
  diffStatus: "added" | "modified" | "renamed" | "unsupported";
  changedLineRanges: Array<[number, number]>;
  reason?: string;
}

export interface GitDiffResult {
  baseRef: string;
  headRef: string;
  comparisonMode: CoverageDiffComparisonMode;
  files: GitDiffFile[];
}

export interface CoverageDiffDependencies {
  getGitDiffForRoot?: (
    workspaceRoot: string,
    options: CoverageDiffOptions,
  ) => Promise<GitDiffResult>;
  getCoverageForFile?: (
    filePath: string,
    workspaceRoot: string,
  ) => Promise<ResolverCoverageResult>;
}

const STATUS_ORDER: Record<CoverageDiffItem["status"], number> = {
  uncovered: 0,
  missing: 1,
  stale: 2,
  unsupported: 3,
  covered: 4,
};

function getDefaultCoverageForFile(
  filePath: string,
  workspaceRoot: string,
): Promise<ResolverCoverageResult> {
  const config = loadCoverageConfig(workspaceRoot);
  const resolver = new CoverageResolver({
    workspaceRoots: [workspaceRoot],
    adapters: createAdaptersFromConfig(config),
  });
  return resolver.getCoverage(filePath);
}

function expandChangedLines(ranges: Array<[number, number]>): number[] {
  const lines: number[] = [];
  for (const [startLine, endLineExclusive] of ranges) {
    for (let line = startLine; line < endLineExclusive; line++) {
      lines.push(line);
    }
  }
  return lines;
}

function sortNumbers(values: Set<number>): number[] {
  return [...values].sort((a, b) => a - b);
}

function collapseRegions(
  lines: number[],
  contextLines: number,
): CoverageDiffItemRegion[] {
  if (lines.length === 0) {
    return [];
  }

  const regions: CoverageDiffItemRegion[] = [];
  let startLine = lines[0];
  let endLine = lines[0];
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (line === endLine + 1) {
      endLine = line;
      continue;
    }
    regions.push({
      startLine,
      endLine,
      contextStartLine: Math.max(1, startLine - contextLines),
      contextEndLine: endLine + contextLines,
    });
    startLine = line;
    endLine = line;
  }
  regions.push({
    startLine,
    endLine,
    contextStartLine: Math.max(1, startLine - contextLines),
    contextEndLine: endLine + contextLines,
  });
  return regions;
}

export async function getCoverageDiff(
  options: CoverageDiffOptions,
  dependencies: CoverageDiffDependencies = {},
): Promise<CoverageDiffResult> {
  const comparison = options.comparison ?? "merge-base";
  const head = options.head ?? "HEAD";
  const contextLines = options.contextLines ?? 2;
  const includeCoveredFiles = options.includeCoveredFiles ?? false;
  const limit = options.limit ?? 200;
  const getGitDiffForRoot =
    dependencies.getGitDiffForRoot ?? getGitDiffForRootDefault;
  const getCoverageForFile =
    dependencies.getCoverageForFile ?? getDefaultCoverageForFile;

  const allItems: CoverageDiffItem[] = [];
  const summary = {
    filesChanged: 0,
    filesResolved: 0,
    filesUncovered: 0,
    filesMissingCoverage: 0,
    filesStale: 0,
    changedExecutableLines: 0,
    changedCoveredLines: 0,
    changedUncoveredLines: 0,
    changedUncoverableLines: 0,
  };

  let baseRef = options.base;
  let headRef = head;
  let comparisonMode = comparison;

  // Collect files across all roots, deduplicating by absolutePath.
  // First root wins — prevents double-counting when roots overlap or share a repo.
  const seenAbsolutePaths = new Set<string>();
  const dedupedFiles: Array<{ file: GitDiffFile; workspaceRoot: string }> = [];
  let firstDiff = true;

  for (const workspaceRoot of options.workspaceRoots) {
    const diff = await getGitDiffForRoot(workspaceRoot, options);
    if (firstDiff) {
      baseRef = diff.baseRef;
      headRef = diff.headRef;
      comparisonMode = diff.comparisonMode;
      firstDiff = false;
    }
    for (const file of diff.files) {
      if (!seenAbsolutePaths.has(file.absolutePath)) {
        seenAbsolutePaths.add(file.absolutePath);
        dedupedFiles.push({ file, workspaceRoot });
      }
    }
  }

  for (const { file, workspaceRoot } of dedupedFiles) {
    summary.filesChanged += 1;

    if (file.diffStatus === "unsupported") {
      allItems.push({
        filePath: file.repoRelativePath,
        status: "unsupported",
        reason: file.reason ?? "Unsupported diff shape.",
      });
      continue;
    }

    const coverage = await getCoverageForFile(file.absolutePath, workspaceRoot);
    if (!coverage.record) {
      if (coverage.rejectReason === "stale") {
        summary.filesStale += 1;
        allItems.push({
          filePath: file.repoRelativePath,
          status: "stale",
          reason: "Coverage artifact is older than the source file.",
        });
        continue;
      }

      summary.filesMissingCoverage += 1;
      allItems.push({
        filePath: file.repoRelativePath,
        status: "missing",
        reason: "No configured coverage source resolved this file.",
      });
      continue;
    }

    const changedLines = expandChangedLines(file.changedLineRanges);
    const coveredLines = new Set<number>();
    const uncoveredLines = new Set<number>();
    const uncoverableLines = new Set<number>();
    const nonExecutableChangedLines = new Set<number>();

    for (const line of changedLines) {
      if (coverage.record.coveredLines.has(line)) {
        coveredLines.add(line);
      } else if (coverage.record.uncoveredLines.has(line)) {
        uncoveredLines.add(line);
      } else if (coverage.record.uncoverableLines.has(line)) {
        uncoverableLines.add(line);
      } else {
        nonExecutableChangedLines.add(line);
      }
    }

    const executableLineCount =
      coveredLines.size + uncoveredLines.size + uncoverableLines.size;
    const status: CoverageDiffItem["status"] =
      uncoveredLines.size > 0 ? "uncovered" : "covered";

    summary.filesResolved += 1;
    summary.changedExecutableLines += executableLineCount;
    summary.changedCoveredLines += coveredLines.size;
    summary.changedUncoveredLines += uncoveredLines.size;
    summary.changedUncoverableLines += uncoverableLines.size;
    if (status === "uncovered") {
      summary.filesUncovered += 1;
    }

    if (status === "covered" && !includeCoveredFiles) {
      continue;
    }

    const uncoveredSorted = sortNumbers(uncoveredLines);
    allItems.push({
      filePath: file.repoRelativePath,
      status,
      changedLineRanges: file.changedLineRanges,
      coveredLines: sortNumbers(coveredLines),
      uncoveredLines: uncoveredSorted,
      uncoverableLines: sortNumbers(uncoverableLines),
      nonExecutableChangedLines: sortNumbers(nonExecutableChangedLines),
      uncoveredRegions: collapseRegions(uncoveredSorted, contextLines),
      lineCoveragePercent: coverage.record.lineCoveragePercent,
    });
  }

  allItems.sort((left, right) => {
    const statusDifference =
      STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
    if (statusDifference !== 0) {
      return statusDifference;
    }
    return left.filePath.localeCompare(right.filePath);
  });

  return {
    baseRef,
    headRef,
    comparisonMode,
    ...summary,
    items: allItems.slice(0, limit),
  };
}

export { getGitDiffForRoot } from "./git-diff";
