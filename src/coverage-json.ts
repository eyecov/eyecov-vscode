import * as path from 'path';
import * as fs from 'fs';
import type { CoverageData, FileCoverage } from './database';

/**
 * Coverage-JSON detailed file format (files/*.json)
 */
interface CoverageJsonFile {
  path: string;
  lines: number;
  covered: number;
  percent: number;
  uncoveredLines: number[];
  methods?: Array<{
    name: string;
    lines: string;
    covered: number;
    total: number;
    percent: number;
  }>;
}

/**
 * File entry in _coverage.json (may have truncated uncoveredLines)
 */
interface CoverageJsonFileEntry {
  name: string;
  lines: number;
  covered: number;
  percent: number;
  uncoveredLines: number[];
  totalUncovered: number;
  hasDetails: boolean;
}

/**
 * Directory _coverage.json format
 */
interface CoverageJsonDir {
  path: string;
  summary: { lines: number; covered: number; percent: number; files: number };
  files: CoverageJsonFileEntry[];
  subdirs: Record<string, unknown>;
}

/**
 * Reads coverage from the coverage-json folder format.
 * Structure: coverage-json/<mirror-of-source>/files/<FileName>.json
 * Only uncovered line numbers are provided; covered lines are not listed per-line.
 */
export interface CoverageJsonReaderOptions {
  /** Strip this prefix from workspace-relative paths when resolving coverage-json paths (e.g. "app/" for Laravel). */
  stripPathPrefix?: string;
  /** Optional debug logger (e.g. extension output channel). */
  log?: (msg: string) => void;
}

export class CoverageJsonReader {
  private readonly stripPathPrefix: string;
  private readonly log: (msg: string) => void;

  constructor(
    private readonly coverageJsonRoot: string,
    private readonly workspaceFolder: string,
    options: CoverageJsonReaderOptions = {}
  ) {
    this.stripPathPrefix = (options.stripPathPrefix ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (this.stripPathPrefix) this.stripPathPrefix += '/';
    this.log = options.log ?? (() => {});
  }

  /** Get path under coverage-json: workspace-relative path with optional prefix stripped. */
  private relativePathUnderCoverage(filePath: string): string | null {
    const normalized = filePath.replace(/\\/g, '/');
    const absolute = path.isAbsolute(normalized)
      ? normalized
      : path.resolve(this.workspaceFolder, normalized);
    let relative = path.relative(this.workspaceFolder, absolute).replace(/\\/g, '/');
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }
    if (this.stripPathPrefix && relative.startsWith(this.stripPathPrefix)) {
      relative = relative.slice(this.stripPathPrefix.length);
    }
    return relative;
  }

