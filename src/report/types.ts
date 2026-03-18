import type { CoverageFormatType } from "../coverage-config";
import type {
  AggregatedReport,
  ReportSampleFile,
  ReportTotals,
} from "./aggregator";

export interface VerificationMetric {
  name: "coveredLines" | "executableLines" | "aggregateCoveragePercent";
  report: number;
  eyecov: number;
  match: boolean;
}

export interface VerificationResult {
  supported: boolean;
  matches: boolean | null;
  metrics: VerificationMetric[];
  warning?: string;
}

export interface ReportCliOutput {
  format: CoverageFormatType;
  artifactPath: string;
  workspaceRoot: string;
  parsed: boolean;
  filesDiscovered: number;
  totals: ReportTotals;
  verification: VerificationResult;
  samples: ReportSampleFile[];
  warnings: string[];
}

export type { AggregatedReport };
