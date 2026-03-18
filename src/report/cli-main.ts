import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
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

    if (!parsed.values.path) {
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
  } catch (error) {
    stderr.write(
      `${error instanceof Error ? error.message : "Invalid CLI arguments"}\n`,
    );
    return 3;
  }

  try {
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

    const pathValue =
      typeof parsed.values.path === "string" ? parsed.values.path : "";
    const artifactPath = path.resolve(pathValue);
    if (!fs.existsSync(artifactPath)) {
      stderr.write(`Coverage artifact not found: ${artifactPath}\n`);
      return 1;
    }

    const workspaceRootValue =
      typeof parsed.values["workspace-root"] === "string"
        ? parsed.values["workspace-root"]
        : process.cwd();
    const workspaceRoot = path.resolve(workspaceRootValue);
    const formatValue =
      typeof parsed.values.format === "string" ? parsed.values.format : "";
    const detectedFormat =
      formatValue === "auto"
        ? detectCoverageFormatImpl(artifactPath)
        : formatValue;
    const verifyReportTotals = parsed.values["verify-report-totals"] === true;
    const jsonOutput = parsed.values.json === true;
    const noColor = parsed.values["no-color"] === true;

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
