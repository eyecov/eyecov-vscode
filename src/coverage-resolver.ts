/**
 * Runtime seam: resolver, adapters, and normalized coverage record.
 * File-open coverage flows through the resolver so sources are pluggable and testable.
 * Adapters live in coverage-formats/; this module re-exports them for convenience.
 */

import path from "node:path";
import type { CovfluxConfig, CovfluxFormatType } from "./covflux-config";
import { PhpUnitHtmlAdapter } from "./coverage-formats/phpunit-html";
import { LcovAdapter } from "./coverage-formats/lcov";

/** Why coverage was not returned (when record is null). */
export type CoverageRejectReason = "no-artifact" | "stale";

/** Normalized coverage for the editor. No vscode or DB types. */
export interface CoverageRecord {
  sourcePath: string;
  coveredLines: Set<number>;
  uncoveredLines: Set<number>;
  uncoverableLines: Set<number>;
  lineCoveragePercent: number | null;
  /** Source format that produced this record (e.g. 'phpunit-html', 'lcov'). */
  sourceFormat?: CovfluxFormatType;
  /** Set by PHPUnit HTML adapter; omitted for LCOV. */
  coverageHtmlPath?: string;
  /** Set by PHPUnit HTML adapter for per-line test data; omitted for LCOV. */
  testsByLine?: Map<number, string[]>;
  /** Per-line status codes (LINE_STATUS.*); set by PHPUnit HTML adapter, omitted for LCOV. */
  lineStatuses?: Map<number, number>;
}

/** Result from an adapter: record or null with optional reason. */
export interface AdapterCoverageResult {
  record: CoverageRecord | null;
  /** When record is null, why (stale = source newer than artifact; no-artifact = no file found). */
  rejectReason?: CoverageRejectReason;
}

/** Adapter: given a file path and workspace roots, return a result. */
export interface CoverageAdapter {
  getCoverage(
    filePath: string,
    workspaceRoots: string[],
  ): Promise<AdapterCoverageResult>;
}

export interface CoverageResolverOptions {
  workspaceRoots: string[];
  adapters: CoverageAdapter[];
  /** When set (e.g. when covflux.debug is true), log adapter tries and which adapter resolved. */
  debugLog?: (message: string) => void;
  /** Labels for each adapter (e.g. ['phpunit-html', 'lcov']) for debug output. */
  adapterLabels?: string[];
}

/** Result from resolver: record (with sourceFormat) or null with optional rejectReason. */
export interface ResolverCoverageResult {
  record: CoverageRecord | null;
  rejectReason?: CoverageRejectReason;
  sourceFormat?: CovfluxFormatType;
}

/** Tries adapters in order; returns first non-null record. */
export class CoverageResolver {
  constructor(private readonly options: CoverageResolverOptions) {}

  async getCoverage(filePath: string): Promise<ResolverCoverageResult> {
    const normalizedPath = path.resolve(filePath);
    const { adapters, debugLog, adapterLabels } = this.options;
    let lastRejectReason: CoverageRejectReason | undefined;
    for (let i = 0; i < adapters.length; i++) {
      const label = adapterLabels?.[i] ?? `adapter ${i}`;
      if (debugLog) {
        debugLog(
          `[resolver] trying ${label} for ${path.basename(normalizedPath)}`,
        );
      }
      const result = await adapters[i].getCoverage(
        normalizedPath,
        this.options.workspaceRoots,
      );
      if (result.record !== null) {
        if (debugLog) {
          const artifact = result.record.coverageHtmlPath ?? `(from ${label})`;
          debugLog(`[resolver] resolved via ${label} → ${artifact}`);
        }
        return {
          record: result.record,
          sourceFormat: result.record.sourceFormat,
        };
      }
      if (result.rejectReason) {
        lastRejectReason = result.rejectReason;
      }
    }
    return { record: null, rejectReason: lastRejectReason ?? "no-artifact" };
  }
}

/** Build adapters from config order and paths; unknown format types are skipped. */
export function createAdaptersFromConfig(
  config: CovfluxConfig,
): CoverageAdapter[] {
  const adapters: CoverageAdapter[] = [];
  for (const entry of config.formats) {
    if (entry.type === "phpunit-html") {
      adapters.push(
        new PhpUnitHtmlAdapter({
          coverageHtmlDir: entry.path,
          sourceSegment: entry.sourceSegment ?? "auto",
        }),
      );
    } else if (entry.type === "lcov") {
      adapters.push(new LcovAdapter({ path: entry.path }));
    }
  }
  return adapters;
}

export { PhpUnitHtmlAdapter } from "./coverage-formats/phpunit-html";
export { LcovAdapter } from "./coverage-formats/lcov";
export { FixtureAdapter } from "./coverage-formats/fixture";
