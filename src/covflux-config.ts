/**
 * Covflux configuration file support. Reads .covflux.json or covflux.json
 * from the workspace root to determine which coverage formats to use,
 * in what order, and where to find each format's artifact.
 */

import fs from 'node:fs';
import path from 'node:path';

export const SUPPORTED_FORMAT_TYPES = ['phpunit-html', 'lcov'] as const;
export type CovfluxFormatType = (typeof SUPPORTED_FORMAT_TYPES)[number];

export interface CovfluxFormatEntry {
  type: string;
  path: string;
}

export interface CovfluxConfig {
  formats: CovfluxFormatEntry[];
}

const CONFIG_FILENAMES = ['.covflux.json', 'covflux.json'];

export const DEFAULT_CONFIG: CovfluxConfig = {
  formats: [
    { type: 'phpunit-html', path: 'coverage-html' },
    { type: 'lcov', path: 'coverage/lcov.info' },
  ],
};

function isSupportedFormatType(type: string): type is CovfluxFormatType {
  return SUPPORTED_FORMAT_TYPES.includes(type as CovfluxFormatType);
}

/**
 * Load Covflux config from the workspace root. Tries .covflux.json then covflux.json.
 * Returns DEFAULT_CONFIG if no file is found or parsing fails.
 * Unknown or unsupported format types in the file are ignored; only
 * phpunit-html and lcov are used.
 */
export function loadCovfluxConfig(workspaceRoot: string): CovfluxConfig {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
    return DEFAULT_CONFIG;
  }
  const root = path.resolve(workspaceRoot);
  for (const name of CONFIG_FILENAMES) {
    const filePath = path.join(root, name);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      continue;
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw) as unknown;
      if (data === null || typeof data !== 'object' || !Array.isArray((data as { formats?: unknown }).formats)) {
        return DEFAULT_CONFIG;
      }
      const entries = (data as { formats: Array<{ type?: unknown; path?: unknown }> }).formats;
      const formats: CovfluxFormatEntry[] = [];
      for (const entry of entries) {
        const type = typeof entry.type === 'string' ? entry.type : '';
        const pathVal = typeof entry.path === 'string' ? entry.path : '';
        if (!type || !pathVal) continue;
        if (!isSupportedFormatType(type)) continue;
        formats.push({ type, path: pathVal });
      }
      if (formats.length === 0) {
        return DEFAULT_CONFIG;
      }
      return { formats };
    } catch {
      return DEFAULT_CONFIG;
    }
  }
  return DEFAULT_CONFIG;
}

/**
 * Return the path for the first phpunit-html format in config, or the default.
 */
export function getPhpUnitHtmlDir(config: CovfluxConfig): string {
  const entry = config.formats.find((f) => f.type === 'phpunit-html');
  return entry?.path ?? DEFAULT_CONFIG.formats[0]!.path;
}

/**
 * Return the path for the first lcov format in config, or the default.
 */
export function getLcovPath(config: CovfluxConfig): string {
  const entry = config.formats.find((f) => f.type === 'lcov');
  return entry?.path ?? DEFAULT_CONFIG.formats[1]!.path;
}

/**
 * Return absolute file paths to watch for LCOV coverage changes, one per workspace root.
 * Used so the extension can watch lcov.info (or configured path) and reload coverage on change.
 * Returns empty array if config has no lcov format.
 */
export function getLcovPathsToWatch(config: CovfluxConfig, workspaceRoots: string[]): string[] {
  const lcovRelative = config.formats.find((f) => f.type === 'lcov')?.path;
  if (!lcovRelative) return [];
  return workspaceRoots.map((root) => path.resolve(root, lcovRelative));
}
