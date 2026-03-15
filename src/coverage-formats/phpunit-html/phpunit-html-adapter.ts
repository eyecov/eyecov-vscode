/**
 * PHPUnit HTML coverage adapter. Resolves source file → HTML path under
 * coverage-html/, reads and parses HTML, returns CoverageRecord for the resolver
 * and ParsedCoverageFileResult for query/basename lookup (MCP).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PhpUnitHtmlSourceSegment } from '../../covflux-config';
import type { CoverageAdapter, CoverageRecord } from '../../coverage-resolver';
import { isCoverageStale } from '../../coverage-staleness';
import { parseCoverageHtml } from './parser';
import type { CoverageFileResult, ParsedCoverageFileResult } from './types';

const DEFAULT_COVERAGE_HTML_DIR = 'coverage-html';
const AUTO_SEGMENTS = ['app', 'src', 'lib'] as const;
/** PHPUnit 12 coverage-html directory/dashboard pages – excluded from source file discovery. */
const EXCLUDED_HTML_BASENAMES = ['index.html', 'dashboard.html'];

export type PhpUnitHtmlAdapterOptions = {
  coverageHtmlDir?: string;
  sourceSegment?: PhpUnitHtmlSourceSegment;
};

function getSourceSegmentForRoot(workspaceRoot: string, sourceSegment: PhpUnitHtmlSourceSegment): string {
  if (sourceSegment !== 'auto') {
    return sourceSegment;
  }
  const root = path.resolve(workspaceRoot);
  for (const seg of AUTO_SEGMENTS) {
    if (fs.existsSync(path.join(root, seg))) {
      return seg;
    }
  }
  return 'app';
}

export function resolveCoverageHtmlPath(
  sourceFilePath: string,
  workspaceRoots: string[],
  options: PhpUnitHtmlAdapterOptions = {}
): string | null {
  const dir = options.coverageHtmlDir ?? DEFAULT_COVERAGE_HTML_DIR;
  const segmentOpt = options.sourceSegment ?? 'auto';
  const normalizedSourceFilePath = path.resolve(sourceFilePath);
  const segmentsToTry = segmentOpt === 'auto' ? AUTO_SEGMENTS : [segmentOpt];
  for (const workspaceRoot of workspaceRoots) {
    const root = path.resolve(workspaceRoot);
    for (const segment of segmentsToTry) {
      const segmentRoot = path.join(root, segment);
      if (!normalizedSourceFilePath.startsWith(segmentRoot + path.sep)) {
        continue;
      }
      const relativeToSegment = path.relative(segmentRoot, normalizedSourceFilePath);
      const coverageHtmlPath = path.join(root, dir, `${relativeToSegment}.html`);
      if (fs.existsSync(coverageHtmlPath)) {
        return path.resolve(coverageHtmlPath);
      }
    }
  }
  for (const seg of AUTO_SEGMENTS) {
    const segmentSep = `${path.sep}${seg}${path.sep}`;
    const segIndex = sourceFilePath.indexOf(segmentSep);
    if (segIndex !== -1) {
      const workspaceRoot = sourceFilePath.slice(0, segIndex);
      if (workspaceRoots.some((r) => path.resolve(r) === path.resolve(workspaceRoot))) {
        const allowed = segmentOpt === 'auto' ? AUTO_SEGMENTS : [segmentOpt];
        if (!allowed.includes(seg)) continue;
        const relativeToSegment = sourceFilePath.slice(segIndex + segmentSep.length);
        const coverageHtmlPath = path.join(workspaceRoot, dir, `${relativeToSegment}.html`);
        if (fs.existsSync(coverageHtmlPath)) {
          return path.resolve(coverageHtmlPath);
        }
      }
    }
  }
  return null;
}

export function buildCoverageFileResult(
  sourceFilePath: string,
  coverageHtmlPath: string
): ParsedCoverageFileResult {
  const html = fs.readFileSync(coverageHtmlPath, 'utf8');
  const parsed = parseCoverageHtml(html);
  const coveredLines = parsed.coveredLines.length;
  const uncoveredLines = parsed.uncoveredLines.length;
  const executableLines = coveredLines + uncoveredLines;
  const lineCoveragePercent =
    executableLines > 0 ? Number(((coveredLines / executableLines) * 100).toFixed(2)) : null;
  return {
    filePath: sourceFilePath,
    coverageHtmlPath,
    lineCoveragePercent,
    coveredLines,
    uncoveredLines,
    uncoveredLineNumbers: parsed.uncoveredLines,
    coveredLineNumbers: parsed.coveredLines,
    testsByLine: parsed.testsByLine,
    lineStatuses: new Map(parsed.lineStatuses),
  };
}

