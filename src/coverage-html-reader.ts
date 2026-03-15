import * as fs from 'fs';
import * as path from 'path';
import type { CoverageData, FileCoverage } from './coverage-types';
import { resolveCoverageHtmlPath, parseCoverageHtml } from './coverage-formats/phpunit-html';

const DEFAULT_COVERAGE_HTML_DIR = 'coverage-html';

export interface CoverageHtmlReaderOptions {
  log?: (msg: string) => void;
  /** PHPUnit HTML folder relative to workspace root (e.g. "coverage-html"). From config when present. */
  coverageHtmlDir?: string;
}

export class CoverageHtmlReader {
  private readonly log: (msg: string) => void;
  private readonly coverageHtmlDir: string;

  constructor(
    private readonly workspaceFolders: string[],
    options: CoverageHtmlReaderOptions = {}
  ) {
    this.log = options.log ?? (() => {});
    this.coverageHtmlDir = options.coverageHtmlDir ?? DEFAULT_COVERAGE_HTML_DIR;
  }

  static exists(rootPath: string): boolean {
    if (!rootPath) return false;
    try {
      return fs.existsSync(rootPath) && fs.statSync(rootPath).isDirectory();
    } catch {
      return false;
    }
  }

  static findCoverageRoots(workspaceFolders: string[], coverageHtmlDir: string = DEFAULT_COVERAGE_HTML_DIR): string[] {
    return workspaceFolders
      .map((workspaceFolder) => path.join(workspaceFolder, coverageHtmlDir))
      .filter((coverageRoot) => CoverageHtmlReader.exists(coverageRoot));
  }

  getCoverageRoots(): string[] {
    return CoverageHtmlReader.findCoverageRoots(this.workspaceFolders, this.coverageHtmlDir);
  }

  async getFileCoverage(filePath: string): Promise<CoverageData | null> {
    const coverageHtmlPath = resolveCoverageHtmlPath(
      path.resolve(filePath),
      this.workspaceFolders,
      { coverageHtmlDir: this.coverageHtmlDir }
    );
    if (!coverageHtmlPath) {
      this.log(`[coverage-html] ${path.basename(filePath)}: no matching html report`);
      return null;
    }

    const html = fs.readFileSync(coverageHtmlPath, 'utf8');
    const parsed = parseCoverageHtml(html);

    const coveredLines = new Set<number>(parsed.coveredLines);
    const uncoveredLines = new Set<number>(parsed.uncoveredLines);
    const uncoverableLines = new Set<number>();
    const lineStatuses = new Map<number, number>();

    for (const line of coveredLines) {
      lineStatuses.set(line, 1);
    }

    for (const line of uncoveredLines) {
      lineStatuses.set(line, 2);
    }

    const executableLines = coveredLines.size + uncoveredLines.size;
    const lineCoveragePercent =
      executableLines > 0 ? Number(((coveredLines.size / executableLines) * 100).toFixed(2)) : null;

    const file: FileCoverage = {
      fileId: 0,
      sourceFile: parsed.sourcePath ?? filePath,
      lineCoveragePercent,
      totalLines: executableLines,
      coveredLines: coveredLines.size,
    };

    this.log(
      `[coverage-html] ${path.basename(filePath)}: ${uncoveredLines.size} uncovered line(s): [${[...uncoveredLines].sort((a, b) => a - b).join(', ')}]`
    );

    return {
      file,
      coveredLines,
      uncoveredLines,
      uncoverableLines,
      lineStatuses,
    };
  }
}
