/**
 * Maps CoverageRecord to CoverageData for the editor.
 * Extracted so recordToCoverageData can be unit tested.
 */

import path from "node:path";
import type { CoverageRecord } from "./coverage-resolver";
import type { CoverageData } from "./coverage-types";
import { LINE_STATUS } from "./coverage-types";

/** Options for computing which lines get which decorations. */
export interface DecorationPlanOptions {
  showCovered: boolean;
  showUncovered: boolean;
  showLineCoverage: boolean;
  showGutterCoverage: boolean;
  totalLines: number;
}

/** Line numbers per decoration category; byStatus used in granular mode. */
export interface DecorationPlan {
  useGranular: boolean;
  covered: number[];
  uncovered: number[];
  uncoverable: number[];
  byStatus?: Map<number, number[]>;
}

/** Status bar content; backgroundColor is a VS Code theme color id when set. */
export interface StatusBarContent {
  text: string;
  tooltip: string;
  backgroundColor?: string;
  show: boolean;
}

/** Context when there is no coverage data (for status bar messaging). */
export interface StatusBarNoCoverageContext {
  hasSource: boolean;
  /** Why coverage is missing: stale = source newer than report; no-artifact = no report for file. */
  noCoverageReason?: "no-artifact" | "stale";
  workspaceFolder?: string;
  activeFilePath?: string;
}

/** Options for status bar content. */
export interface StatusBarContentOptions {
  coverageEnabled: boolean;
  noCoverageContext?: StatusBarNoCoverageContext;
}

/**
 * Pure function: status bar text, tooltip, and optional theme color id.
 * Extension assigns these to the status bar item; use ThemeColor(backgroundColor) when set.
 */
export function getStatusBarContent(
  coverage: CoverageData | null,
  options: StatusBarContentOptions,
): StatusBarContent {
  const { coverageEnabled, noCoverageContext } = options;
  const hasSource = noCoverageContext?.hasSource ?? false;

  if (!coverageEnabled) {
    return {
      text: "$(test-view-icon) Coverage (off)",
      tooltip: "EyeCov: Click to toggle coverage display",
      show: true,
    };
  }

  if (!coverage) {
    if (!hasSource) {
      return {
        text: "$(test-view-icon) Coverage: no source",
        tooltip:
          "EyeCov: No coverage config (PHPUnit HTML or LCOV). Add .eyecov.json or coverage artifacts.",
        show: true,
      };
    }
    const reason = noCoverageContext?.noCoverageReason;
    if (reason === "stale") {
      return {
        text: "$(test-view-icon) Coverage: invalidated",
        tooltip:
          "EyeCov: Coverage report is older than the source file. Re-run tests to refresh.",
        backgroundColor: "statusBarItem.errorBackground",
        show: true,
      };
    }
    const relPath = formatRelativePath(
      noCoverageContext?.workspaceFolder,
      noCoverageContext?.activeFilePath,
    );
    return {
      text: "$(test-view-icon) No coverage",
      tooltip: `EyeCov: No coverage data for this file${relPath ? ` (${noCoverageContext?.activeFilePath})` : ""}. Click to toggle coverage display.`,
      show: true,
    };
  }

  const percent = coverage.file.lineCoveragePercent;
  const coveredCount = coverage.file.coveredLines ?? coverage.coveredLines.size;
  const total = coverage.file.totalLines ?? 0;
  const sourceLabel = coverage.file.sourceFormat ?? "coverage";
  const relPath = formatRelativePath(
    noCoverageContext?.workspaceFolder,
    coverage.file.sourceFile,
  );
  const sourcePart = ` [${sourceLabel}]`;

  const tooltipLines = [
    `Coverage: ${percent != null ? `${percent.toFixed(1)}%` : "N/A"}`,
    `Source: ${sourceLabel}`,
    relPath ? `File: ${relPath}` : null,
    `Covered lines: ${coveredCount}`,
    `Total lines: ${coverage.file.totalLines ?? total}`,
    "Click to toggle coverage display",
  ].filter(Boolean);
  const tooltip = tooltipLines.join("\n");

  if (percent === null || percent === undefined) {
    return {
      text: `$(test-view-icon) N/A${sourcePart}`,
      tooltip,
      show: true,
    };
  }

  let backgroundColor: string | undefined;
  if (percent >= 80) {
    backgroundColor = "statusBarItem.prominentBackground";
  } else if (percent >= 50) {
    backgroundColor = "statusBarItem.warningBackground";
  } else {
    backgroundColor = "statusBarItem.errorBackground";
  }
  return {
    text: `$(test-view-icon) ${percent.toFixed(1)}% (${coveredCount}/${total})${sourcePart}`,
    tooltip,
    backgroundColor,
    show: true,
  };
}

