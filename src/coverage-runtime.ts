/**
 * Shared coverage resolution and lookup. Used by the extension and the MCP server
 * so both use the same logic. Path normalization and file resolution live here;
 * format-specific resolution (PHPUnit HTML, LCOV) is delegated to format adapters.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveCoverageHtmlPath,
  buildCoverageFileResult,
  findCoverageHtmlBasenameMatches,
  type ParsedCoverageFileResult,
} from './coverage-formats/phpunit-html';

export type { ParsedCoverageFileResult } from './coverage-formats/phpunit-html';
export { stripTestsByLine } from './coverage-formats/phpunit-html';

export function toFileSystemPath(uriOrPath: string): string {
  if (uriOrPath.startsWith('file://')) {
    return fileURLToPath(uriOrPath);
  }
  return uriOrPath;
}

export function resolveFilePath(
  filePath: string | undefined,
  workspaceRoots: string[],
  options: { toFileSystemPath?: (s: string) => string } = {}
): string | null {
  if (!filePath) return null;
  const normalize = options.toFileSystemPath ?? toFileSystemPath;
  const normalizedPath = normalize(filePath);
  if (path.isAbsolute(normalizedPath)) {
    return path.resolve(normalizedPath);
  }
  for (const workspaceRoot of workspaceRoots) {
    const candidate = path.join(workspaceRoot, normalizedPath);
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }
  return null;
}

export interface ResolveCoverageQueryOptions {
  toFileSystemPath?: (s: string) => string;
  /** PHPUnit HTML folder relative to workspace root (e.g. "coverage-html"). From config when present. */
  coverageHtmlDir?: string;
}

/**
 * Resolve a coverage query (file path or basename) to candidate file paths.
 * Same order as the extension: try exact path first, then basename search under coverage-html.
 * Callers pass each path to CoverageResolver.getCoverage().
 */
export function getCandidatePathsForQuery(
  query: string,
  workspaceRoots: string[],
  options: ResolveCoverageQueryOptions = {}
): string[] {
  const resolved = resolveFilePath(query, workspaceRoots, options);
  if (resolved) return [resolved];
  const phpunitOptions = options.coverageHtmlDir ? { coverageHtmlDir: options.coverageHtmlDir } : {};
  const matches = findCoverageHtmlBasenameMatches(query, workspaceRoots, phpunitOptions);
  return matches.map((m) => m.filePath);
}
