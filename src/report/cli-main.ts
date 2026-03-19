import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  getCoverageDiff,
  type CoverageDiffComparisonMode,
  type CoverageDiffOptions,
} from "../coverage-diff";
import { renderHumanCoverageDiff } from "../coverage-diff/reporter-human";
import {
  SUPPORTED_FORMAT_TYPES,
  type CoverageFormatType,
} from "../coverage-config";
import { aggregateReportRecords } from "./aggregator";
import { loadCoverageArtifact } from "./artifact-loader";
import { detectCoverageFormat } from "./format-detector";
import { renderHumanReport } from "./reporter-human";
import { renderJsonReport } from "./reporter-json";
import { createTheme, shouldUseColor } from "./theme";
import type { ReportCliOutput, VerificationResult } from "./types";
import { verifyLoadedArtifact } from "./verifier";

export type MainDependencies = {
  args?: string[];
  stdout?: Pick<NodeJS.WriteStream, "write" | "isTTY">;
  stderr?: Pick<NodeJS.WriteStream, "write" | "isTTY">;
  detectCoverageFormatImpl?: typeof detectCoverageFormat;
  loadCoverageArtifactImpl?: typeof loadCoverageArtifact;
  getCoverageDiffImpl?: typeof getCoverageDiff;
};

const SUPPORTED_FORMAT_OPTIONS = ["auto", ...SUPPORTED_FORMAT_TYPES] as const;
const SUPPORTED_THEME_OPTIONS = ["auto", "dark", "light"] as const;

function isSupportedFormatOption(
  value: string,
): value is (typeof SUPPORTED_FORMAT_OPTIONS)[number] {
  return (SUPPORTED_FORMAT_OPTIONS as readonly string[]).includes(value);
}

function isCoverageFormatType(value: string): value is CoverageFormatType {
  return (SUPPORTED_FORMAT_TYPES as readonly string[]).includes(value);
}

function isSupportedThemeOption(value: string): boolean {
  return (SUPPORTED_THEME_OPTIONS as readonly string[]).includes(value);
}

function isCoverageDiffComparisonMode(
  value: string,
): value is CoverageDiffComparisonMode {
  return value === "merge-base" || value === "direct";
}

function createNoVerificationResult(): VerificationResult {
  return {
    supported: false,
    matches: null,
    metrics: [],
    warning: "Verification not requested.",
  };
}