  static exists(rootPath: string): boolean {
    if (!rootPath) return false;
    try {
      return fs.existsSync(rootPath) && fs.statSync(rootPath).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Resolve workspace-relative path to coverage-json detailed file path.
   * e.g. app/Http/.../HubController.php -> .../Http/.../files/HubController.json (if stripPathPrefix is "app/")
   * Returns null if filePath is not under workspaceFolder.
   */
  private resolveDetailPath(filePath: string): string | null {
    const relative = this.relativePathUnderCoverage(filePath);
    if (!relative) return null;
    const dir = path.dirname(relative);
    const base = path.basename(relative);
    const nameWithoutExt = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
    return path.join(this.coverageJsonRoot, dir, 'files', `${nameWithoutExt}.json`);
  }

  /**
   * Resolve path to directory _coverage.json. Returns null if filePath is not under workspace.
   */
  private resolveDirCoveragePath(filePath: string): string | null {
    const relative = this.relativePathUnderCoverage(filePath);
    if (!relative) return null;
    const dir = path.dirname(relative);
    return path.join(this.coverageJsonRoot, dir, '_coverage.json');
  }

  /**
   * Get coverage for a single file. Prefers detailed files/*.json; falls back to _coverage.json file entry.
   */
  async getFileCoverage(filePath: string): Promise<CoverageData | null> {
    const detailPath = this.resolveDetailPath(filePath);
    const sourceRelative = path
      .relative(this.workspaceFolder, filePath.replace(/\\/g, path.sep))
      .replace(/\\/g, '/');
    const fileName = path.basename(filePath);

    this.log(`[coverage-json] resolve: workspace=${this.workspaceFolder} relative=${sourceRelative} detailPath=${detailPath ?? 'null (file not under workspace)'}`);

    if (!detailPath) return null;

    const detailExists = fs.existsSync(detailPath);
    this.log(`[coverage-json] detail exists=${detailExists} path=${detailPath}`);

    // Prefer detailed file (full uncoveredLines)
    if (detailExists) {
      try {
        const raw = fs.readFileSync(detailPath, 'utf-8');
        const data: CoverageJsonFile = JSON.parse(raw);
        const out = this.toCoverageData(data, sourceRelative);
        this.log(`[coverage-json] parsed uncoveredLines (raw): [${(data.uncoveredLines ?? []).join(', ')}] → set size=${out.uncoveredLines.size}`);
        return out;
      } catch (e) {
        this.log(`[coverage-json] read error: ${e}`);
      }
    }

    // Fallback: directory _coverage.json (may have truncated uncoveredLines)
    const dirPath = this.resolveDirCoveragePath(filePath);
    if (dirPath && fs.existsSync(dirPath)) {
      try {
        const raw = fs.readFileSync(dirPath, 'utf-8');
        const dirData: CoverageJsonDir = JSON.parse(raw);
        const entry = dirData.files?.find((f) => f.name === fileName);
        if (entry) {
          const out = this.entryToCoverageData(entry, sourceRelative);
          this.log(`[coverage-json] from _coverage.json entry uncoveredLines set size=${out.uncoveredLines.size}`);
          return out;
        }
      } catch (e) {
        this.log(`[coverage-json] dir read error: ${e}`);
      }
    }

    return null;
  }

  /** Normalize line numbers from JSON (may be numbers or strings); returns 1-based editor line numbers. */
  private normalizeLineNumbers(raw: number[] | undefined): Set<number> {
    const list = raw ?? [];
    const out = new Set<number>();
    for (const n of list) {
      const line = typeof n === 'number' ? n : Number(n);
      if (!Number.isFinite(line) || line < 1) continue;
      out.add(Math.floor(line));
    }
    return out;
  }

  /** Parse a "lines" range string like "27-27" or "10-30" into 1-based line numbers. */
  private parseLineRange(linesStr: string): number[] {
    const parts = String(linesStr ?? '').trim().split('-').map((s) => parseInt(s, 10));
    if (parts.length < 1 || !Number.isFinite(parts[0])) return [];
    const start = parts[0];
    const end = parts.length >= 2 && Number.isFinite(parts[1]) ? parts[1] : start;
    const out: number[] = [];
    for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
      if (i >= 1) out.push(i);
    }
    return out;
  }

  /** Build covered line numbers from methods: each method with covered > 0 contributes its line range. */
  private coveredLinesFromMethods(methods: CoverageJsonFile['methods']): Set<number> {
    const out = new Set<number>();
    if (!methods?.length) return out;
    for (const m of methods) {
      if (m.covered > 0 && m.lines) {
        for (const line of this.parseLineRange(m.lines)) {
          out.add(line);
        }
      }
    }
    return out;
  }

  private toCoverageData(data: CoverageJsonFile, sourceFile: string): CoverageData {
    const uncovered = this.normalizeLineNumbers(data.uncoveredLines);
    const covered = this.coveredLinesFromMethods(data.methods);
    const file: FileCoverage = {
      fileId: 0,
      sourceFile,
      lineCoveragePercent: data.percent,
      totalLines: data.lines,
      coveredLines: data.covered,
    };
    return {
      file,
      coveredLines: covered,
      uncoveredLines: uncovered,
      uncoverableLines: new Set(),
      lineStatuses: new Map(),
    };
  }

  private entryToCoverageData(entry: CoverageJsonFileEntry, sourceFile: string): CoverageData {
    const uncovered = this.normalizeLineNumbers(entry.uncoveredLines);
    const file: FileCoverage = {
      fileId: 0,
      sourceFile,
      lineCoveragePercent: entry.percent,
      totalLines: entry.lines,
      coveredLines: entry.covered,
    };
    return {
      file,
      coveredLines: new Set(),
      uncoveredLines: uncovered,
      uncoverableLines: new Set(),
      lineStatuses: new Map(),
    };
  }

  static resolvePath(rawPath: string, workspaceFolder: string | undefined): string {
    if (!workspaceFolder) return rawPath;
    return rawPath.replace(/\${workspaceFolder}/g, workspaceFolder);
  }
}
