import * as sqlite3 from '@vscode/sqlite3';
import * as path from 'path';
import * as fs from 'fs';

export interface FileCoverage {
  fileId: number;
  sourceFile: string;
  lineCoveragePercent: number | null;
  totalLines: number | null;
  coveredLines: number | null;
}

export interface LineCoverage {
  lineNumber: number;
  testCount: number;
  covered: boolean;
  lineStatus: number | null; // 1=green(covered), 2=red(coverable_not_covered), 3=yellow(uncoverable), NULL=not_tracked
}

export interface CoverageData {
  file: FileCoverage;
  coveredLines: Set<number>; // Set of covered line numbers (line_status = 1)
  uncoveredLines: Set<number>; // Set of uncovered but coverable line numbers (line_status = 2)
  uncoverableLines: Set<number>; // Set of uncoverable line numbers (line_status = 3)
  lineStatuses: Map<number, number>; // Map of line_number -> line_status for all lines with status
}

/**
 * Database reader for Covflux SQLite database
 */
export class CoverageDatabase {
  private db: sqlite3.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * Initialize and open the database connection
   */
  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this.dbPath)) {
        reject(new Error(`Coverage database not found at: ${this.dbPath}`));
        return;
      }

      this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            reject(err);
          } else {
            this.db = null;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get file coverage data for a specific file
   * Normalizes the file path for matching with database entries
   */
  async getFileCoverage(filePath: string): Promise<CoverageData | null> {
    if (!this.db) {
      throw new Error('Database not open');
    }

    // Normalize paths for comparison
    const normalizedPath = this.normalizePath(filePath);

    // Try exact match first
    const exactMatch = await this.getFileByPath(normalizedPath);
    if (exactMatch) {
      const lineStatusData = await this.getLineStatuses(exactMatch.id);
      return {
        file: {
          fileId: exactMatch.id,
          sourceFile: exactMatch.source_file,
          lineCoveragePercent: exactMatch.line_coverage_percent,
          totalLines: exactMatch.total_lines,
          coveredLines: exactMatch.covered_lines,
        },
        ...lineStatusData,
      };
    }

    // Try with basename match (for cases where paths differ but filename matches)
    const basenameMatch = await this.getFileByBasename(path.basename(normalizedPath));
    if (basenameMatch) {
      const lineStatusData = await this.getLineStatuses(basenameMatch.id);
      return {
        file: {
          fileId: basenameMatch.id,
          sourceFile: basenameMatch.source_file,
          lineCoveragePercent: basenameMatch.line_coverage_percent,
          totalLines: basenameMatch.total_lines,
          coveredLines: basenameMatch.covered_lines,
        },
        ...lineStatusData,
      };
    }

    return null;
  }

  /**
   * Get file by exact path match
   */
  private async getFileByPath(filePath: string): Promise<any | null> {
    if (!this.db) {
      throw new Error('Database not open');
    }

    return new Promise((resolve, reject) => {
      this.db!.get(
        `SELECT id, source_file, line_coverage_percent, total_lines, covered_lines
         FROM files
         WHERE source_file = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
        [filePath],
        (err, row: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    });
  }

  /**
   * Get file by basename match (fallback for path differences)
   */
  private async getFileByBasename(basename: string): Promise<any | null> {
    if (!this.db) {
      throw new Error('Database not open');
    }

    return new Promise((resolve, reject) => {
      this.db!.get(
        `SELECT id, source_file, line_coverage_percent, total_lines, covered_lines
         FROM files
         WHERE source_file LIKE ?
         ORDER BY updated_at DESC
         LIMIT 1`,
        [`%${basename}`],
        (err, row: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    });
  }

  /**
   * Get line status data for a file using the line_status field
   * Returns covered lines, uncovered lines, and a map of all line statuses
   */
  private async getLineStatuses(fileId: number): Promise<{
    coveredLines: Set<number>;
    uncoveredLines: Set<number>;
    uncoverableLines: Set<number>;
    lineStatuses: Map<number, number>;
  }> {
    if (!this.db) {
      throw new Error('Database not open');
    }

    return new Promise((resolve, reject) => {
      this.db!.all(
        `SELECT line_number, line_status FROM covered_lines WHERE file_id = ? AND line_status IS NOT NULL`,
        [fileId],
        (err, rows: any[]) => {
          if (err) {
            reject(err);
            return;
          }

          const coveredLines = new Set<number>();
          const uncoveredLines = new Set<number>();
          const uncoverableLines = new Set<number>();
          const lineStatuses = new Map<number, number>();

          for (const row of rows) {
            const lineNumber = row.line_number;
            const lineStatus = row.line_status;

            if (lineStatus !== null) {
              lineStatuses.set(lineNumber, lineStatus);

              // 1 = green (covered)
              if (lineStatus === 1) {
                coveredLines.add(lineNumber);
              }
              // 2 = red (coverable but not covered)
              else if (lineStatus === 2) {
                uncoveredLines.add(lineNumber);
              }
              // 3 = yellow (uncoverable)
              else if (lineStatus === 3) {
                uncoverableLines.add(lineNumber);
              }
            }
          }

          resolve({ coveredLines, uncoveredLines, uncoverableLines, lineStatuses });
        }
      );
    });
  }

  /**
   * Check if a line is covered
   */
  isLineCovered(filePath: string, lineNumber: number): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
      try {
        const coverage = await this.getFileCoverage(filePath);
        if (!coverage) {
          resolve(false);
          return;
        }

        // coveredLines already contains all lines with line_status = 1
        resolve(coverage.coveredLines.has(lineNumber));
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Normalize file path for database matching
   * Converts to absolute path and normalizes separators
   */
  private normalizePath(filePath: string): string {
    // Normalize path separators
    let normalized = filePath.replace(/\\/g, '/');

    // Resolve to absolute if relative
    if (!path.isAbsolute(normalized)) {
      normalized = path.resolve(normalized);
    }

    return normalized;
  }

  /**
   * Check if database file exists
   */
  static exists(dbPath: string): boolean {
    return fs.existsSync(dbPath);
  }

  /**
   * Resolve database path with variable substitution
   */
  static resolvePath(rawPath: string, workspaceFolder: string | undefined): string {
    if (!workspaceFolder) {
      return rawPath;
    }

    // Replace ${workspaceFolder} variable
    return rawPath.replace(/\${workspaceFolder}/g, workspaceFolder);
  }
}
