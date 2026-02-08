import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CoverageDatabase, CoverageData } from './database';
import { CoverageJsonReader } from './coverage-json';

/**
 * Coverage decoration types
 */
class CoverageDecorations {
  readonly coveredLine: vscode.TextEditorDecorationType;
  readonly uncoveredLine: vscode.TextEditorDecorationType;
  readonly uncoverableLine: vscode.TextEditorDecorationType;
  readonly coveredLineWithBackground: vscode.TextEditorDecorationType;
  readonly uncoveredLineWithBackground: vscode.TextEditorDecorationType;
  readonly uncoverableLineWithBackground: vscode.TextEditorDecorationType;

  constructor() {
    // Covered line decoration - with gutter icon only
    this.coveredLine = vscode.window.createTextEditorDecorationType({
      gutterIconPath: this.createGutterIcon('green'),
      gutterIconSize: 'contain',
      isWholeLine: false,
      overviewRulerColor: new vscode.ThemeColor('editorGutter.modifiedBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    // Uncovered line decoration - with gutter icon only
    this.uncoveredLine = vscode.window.createTextEditorDecorationType({
      gutterIconPath: this.createGutterIcon('red'),
      gutterIconSize: 'contain',
      isWholeLine: false,
      overviewRulerColor: new vscode.ThemeColor('editorGutter.deletedBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    // Uncoverable line decoration - with gutter icon only
    this.uncoverableLine = vscode.window.createTextEditorDecorationType({
      gutterIconPath: this.createGutterIcon('yellow'),
      gutterIconSize: 'contain',
      isWholeLine: false,
      overviewRulerColor: new vscode.ThemeColor('editorGutter.addedBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    // Covered line decoration - with background color (default)
    // Use a subtle green tint for covered lines
    this.coveredLineWithBackground = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(0, 255, 0, 0.15)',
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('editorGutter.modifiedBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    // Uncovered line decoration - with background color (default)
    // Use a subtle red tint for uncovered lines
    this.uncoveredLineWithBackground = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(255, 0, 0, 0.15)',
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('editorGutter.deletedBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    // Uncoverable line decoration - with background color
    // Use a subtle yellow tint for uncoverable lines
    this.uncoverableLineWithBackground = vscode.window.createTextEditorDecorationType({
      backgroundColor: 'rgba(255, 255, 0, 0.15)',
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('editorGutter.addedBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
  }

  private createGutterIcon(color: 'green' | 'red' | 'yellow'): vscode.Uri {
    // Create a simple colored square SVG
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14">
        <circle cx="7" cy="7" r="4" fill="${color}" opacity="0.8"/>
      </svg>
    `;

    // Write to a temporary file (in extension context)
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const iconPath = path.join(tempDir, `gutter-${color}.svg`);
    fs.writeFileSync(iconPath, svg);

    return vscode.Uri.file(iconPath);
  }

  dispose() {
    this.coveredLine.dispose();
    this.uncoveredLine.dispose();
    this.uncoverableLine.dispose();
    this.coveredLineWithBackground.dispose();
    this.uncoveredLineWithBackground.dispose();
    this.uncoverableLineWithBackground.dispose();
  }
}

/**
 * Main extension class
 */
type CoverageSource = 'sqlite' | 'coverage-json' | 'auto';

class CovfluxExtension {
  private database: CoverageDatabase | null = null;
  private coverageJson: CoverageJsonReader | null = null;
  private decorations: CoverageDecorations;
  private coverageEnabled: boolean = true;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private disposables: vscode.Disposable[] = [];
  private statusBarCoverage: vscode.StatusBarItem;
  private statusBarDatabase: vscode.StatusBarItem;
  private currentCoverage: CoverageData | null = null;
  private workspaceFolder: string | undefined;
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.decorations = new CoverageDecorations();
    this.outputChannel = vscode.window.createOutputChannel('Covflux');

    // Create status bar items
    this.statusBarCoverage = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarCoverage.command = 'covflux.toggleCoverage';
    this.statusBarCoverage.tooltip = 'Covflux: Click to toggle coverage display';

    this.statusBarDatabase = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      101
    );
    this.statusBarDatabase.tooltip = 'Covflux: Database connection status';
  }

  /**
   * Activate the extension
   */
  async activate(context: vscode.ExtensionContext): Promise<void> {
    this.log('Covflux activated. Open a file to see coverage; output will appear here.');
    // Initialize database
    await this.initializeDatabase();

    // Register commands
    const showCommand = vscode.commands.registerCommand('covflux.showCoverage', () => {
      this.coverageEnabled = true;
      this.updateAllEditors();
      vscode.window.showInformationMessage('Coverage display enabled');
    });

    const hideCommand = vscode.commands.registerCommand('covflux.hideCoverage', () => {
      this.coverageEnabled = false;
      this.clearAllDecorations();
      vscode.window.showInformationMessage('Coverage display disabled');
    });

    const toggleCommand = vscode.commands.registerCommand('covflux.toggleCoverage', () => {
      this.coverageEnabled = !this.coverageEnabled;
      if (this.coverageEnabled) {
        this.updateAllEditors();
        vscode.window.showInformationMessage('Coverage display enabled');
      } else {
        this.clearAllDecorations();
        this.updateCoverageStatus(null);
        vscode.window.showInformationMessage('Coverage display disabled');
      }
    });

    const showInfoCommand = vscode.commands.registerCommand('covflux.showCoverageInfo', () => {
      if (!this.hasCoverageSource()) {
        vscode.window.showWarningMessage('Covflux: No coverage source connected (SQLite or coverage-json)');
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Covflux: No active editor');
        return;
      }

      const filePath = editor.document.uri.fsPath;
      this.getFileCoverage(filePath).then((coverage) => {
        if (!coverage) {
          vscode.window.showInformationMessage(
            `Covflux: No coverage data found for ${path.basename(filePath)}`
          );
          return;
        }

        const percent = coverage.file.lineCoveragePercent;
        const covered = coverage.file.coveredLines ?? coverage.coveredLines.size;
        const total = coverage.file.totalLines || editor.document.lineCount;

        const message = [
          `Coverage: ${percent?.toFixed(1)}%`,
          `Covered: ${covered}/${total} lines`,
          `File: ${path.basename(filePath)}`
        ].join('\n');

        vscode.window.showInformationMessage(message);
        console.log(`[Covflux] Coverage info: ${message}`);
      }).catch((error: any) => {
        vscode.window.showErrorMessage(`Covflux: Error getting coverage info: ${error.message}`);
      });
    });

    context.subscriptions.push(showCommand, hideCommand, toggleCommand, showInfoCommand);

    // Watch for editor changes
    const onDidChangeActiveEditor = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && this.coverageEnabled) {
        this.updateEditor(editor);
      }
    });

    // Watch for document changes
    const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(() => {
      if (vscode.window.activeTextEditor && this.coverageEnabled) {
        // Debounce updates
        setTimeout(() => {
          if (vscode.window.activeTextEditor) {
            this.updateEditor(vscode.window.activeTextEditor);
          }
        }, 500);
      }
    });

    context.subscriptions.push(onDidChangeActiveEditor, onDidChangeTextDocument);

    // Watch database file for changes
    this.watchDatabase();

    // Show status bar items
    this.statusBarCoverage.show();
    this.statusBarDatabase.show();

    // Update current editor if open
    if (vscode.window.activeTextEditor && this.coverageEnabled) {
      const showOnOpen = vscode.workspace.getConfiguration('covflux').get<boolean>('showCoverageOnOpen', true);
      if (showOnOpen) {
        this.updateEditor(vscode.window.activeTextEditor);
      }
    }

    // Store disposables
    context.subscriptions.push(this.statusBarCoverage, this.statusBarDatabase);
    this.disposables.push(...context.subscriptions);
  }

  /**
   * Whether any coverage source (SQLite or coverage-json) is available
   */
  private hasCoverageSource(): boolean {
    return this.database !== null || this.coverageJson !== null;
  }

  /**
   * Get coverage for a file from the configured source(s)
   */
  private async getFileCoverage(filePath: string): Promise<CoverageData | null> {
    const config = vscode.workspace.getConfiguration('covflux');
    const source = config.get<CoverageSource>('source', 'auto');

    if (source === 'sqlite' && this.database) {
      return this.database.getFileCoverage(filePath);
    }

    if (source === 'coverage-json' && this.coverageJson) {
      const data = await this.coverageJson.getFileCoverage(filePath);
      if (data) {
        this.log(
          `[coverage-json] ${path.basename(filePath)}: ${data.uncoveredLines.size} uncovered line(s): [${[...data.uncoveredLines].sort((a, b) => a - b).join(', ')}]`
        );
      } else {
        this.log(`[coverage-json] ${path.basename(filePath)}: no data (path not found or not under workspace)`);
      }
      return data ?? null;
    }

    // auto: prefer source that has line-level data so highlighting works
    let fromDb: CoverageData | null = null;
    if (this.database) {
      fromDb = await this.database.getFileCoverage(filePath);
      if (fromDb) {
        const hasLineData =
          fromDb.coveredLines.size > 0 ||
          fromDb.uncoveredLines.size > 0 ||
          fromDb.uncoverableLines.size > 0;
        if (hasLineData) return fromDb;
      }
    }
    if (this.coverageJson) {
      const data = await this.coverageJson.getFileCoverage(filePath);
      if (data) {
        this.log(
          `[coverage-json] ${path.basename(filePath)}: ${data.uncoveredLines.size} uncovered: [${[...data.uncoveredLines].sort((a, b) => a - b).join(', ')}]`
        );
        return data;
      }
    }
    if (fromDb) this.log(`[auto] Using SQLite (no line data from coverage-json) for ${path.basename(filePath)}`);
    return fromDb;
  }

  /**
   * Initialize database and/or coverage-json
   */
  private async initializeDatabase(): Promise<void> {
    const config = vscode.workspace.getConfiguration('covflux');
    this.workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const rawDbPath = config.get<string>('databasePath', '${workspaceFolder}/coverage.sqlite');
    const dbPath = CoverageDatabase.resolvePath(rawDbPath, this.workspaceFolder);
    const source = config.get<CoverageSource>('source', 'auto');

    // SQLite
    if (source === 'sqlite' || source === 'auto') {
      if (CoverageDatabase.exists(dbPath)) {
        try {
          this.database = new CoverageDatabase(dbPath);
          await this.database.open();
          this.updateDatabaseStatus('$(database) Connected', 'Database connected successfully');
          console.log(`[Covflux] ✓ Connected to database at ${dbPath}`);
          vscode.window.setStatusBarMessage('Covflux: Database connected', 3000);
        } catch (error: any) {
          this.updateDatabaseStatus('$(error) DB Error', `Failed to open database: ${error.message}`);
          vscode.window.showErrorMessage(`Covflux: Failed to open database: ${error.message}`);
          console.error(`[Covflux] ✗ Failed to open database:`, error);
        }
      } else if (source === 'sqlite') {
        this.updateDatabaseStatus('$(error) No DB', 'Database not found');
        vscode.window.showWarningMessage(
          `Covflux: Coverage database not found at ${dbPath}. Please ensure the database path is correct in settings.`
        );
        console.log(`[Covflux] Database not found at: ${dbPath}`);
      }
    }

    // Coverage-JSON
    const rawJsonPath = config.get<string>('coverageJsonPath', '${workspaceFolder}/coverage-json');
    const jsonPath = CoverageJsonReader.resolvePath(rawJsonPath, this.workspaceFolder);
    if (source === 'coverage-json' || source === 'auto') {
      if (CoverageJsonReader.exists(jsonPath) && this.workspaceFolder) {
        const stripPrefix = config.get<string>('coverageJsonStripPathPrefix', 'app');
        this.coverageJson = new CoverageJsonReader(jsonPath, this.workspaceFolder, {
          stripPathPrefix: stripPrefix || undefined,
          log: (msg) => this.log(msg),
        });
        if (!this.database) {
          this.updateDatabaseStatus('$(file-code) Coverage-JSON', 'Using coverage-json folder');
        }
        console.log(`[Covflux] ✓ Using coverage-json at ${jsonPath}`);
      } else if (source === 'coverage-json') {
        this.updateDatabaseStatus('$(error) No JSON', 'Coverage-JSON folder not found');
        vscode.window.showWarningMessage(
          `Covflux: coverage-json folder not found at ${jsonPath}. Set covflux.coverageJsonPath in settings.`
        );
      }
    }

    if (!this.hasCoverageSource()) {
      this.updateDatabaseStatus('$(error) No source', 'No coverage source (SQLite or coverage-json)');
    }
  }

  /**
   * Watch database file and/or coverage-json for changes
   */
  private watchDatabase(): void {
    const config = vscode.workspace.getConfiguration('covflux');
    const rawDbPath = config.get<string>('databasePath', '${workspaceFolder}/coverage.sqlite');
    const dbPath = CoverageDatabase.resolvePath(rawDbPath, this.workspaceFolder);
    const rawJsonPath = config.get<string>('coverageJsonPath', '${workspaceFolder}/coverage-json');
    const jsonPath = CoverageJsonReader.resolvePath(rawJsonPath, this.workspaceFolder);

    const onChanged = () => {
      this.reloadDatabase().then(() => {
        if (this.coverageEnabled) {
          this.updateAllEditors();
        }
      });
    };

    this.fileWatcher = vscode.workspace.createFileSystemWatcher(dbPath);
    this.fileWatcher.onDidChange(onChanged);
    this.disposables.push(this.fileWatcher);

    if (jsonPath) {
      const jsonGlob = `${jsonPath.replace(/\\/g, '/')}/**/*.json`;
      const jsonWatcher = vscode.workspace.createFileSystemWatcher(jsonGlob);
      jsonWatcher.onDidChange(onChanged);
      this.disposables.push(jsonWatcher);
    }
  }

  /**
   * Reload database connection and/or coverage-json
   */
  private async reloadDatabase(): Promise<void> {
    if (this.database) {
      await this.database.close();
      this.database = null;
    }
    this.coverageJson = null;
    await this.initializeDatabase();
  }

  private log(msg: string): void {
    if (!vscode.workspace.getConfiguration('covflux').get<boolean>('debug', false)) return;
    this.outputChannel.appendLine(msg);
    this.outputChannel.show(true);
  }

  /**
   * Update coverage decorations for a specific editor
   */
  private async updateEditor(editor: vscode.TextEditor): Promise<void> {
    const filePath = editor.document.uri.fsPath;
    const config = vscode.workspace.getConfiguration('covflux');
    const source = config.get<CoverageSource>('source', 'auto');

    this.log(`[update] ${path.basename(filePath)} source=${source} hasDb=${!!this.database} hasJson=${!!this.coverageJson} enabled=${this.coverageEnabled}`);

    if (!this.hasCoverageSource() || !this.coverageEnabled) {
      this.updateCoverageStatus(null);
      return;
    }

    if (!filePath) {
      this.updateCoverageStatus(null);
      return;
    }

    try {
      const coverage = await this.getFileCoverage(filePath);
      if (!coverage) {
        this.updateCoverageStatus(null);
        this.log(`[update] No coverage for ${path.basename(filePath)}`);
        return;
      }

      this.currentCoverage = coverage;
      await this.applyDecorations(editor, coverage);

      const coveragePercent = coverage.file.lineCoveragePercent;
      const covered = coverage.file.coveredLines ?? coverage.coveredLines.size;
      const total = coverage.file.totalLines || editor.document.lineCount;

      console.log(`[Covflux] ✓ Coverage loaded for ${path.basename(filePath)}: ${coveragePercent?.toFixed(1)}% (${covered}/${total} lines)`);

      this.updateCoverageStatus(coverage);
    } catch (error: any) {
      this.updateCoverageStatus(null);
      console.error(`[Covflux] ✗ Error updating coverage for ${filePath}:`, error);
      vscode.window.showErrorMessage(`Covflux: Error loading coverage - ${error.message}`);
    }
  }

  /**
   * Update coverage status bar
   */
  private updateCoverageStatus(coverage: CoverageData | null): void {
    if (!coverage || !this.coverageEnabled) {
      this.statusBarCoverage.text = '$(test-view-icon) Coverage';
      this.statusBarCoverage.backgroundColor = undefined;
      this.statusBarCoverage.hide();
      return;
    }

    const percent = coverage.file.lineCoveragePercent;
    if (percent === null || percent === undefined) {
      this.statusBarCoverage.text = '$(test-view-icon) Coverage: N/A';
      this.statusBarCoverage.backgroundColor = undefined;
    } else {
      const covered = coverage.file.coveredLines ?? coverage.coveredLines.size;
      const total = coverage.file.totalLines ?? 0;

      // Color based on coverage percentage
      if (percent >= 80) {
        this.statusBarCoverage.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
      } else if (percent >= 50) {
        this.statusBarCoverage.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      } else {
        this.statusBarCoverage.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      }

      this.statusBarCoverage.text = `$(test-view-icon) ${percent.toFixed(1)}% (${covered}/${total})`;
    }

    const coveredCount = coverage.file.coveredLines ?? coverage.coveredLines.size;
    this.statusBarCoverage.tooltip = `Coverage: ${percent?.toFixed(1)}%\nCovered lines: ${coveredCount}\nTotal lines: ${coverage.file.totalLines}\nClick to toggle coverage display`;
    this.statusBarCoverage.show();
  }

  /**
   * Update database status bar
   */
  private updateDatabaseStatus(text: string, tooltip: string): void {
    this.statusBarDatabase.text = text;
    this.statusBarDatabase.tooltip = `Covflux: ${tooltip}`;
    this.statusBarDatabase.show();
  }

  /**
   * Apply coverage decorations to editor
   */
  private async applyDecorations(editor: vscode.TextEditor, coverage: CoverageData): Promise<void> {
    const config = vscode.workspace.getConfiguration('covflux');
    const showCovered = config.get<boolean>('showCovered', true);
    const showUncovered = config.get<boolean>('showUncovered', true);
    const showLineCoverage = config.get<boolean>('showLineCoverage', true);
    const showGutterCoverage = config.get<boolean>('showGutterCoverage', false);

    const coveredRanges: vscode.Range[] = [];
    const uncoveredRanges: vscode.Range[] = [];
    const uncoverableRanges: vscode.Range[] = [];

    const totalLines = editor.document.lineCount;

    for (let i = 0; i < totalLines; i++) {
      const line = editor.document.lineAt(i);
      const lineNumber = i + 1; // VS Code uses 0-based, database uses 1-based

      // Use line_status from database: 1=covered (green), 2=uncovered (red), 3=uncoverable (yellow), NULL=not tracked
      if (coverage.coveredLines.has(lineNumber)) {
        // line_status = 1 (covered)
        if (showCovered) {
          coveredRanges.push(line.range);
        }
      } else if (coverage.uncoveredLines.has(lineNumber)) {
        // line_status = 2 (coverable but not covered)
        if (showUncovered) {
          uncoveredRanges.push(line.range);
        }
      } else if (coverage.uncoverableLines.has(lineNumber)) {
        // line_status = 3 (uncoverable) - show in yellow
        if (showUncovered) {
          uncoverableRanges.push(line.range);
        }
      }
      // NULL (not tracked) - no highlighting
    }

    // Apply decorations based on configuration
    this.log(
      `[decorations] ${path.basename(editor.document.uri.fsPath)}: docLines=${totalLines} uncoveredSet=${coverage.uncoveredLines.size} → ranges: covered=${coveredRanges.length} uncovered=${uncoveredRanges.length} showLine=${showLineCoverage} showUncovered=${showUncovered}`
    );
    if (showLineCoverage) {
      // Use background colors (default)
      editor.setDecorations(this.decorations.coveredLineWithBackground, coveredRanges);
      editor.setDecorations(this.decorations.uncoveredLineWithBackground, uncoveredRanges);
      editor.setDecorations(this.decorations.uncoverableLineWithBackground, uncoverableRanges);
    } else {
      // Clear background decorations
      editor.setDecorations(this.decorations.coveredLineWithBackground, []);
      editor.setDecorations(this.decorations.uncoveredLineWithBackground, []);
      editor.setDecorations(this.decorations.uncoverableLineWithBackground, []);
    }

    if (showGutterCoverage) {
      // Also show gutter icons if enabled
      editor.setDecorations(this.decorations.coveredLine, coveredRanges);
      editor.setDecorations(this.decorations.uncoveredLine, uncoveredRanges);
      editor.setDecorations(this.decorations.uncoverableLine, uncoverableRanges);
    } else {
      // Clear gutter decorations
      editor.setDecorations(this.decorations.coveredLine, []);
      editor.setDecorations(this.decorations.uncoveredLine, []);
      editor.setDecorations(this.decorations.uncoverableLine, []);
    }
  }

  /**
   * Update all open editors
   */
  private updateAllEditors(): void {
    vscode.window.visibleTextEditors.forEach((editor) => {
      this.updateEditor(editor);
    });
  }

  /**
   * Clear all coverage decorations
   */
  private clearAllDecorations(): void {
    vscode.window.visibleTextEditors.forEach((editor) => {
      editor.setDecorations(this.decorations.coveredLine, []);
      editor.setDecorations(this.decorations.uncoveredLine, []);
      editor.setDecorations(this.decorations.uncoverableLine, []);
      editor.setDecorations(this.decorations.coveredLineWithBackground, []);
      editor.setDecorations(this.decorations.uncoveredLineWithBackground, []);
      editor.setDecorations(this.decorations.uncoverableLineWithBackground, []);
    });
  }

  /**
   * Deactivate the extension
   */
  async deactivate(): Promise<void> {
    this.clearAllDecorations();

    if (this.database) {
      await this.database.close();
    }

    this.decorations.dispose();
    this.statusBarCoverage.dispose();
    this.statusBarDatabase.dispose();

    // Dispose all disposables
    this.disposables.forEach((d) => d.dispose());
  }
}

let extension: CovfluxExtension | null = null;

export function activate(context: vscode.ExtensionContext): void {
  extension = new CovfluxExtension();
  extension.activate(context);
}

export function deactivate(): Promise<void> {
  if (extension) {
    return extension.deactivate();
  }
  return Promise.resolve();
}