export function findCoverageHtmlBasenameMatches(
  query: string,
  workspaceRoots: string[],
  options: PhpUnitHtmlAdapterOptions = {}
): ParsedCoverageFileResult[] {
  const dir = options.coverageHtmlDir ?? DEFAULT_COVERAGE_HTML_DIR;
  const segmentOpt = options.sourceSegment ?? 'auto';
  const basename = path.basename(query);
  const targetFileName = basename.endsWith('.html') ? basename : `${basename}.html`;
  const matches: ParsedCoverageFileResult[] = [];
  const seen = new Set<string>();

  const visit = (workspaceRoot: string, currentDir: string, segment: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === '_css' || entry.name === '_js' || entry.name === '_icons') continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(workspaceRoot, fullPath, segment);
        continue;
      }
      if (!entry.isFile() || entry.name !== targetFileName) continue;
      if (EXCLUDED_HTML_BASENAMES.includes(entry.name)) continue;
      const coverageHtmlRoot = path.join(workspaceRoot, dir);
      const relativeHtmlPath = path.relative(coverageHtmlRoot, fullPath);
      if (relativeHtmlPath.startsWith('..')) continue;
      const sourceFilePath = path.join(workspaceRoot, segment, relativeHtmlPath.replace(/\.html$/, ''));
      if (!fs.existsSync(sourceFilePath)) continue;
      const dedupeKey = path.resolve(sourceFilePath);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      matches.push(buildCoverageFileResult(sourceFilePath, fullPath));
    }
  };

  for (const workspaceRoot of workspaceRoots) {
    const coverageHtmlRoot = path.join(workspaceRoot, dir);
    if (!fs.existsSync(coverageHtmlRoot) || !fs.statSync(coverageHtmlRoot).isDirectory()) continue;
    const segment = getSourceSegmentForRoot(workspaceRoot, segmentOpt);
    visit(workspaceRoot, coverageHtmlRoot, segment);
  }
  return matches.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

/**
 * List all source file paths that have a coverage HTML file under the given roots.
 * Used for on-demand path/project aggregation (discovery).
 */
export function listCoverageHtmlSourcePaths(
  workspaceRoots: string[],
  options: PhpUnitHtmlAdapterOptions = {}
): string[] {
  const dir = options.coverageHtmlDir ?? DEFAULT_COVERAGE_HTML_DIR;
  const segmentOpt = options.sourceSegment ?? 'auto';
  const seen = new Set<string>();
  const paths: string[] = [];

  const visit = (workspaceRoot: string, currentDir: string, segment: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === '_css' || entry.name === '_js' || entry.name === '_icons') continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(workspaceRoot, fullPath, segment);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
      if (EXCLUDED_HTML_BASENAMES.includes(entry.name)) continue;
      const coverageHtmlRoot = path.join(workspaceRoot, dir);
      const relativeHtmlPath = path.relative(coverageHtmlRoot, fullPath);
      if (relativeHtmlPath.startsWith('..')) continue;
      const sourceFilePath = path.join(
        workspaceRoot,
        segment,
        relativeHtmlPath.replace(/\.html$/, '')
      );
      if (!fs.existsSync(sourceFilePath)) continue;
      const dedupeKey = path.resolve(sourceFilePath);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      paths.push(dedupeKey);
    }
  };

  for (const workspaceRoot of workspaceRoots) {
    const coverageHtmlRoot = path.join(workspaceRoot, dir);
    if (!fs.existsSync(coverageHtmlRoot) || !fs.statSync(coverageHtmlRoot).isDirectory()) continue;
    const segment = getSourceSegmentForRoot(workspaceRoot, segmentOpt);
    visit(workspaceRoot, coverageHtmlRoot, segment);
  }
  return paths.sort();
}

export function stripTestsByLine(result: ParsedCoverageFileResult): CoverageFileResult {
  const { testsByLine: _t, ...rest } = result;
  return rest;
}

/** PHPUnit HTML coverage adapter: resolves path, reads HTML, returns CoverageRecord. */
export class PhpUnitHtmlAdapter implements CoverageAdapter {
  constructor(private readonly options: PhpUnitHtmlAdapterOptions = {}) {}

  async getCoverage(
    filePath: string,
    workspaceRoots: string[]
  ): Promise<CoverageRecord | null> {
    const coverageHtmlPath = resolveCoverageHtmlPath(filePath, workspaceRoots, this.options);
    if (!coverageHtmlPath) {
      return null;
    }
    if (isCoverageStale(filePath, coverageHtmlPath)) {
      return null;
    }
    const result = buildCoverageFileResult(filePath, coverageHtmlPath);
    return {
      sourcePath: filePath,
      coveredLines: new Set(result.coveredLineNumbers),
      uncoveredLines: new Set(result.uncoveredLineNumbers),
      uncoverableLines: new Set<number>(),
      lineCoveragePercent: result.lineCoveragePercent,
      coverageHtmlPath,
      testsByLine: result.testsByLine,
      lineStatuses: result.lineStatuses,
    };
  }
}