function formatRelativePath(
  workspaceFolder: string | undefined,
  filePath: string | undefined,
): string {
  if (!workspaceFolder || !filePath) return "";
  try {
    const rel = path.relative(workspaceFolder, filePath);
    return rel.startsWith("..") ? path.basename(filePath) : rel;
  } catch {
    return "";
  }
}

/**
 * Pure function: which line numbers get which decoration.
 * Extension uses this then maps line numbers to Ranges via document.lineAt.
 */
export function getDecorationPlan(
  coverage: CoverageData,
  options: DecorationPlanOptions,
): DecorationPlan {
  const { totalLines, showCovered, showUncovered } = options;
  const inRange = (n: number) => n >= 1 && n <= totalLines;
  const covered = [...coverage.coveredLines]
    .filter(inRange)
    .sort((a, b) => a - b);
  const uncovered = [...coverage.uncoveredLines]
    .filter(inRange)
    .sort((a, b) => a - b);
  const uncoverable = [...coverage.uncoverableLines]
    .filter(inRange)
    .sort((a, b) => a - b);
  const byStatus = getLinesByStatusCode(coverage);
  const statusKeys = [...byStatus.keys()];
  const useGranular =
    statusKeys.some(
      (k) =>
        k === LINE_STATUS.COVERED_LARGE ||
        k === LINE_STATUS.WARNING ||
        k === LINE_STATUS.UNCOVERABLE,
    ) || statusKeys.length > 2;

  if (!useGranular) {
    return {
      useGranular: false,
      covered: showCovered ? covered : [],
      uncovered: showUncovered ? uncovered : [],
      uncoverable: showUncovered ? uncoverable : [],
    };
  }

  const filteredByStatus = new Map<number, number[]>();
  const coveredStatuses = [
    LINE_STATUS.COVERED_SMALL,
    LINE_STATUS.COVERED_MEDIUM,
    LINE_STATUS.COVERED_LARGE,
  ];
  const uncoveredStatuses = [
    LINE_STATUS.UNCOVERED,
    LINE_STATUS.WARNING,
    LINE_STATUS.UNCOVERABLE,
  ];
  for (const [code, lines] of byStatus as Map<number, number[]>) {
    const filtered = lines.filter(inRange);
    if (
      coveredStatuses.includes(code as (typeof coveredStatuses)[number]) &&
      showCovered
    ) {
      filteredByStatus.set(code, filtered);
    } else if (
      uncoveredStatuses.includes(code as (typeof uncoveredStatuses)[number]) &&
      showUncovered
    ) {
      filteredByStatus.set(code, filtered);
    }
  }
  return {
    useGranular: true,
    covered: showCovered ? covered : [],
    uncovered: showUncovered ? uncovered : [],
    uncoverable: showUncovered ? uncoverable : [],
    byStatus: filteredByStatus,
  };
}

export function recordToCoverageData(record: CoverageRecord): CoverageData {
  const totalLines = record.coveredLines.size + record.uncoveredLines.size;
  const lineStatuses =
    record.lineStatuses != null && record.lineStatuses.size > 0
      ? new Map(record.lineStatuses)
      : (() => {
          const m = new Map<number, number>();
          for (const line of record.coveredLines)
            m.set(line, LINE_STATUS.COVERED_SMALL);
          for (const line of record.uncoveredLines)
            m.set(line, LINE_STATUS.UNCOVERED);
          return m;
        })();
  return {
    file: {
      fileId: 0,
      sourceFile: record.sourcePath,
      lineCoveragePercent: record.lineCoveragePercent,
      totalLines,
      coveredLines: record.coveredLines.size,
      sourceFormat: record.sourceFormat,
    },
    coveredLines: record.coveredLines,
    uncoveredLines: record.uncoveredLines,
    uncoverableLines: record.uncoverableLines,
    lineStatuses,
  };
}

/** Group line numbers by status code for decoration lookup. Returns Map<statusCode, lineNumbers[]>. */
export function getLinesByStatusCode(
  coverage: CoverageData,
): Map<number, number[]> {
  const byStatus = new Map<number, number[]>();
  for (const [line, code] of coverage.lineStatuses) {
    const list = byStatus.get(code) ?? [];
    list.push(line);
    byStatus.set(code, list);
  }
  for (const list of byStatus.values()) {
    list.sort((a, b) => a - b);
  }
  return byStatus;
}
