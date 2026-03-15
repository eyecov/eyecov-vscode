/**
 * PHPUnit HTML coverage adapter. Resolves source file → HTML path under
 * coverage-html/, reads and parses HTML, returns CoverageRecord for the resolver
 * and ParsedCoverageFileResult for query/basename lookup (MCP).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CoverageAdapter, CoverageRecord } from '../../coverage-resolver';
import { isCoverageStale } from '../../coverage-staleness';
import { parseCoverageHtml } from './parser';
import type { CoverageFileResult, ParsedCoverageFileResult } from './types';

const DEFAULT_COVERAGE_HTML_DIR = 'coverage-html';
const APP_SEGMENT = 'app';

export function resolveCoverageHtmlPath(
  sourceFilePath: string,
  workspaceRoots: string[],
  options: { coverageHtmlDir?: string } = {}
): string | null {
  const dir = options.coverageHtmlDir ?? DEFAULT_COVERAGE_HTML_DIR;
  const normalizedSourceFilePath = path.resolve(sourceFilePath);
  for (const workspaceRoot of workspaceRoots) {
    const appRoot = path.join(path.resolve(workspaceRoot), APP_SEGMENT);
    if (!normalizedSourceFilePath.startsWith(appRoot + path.sep)) {
      continue;
    }
    const relativeToApp = path.relative(appRoot, normalizedSourceFilePath);
    const coverageHtmlPath = path.join(workspaceRoot, dir, `${relativeToApp}.html`);
    if (fs.existsSync(coverageHtmlPath)) {
      return path.resolve(coverageHtmlPath);
    }
  }
  const appSegment = `${path.sep}${APP_SEGMENT}${path.sep}`;
  const appIndex = sourceFilePath.indexOf(appSegment);
  if (appIndex !== -1) {
    const workspaceRoot = sourceFilePath.slice(0, appIndex);
    const relativeToApp = sourceFilePath.slice(appIndex + appSegment.length);
    const coverageHtmlPath = path.join(workspaceRoot, dir, `${relativeToApp}.html`);
    if (fs.existsSync(coverageHtmlPath)) {
      return path.resolve(coverageHtmlPath);
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
  };
}

export function findCoverageHtmlBasenameMatches(
  query: string,
  workspaceRoots: string[],
  options: { coverageHtmlDir?: string } = {}
): ParsedCoverageFileResult[] {
  const dir = options.coverageHtmlDir ?? DEFAULT_COVERAGE_HTML_DIR;
  const basename = path.basename(query);
  const targetFileName = basename.endsWith('.html') ? basename : `${basename}.html`;
  const matches: ParsedCoverageFileResult[] = [];
  const seen = new Set<string>();

  const visit = (workspaceRoot: string, currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === '_css' || entry.name === '_js' || entry.name === '_icons') continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(workspaceRoot, fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== targetFileName) continue;
      const coverageHtmlRoot = path.join(workspaceRoot, dir);
      const relativeHtmlPath = path.relative(coverageHtmlRoot, fullPath);
      if (relativeHtmlPath.startsWith('..')) continue;
      const sourceFilePath = path.join(workspaceRoot, APP_SEGMENT, relativeHtmlPath.replace(/\.html$/, ''));
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
    visit(workspaceRoot, coverageHtmlRoot);
  }
  return matches.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

/**
 * List all source file paths that have a coverage HTML file under the given roots.
 * Used for on-demand path/project aggregation (discovery).
 */
export function listCoverageHtmlSourcePaths(
  workspaceRoots: string[],
  options: { coverageHtmlDir?: string } = {}
): string[] {
  const dir = options.coverageHtmlDir ?? DEFAULT_COVERAGE_HTML_DIR;
  const seen = new Set<string>();
  const paths: string[] = [];

  const visit = (workspaceRoot: string, currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === '_css' || entry.name === '_js' || entry.name === '_icons') continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(workspaceRoot, fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
      const coverageHtmlRoot = path.join(workspaceRoot, dir);
      const relativeHtmlPath = path.relative(coverageHtmlRoot, fullPath);
      if (relativeHtmlPath.startsWith('..')) continue;
      const sourceFilePath = path.join(
        workspaceRoot,
        APP_SEGMENT,
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
    visit(workspaceRoot, coverageHtmlRoot);
  }
  return paths.sort();
}

export function stripTestsByLine(result: ParsedCoverageFileResult): CoverageFileResult {
  const { testsByLine: _t, ...rest } = result;
  return rest;
}

/** PHPUnit HTML coverage adapter: resolves path, reads HTML, returns CoverageRecord. */
export class PhpUnitHtmlAdapter implements CoverageAdapter {
  constructor(private readonly options: { coverageHtmlDir?: string } = {}) {}

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
    };
  }
}