export async function runReportCli(
  dependencies: MainDependencies = {},
): Promise<number> {
  const {
    args = process.argv.slice(2),
    stdout = process.stdout,
    stderr = process.stderr,
    detectCoverageFormatImpl = detectCoverageFormat,
    loadCoverageArtifactImpl = loadCoverageArtifact,
    getCoverageDiffImpl = getCoverageDiff,
  } = dependencies;
  let parsed: ReturnType<typeof parseArgs>;

  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      options: {
        path: {
          type: "string",
        },
        diff: {
          type: "string",
        },
        head: {
          type: "string",
        },
        comparison: {
          type: "string",
          default: "merge-base",
        },
        "include-covered-files": {
          type: "boolean",
          default: false,
        },
        "context-lines": {
          type: "string",
          default: "2",
        },
        format: {
          type: "string",
          default: "auto",
        },
        "workspace-root": {
          type: "string",
        },
        json: {
          type: "boolean",
          default: false,
        },
        "verify-report-totals": {
          type: "boolean",
          default: false,
        },
        "sample-files": {
          type: "string",
          default: "10",
        },
        theme: {
          type: "string",
          default: "auto",
        },
        "no-color": {
          type: "boolean",
          default: false,
        },
      },
      strict: true,
    });

    const diffValue =
      typeof parsed.values.diff === "string" ? parsed.values.diff : "";
    if (!diffValue && !parsed.values.path) {
      stderr.write("Missing required --path <artifact>\n");
      return 3;
    }

    const formatValue =
      typeof parsed.values.format === "string" ? parsed.values.format : "";
    if (!isSupportedFormatOption(formatValue)) {
      stderr.write(`Invalid --format value: ${String(parsed.values.format)}\n`);
      return 3;
    }

    const themeValue =
      typeof parsed.values.theme === "string" ? parsed.values.theme : "";
    if (!isSupportedThemeOption(themeValue)) {
      stderr.write(`Invalid --theme value: ${String(parsed.values.theme)}\n`);
      return 3;
    }

    const comparisonValue =
      typeof parsed.values.comparison === "string"
        ? parsed.values.comparison
        : "";
    if (!isCoverageDiffComparisonMode(comparisonValue)) {
      stderr.write(
        `Invalid --comparison value: ${String(parsed.values.comparison)}\n`,
      );
      return 3;
    }

    const sampleFilesValue =
      typeof parsed.values["sample-files"] === "string"
        ? parsed.values["sample-files"]
        : "";
    const sampleFiles = Number(sampleFilesValue);
    if (!Number.isInteger(sampleFiles) || sampleFiles < 0) {
      stderr.write(
        "Invalid --sample-files value; expected a non-negative integer.\n",
      );
      return 3;
    }

    const contextLinesValue =
      typeof parsed.values["context-lines"] === "string"
        ? parsed.values["context-lines"]
        : "";
    const contextLines = Number(contextLinesValue);
    if (!Number.isInteger(contextLines) || contextLines < 0) {
      stderr.write(
        "Invalid --context-lines value; expected a non-negative integer.\n",
      );
      return 3;
    }
  } catch (error) {
    stderr.write(
      `${error instanceof Error ? error.message : "Invalid CLI arguments"}\n`,
    );
    return 3;
  }

  try {
    const diffBase =
      typeof parsed.values.diff === "string" ? parsed.values.diff : "";
    const headRef =
      typeof parsed.values.head === "string" ? parsed.values.head : "HEAD";
    const comparison =
      typeof parsed.values.comparison === "string" &&
      isCoverageDiffComparisonMode(parsed.values.comparison)
        ? parsed.values.comparison
        : "merge-base";
    const includeCoveredFiles = parsed.values["include-covered-files"] === true;
    const contextLinesValue =
      typeof parsed.values["context-lines"] === "string"
        ? parsed.values["context-lines"]
        : "";
    const contextLines = Number(contextLinesValue);
    const sampleFilesValue =
      typeof parsed.values["sample-files"] === "string"
        ? parsed.values["sample-files"]
        : "";
    const sampleFiles = Number(sampleFilesValue);
    if (!Number.isInteger(sampleFiles) || sampleFiles < 0) {
      stderr.write(
        "Invalid --sample-files value; expected a non-negative integer.\n",
      );
      return 3;
    }

    const workspaceRootValue =
      typeof parsed.values["workspace-root"] === "string"
        ? parsed.values["workspace-root"]
        : process.cwd();
    const workspaceRoot = path.resolve(workspaceRootValue);
    const verifyReportTotals = parsed.values["verify-report-totals"] === true;
    const jsonOutput = parsed.values.json === true;
    const noColor = parsed.values["no-color"] === true;

    if (diffBase) {
      const output = await getCoverageDiffImpl({
        workspaceRoots: [workspaceRoot],
        base: diffBase,
        head: headRef,
        comparison,
        includeCoveredFiles,
        contextLines,
      } satisfies CoverageDiffOptions);

      if (jsonOutput) {
        stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      } else {
        stdout.write(renderHumanCoverageDiff(output));
      }

      return 0;
    }

    const pathValue =
      typeof parsed.values.path === "string" ? parsed.values.path : "";
    const artifactPath = path.resolve(pathValue);
    if (!fs.existsSync(artifactPath)) {
      stderr.write(`Coverage artifact not found: ${artifactPath}\n`);
      return 1;
    }

    const formatValue =
      typeof parsed.values.format === "string" ? parsed.values.format : "";
    const detectedFormat =
      formatValue === "auto"
        ? detectCoverageFormatImpl(artifactPath)
        : formatValue;

    if (!detectedFormat || !isCoverageFormatType(detectedFormat)) {
      stderr.write(
        `Unsupported or unknown coverage artifact: ${artifactPath}. Try --format.\n`,
      );
      return 1;
    }

    const loaded = await loadCoverageArtifactImpl({
      artifactPath,
      format: detectedFormat,
      workspaceRoot,
    });
    const aggregated = aggregateReportRecords(loaded.records, sampleFiles);
    const verification = verifyReportTotals
      ? verifyLoadedArtifact(loaded, aggregated)
      : createNoVerificationResult();

    const output: ReportCliOutput = {
      format: loaded.format,
      artifactPath: loaded.artifactPath,
      workspaceRoot: loaded.workspaceRoot,
      parsed: true,
      filesDiscovered: aggregated.filesDiscovered,
      totals: aggregated.totals,
      verification,
      samples: aggregated.samples,
      warnings: verifyReportTotals
        ? [
            ...loaded.warnings,
            ...(verification.warning ? [verification.warning] : []),
          ]
        : loaded.warnings,
    };

    if (jsonOutput) {
      stdout.write(`${renderJsonReport(output)}\n`);
    } else {
      const theme = createTheme(
        shouldUseColor({
          stdoutIsTTY: Boolean(stdout.isTTY),
          noColor,
          noColorEnv: process.env.NO_COLOR,
        }),
      );
      stdout.write(renderHumanReport(output, theme));
    }

    return verifyReportTotals &&
      verification.supported &&
      verification.matches === false
      ? 2
      : 0;
  } catch (error) {
    stderr.write(
      `${error instanceof Error ? error.message : "Artifact load failure"}\n`,
    );
    return 1;
  }
}
