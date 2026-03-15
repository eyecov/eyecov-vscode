import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  getLinesByStatusCode,
  recordToCoverageData,
} from "./coverage-data-mapper";
import { CoverageData, LINE_STATUS } from "./coverage-types";
import { CoverageHtmlReader } from "./coverage-html-reader";
import {
  loadCovfluxConfig,
  getPhpUnitHtmlDir,
  getPhpUnitHtmlSourceSegment,
  getLcovPathsToWatch,
} from "./covflux-config";
import { listCoveredPathsFromFirstFormat } from "./coverage-aggregate";
import { deleteCoverageCache } from "./coverage-cache";
import { prewarmCoverageForRoot } from "./coverage-prewarm";
import {
  CoverageResolver,
  createAdaptersFromConfig,
} from "./coverage-resolver";
import {
  isMcpServerEnabled,
  isPrewarmCoverageCacheEnabled,
} from "./mcp/settings";

/** PHPUnit report colors: light then dark (docs). */
const COVERAGE_COLORS = {
  coveredSmall: { light: "#99cb84", dark: "#3d5c4e" },
  coveredMedium: { light: "#c3e3b5", dark: "#3c6051" },
  coveredLarge: { light: "#dff0d8", dark: "#2d4431" },
  warning: { light: "#fcf8e3", dark: "#3e3408" },
  uncovered: { light: "#f2dede", dark: "#42221e" },
} as const;

/**
 * Coverage decoration types. mediaDir is the extension's media folder path
 * (e.g. from context.asAbsolutePath("media")) so gutter icons resolve in all run contexts.
 */
class CoverageDecorations {
  readonly coveredLine: vscode.TextEditorDecorationType;
  readonly uncoveredLine: vscode.TextEditorDecorationType;
  readonly uncoverableLine: vscode.TextEditorDecorationType;
  readonly coveredLineWithBackground: vscode.TextEditorDecorationType;
  readonly uncoveredLineWithBackground: vscode.TextEditorDecorationType;
  readonly uncoverableLineWithBackground: vscode.TextEditorDecorationType;
  readonly coveredSmallWithBackground: vscode.TextEditorDecorationType;
  readonly coveredMediumWithBackground: vscode.TextEditorDecorationType;
  readonly coveredLargeWithBackground: vscode.TextEditorDecorationType;
  readonly warningWithBackground: vscode.TextEditorDecorationType;

  constructor(
    private darkTheme: boolean,
    mediaDir: string,
  ) {
    const gutter = (color: string) =>
      vscode.Uri.file(path.join(mediaDir, `gutter-${color}.svg`));
    // Covered line decoration - with gutter icon only
    this.coveredLine = vscode.window.createTextEditorDecorationType({
      gutterIconPath: gutter("green"),
      gutterIconSize: "contain",
      isWholeLine: false,
      overviewRulerColor: new vscode.ThemeColor(
        "editorGutter.modifiedBackground",
      ),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    // Uncovered line decoration - with gutter icon only
    this.uncoveredLine = vscode.window.createTextEditorDecorationType({
      gutterIconPath: gutter("red"),
      gutterIconSize: "contain",
      isWholeLine: false,
      overviewRulerColor: new vscode.ThemeColor(
        "editorGutter.deletedBackground",
      ),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    // Uncoverable line decoration - with gutter icon only
    this.uncoverableLine = vscode.window.createTextEditorDecorationType({
      gutterIconPath: gutter("yellow"),
      gutterIconSize: "contain",
      isWholeLine: false,
      overviewRulerColor: new vscode.ThemeColor("editorGutter.addedBackground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    // Covered line decoration - with background color (default)
    // Use a subtle green tint for covered lines
    this.coveredLineWithBackground =
      vscode.window.createTextEditorDecorationType({
        backgroundColor: "rgba(0, 255, 0, 0.15)",
        isWholeLine: true,
        overviewRulerColor: new vscode.ThemeColor(
          "editorGutter.modifiedBackground",
        ),
        overviewRulerLane: vscode.OverviewRulerLane.Left,
      });

    // Uncovered line decoration - with background color (default)
    // Use a subtle red tint for uncovered lines
    this.uncoveredLineWithBackground =
      vscode.window.createTextEditorDecorationType({
        backgroundColor: "rgba(255, 0, 0, 0.15)",
        isWholeLine: true,
        overviewRulerColor: new vscode.ThemeColor(
          "editorGutter.deletedBackground",
        ),
        overviewRulerLane: vscode.OverviewRulerLane.Left,
      });

    // Uncoverable line decoration - with background color
    // Use a subtle yellow tint for uncoverable lines
    this.uncoverableLineWithBackground =
      vscode.window.createTextEditorDecorationType({
        backgroundColor: "rgba(255, 255, 0, 0.15)",
        isWholeLine: true,
        overviewRulerColor: new vscode.ThemeColor(
          "editorGutter.addedBackground",
        ),
        overviewRulerLane: vscode.OverviewRulerLane.Left,
      });

    const c = (key: keyof typeof COVERAGE_COLORS) =>
      this.darkTheme ? COVERAGE_COLORS[key].dark : COVERAGE_COLORS[key].light;
    this.coveredSmallWithBackground =
      vscode.window.createTextEditorDecorationType({
        backgroundColor: c("coveredSmall"),
        isWholeLine: true,
      });
    this.coveredMediumWithBackground =
      vscode.window.createTextEditorDecorationType({
        backgroundColor: c("coveredMedium"),
        isWholeLine: true,
      });
    this.coveredLargeWithBackground =
      vscode.window.createTextEditorDecorationType({
        backgroundColor: c("coveredLarge"),
        isWholeLine: true,
      });
    this.warningWithBackground = vscode.window.createTextEditorDecorationType({
      backgroundColor: c("warning"),
      isWholeLine: true,
    });
  }

  dispose() {
    this.coveredLine.dispose();
    this.uncoveredLine.dispose();
    this.uncoverableLine.dispose();
    this.coveredLineWithBackground.dispose();
    this.uncoveredLineWithBackground.dispose();
    this.uncoverableLineWithBackground.dispose();
    this.coveredSmallWithBackground.dispose();
    this.coveredMediumWithBackground.dispose();
    this.coveredLargeWithBackground.dispose();
    this.warningWithBackground.dispose();
  }
}

/**
 * Main extension class
 */
const MCP_SERVER_DEFINITION_PROVIDER_ID = "covflux.builtin";

class CovfluxExtension {
  private coverageHtml: CoverageHtmlReader | null = null;
  private resolver: CoverageResolver | null = null;
  private decorations: CoverageDecorations;
  private coverageEnabled: boolean = true;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private disposables: vscode.Disposable[] = [];
  private statusBarCoverage: vscode.StatusBarItem;
  private statusBarDatabase: vscode.StatusBarItem;
  private currentCoverage: CoverageData | null = null;
  private workspaceFolder: string | undefined;
  private outputChannel: vscode.OutputChannel;

  constructor(context: vscode.ExtensionContext) {
    this.decorations = new CoverageDecorations(
      this.isDarkTheme(),
      context.asAbsolutePath("media"),
    );
    this.outputChannel = vscode.window.createOutputChannel("Covflux");

    // Create status bar items
    this.statusBarCoverage = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBarCoverage.command = "covflux.toggleCoverage";
    this.statusBarCoverage.tooltip =
      "Covflux: Click to toggle coverage display";

    this.statusBarDatabase = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      101,
    );
    this.statusBarDatabase.tooltip = "Covflux: Database connection status";
  }

  /**
   * Activate the extension
   */
  async activate(context: vscode.ExtensionContext): Promise<void> {
    this.log(
      "Covflux activated. Open a file to see coverage; output will appear here.",
    );
    this.registerMcpServer(context);
    await this.initializeCoverage();

    // Register commands
    const showCommand = vscode.commands.registerCommand(
      "covflux.showCoverage",
      () => {
        this.coverageEnabled = true;
        this.updateAllEditors();
        vscode.window.showInformationMessage("Coverage display enabled");
      },
    );

    const hideCommand = vscode.commands.registerCommand(
      "covflux.hideCoverage",
      () => {
        this.coverageEnabled = false;
        this.clearAllDecorations();
        vscode.window.showInformationMessage("Coverage display disabled");
      },
    );

    const toggleCommand = vscode.commands.registerCommand(
      "covflux.toggleCoverage",
      () => {
        this.coverageEnabled = !this.coverageEnabled;
        if (this.coverageEnabled) {
          this.updateAllEditors();
          vscode.window.showInformationMessage("Coverage display enabled");
        } else {
          this.clearAllDecorations();
          this.updateCoverageStatus(null);
          vscode.window.showInformationMessage("Coverage display disabled");
        }
      },
    );

    const showInfoCommand = vscode.commands.registerCommand(
      "covflux.showCoverageInfo",
      () => {
        if (!this.hasCoverageSource()) {
          vscode.window.showWarningMessage(
            "Covflux: No coverage source (no PHPUnit HTML or LCOV coverage found in workspace)",
          );
          return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage("Covflux: No active editor");
          return;
        }

        const filePath = editor.document.uri.fsPath;
        this.getFileCoverage(filePath)
          .then((coverage) => {
            if (!coverage) {
              vscode.window.showInformationMessage(
                `Covflux: No coverage data found for ${path.basename(filePath)}`,
              );
              return;
            }

            const percent = coverage.file.lineCoveragePercent;
            const covered =
              coverage.file.coveredLines ?? coverage.coveredLines.size;
            const total = coverage.file.totalLines || editor.document.lineCount;

            const message = [
              `Coverage: ${percent?.toFixed(1)}%`,
              `Covered: ${covered}/${total} lines`,
              `File: ${path.basename(filePath)}`,
            ].join("\n");

            vscode.window.showInformationMessage(message);
            console.log(`[Covflux] Coverage info: ${message}`);
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(
              `Covflux: Error getting coverage info: ${message}`,
            );
          });
      },
    );

    const toggleGutterCommand = vscode.commands.registerCommand(
      "covflux.toggleGutterCoverage",
      async () => {
        const config = vscode.workspace.getConfiguration("covflux");
        const current = config.get<boolean>("showGutterCoverage", true);
        await config.update(
          "showGutterCoverage",
          !current,
          vscode.ConfigurationTarget.Global,
        );
        if (this.coverageEnabled) this.updateAllEditors();
        vscode.window.showInformationMessage(
          `Covflux: Gutter coverage ${!current ? "on" : "off"}`,
        );
      },
    );

    const toggleLineCommand = vscode.commands.registerCommand(
      "covflux.toggleLineCoverage",
      async () => {
        const config = vscode.workspace.getConfiguration("covflux");
        const current = config.get<boolean>("showLineCoverage", true);
        await config.update(
          "showLineCoverage",
          !current,
          vscode.ConfigurationTarget.Global,
        );
        if (this.coverageEnabled) this.updateAllEditors();
        vscode.window.showInformationMessage(
          `Covflux: Line highlight ${!current ? "on" : "off"}`,
        );
      },
    );

    context.subscriptions.push(
      showCommand,
      hideCommand,
      toggleCommand,
      showInfoCommand,
      toggleGutterCommand,
      toggleLineCommand,
    );

    // Watch for editor changes
    const onDidChangeActiveEditor = vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        if (editor && this.coverageEnabled) {
          this.updateEditor(editor);
        }
      },
    );

    // Watch for document changes
    const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(
      () => {
        if (vscode.window.activeTextEditor && this.coverageEnabled) {
          // Debounce updates
          setTimeout(() => {
            if (vscode.window.activeTextEditor) {
              this.updateEditor(vscode.window.activeTextEditor);
            }
          }, 500);
        }
      },
    );

    context.subscriptions.push(
      onDidChangeActiveEditor,
      onDidChangeTextDocument,
    );

    this.watchCoverage();

    this.startPrewarmIfEnabled();

    // Show status bar items
    this.statusBarCoverage.show();
    this.statusBarDatabase.show();

    // Update current editor if open
    if (vscode.window.activeTextEditor && this.coverageEnabled) {
      const showOnOpen = vscode.workspace
        .getConfiguration("covflux")
        .get<boolean>("showCoverageOnOpen", true);
      if (showOnOpen) {
        this.updateEditor(vscode.window.activeTextEditor);
      }
    }

    // Store disposables
    context.subscriptions.push(this.statusBarCoverage, this.statusBarDatabase);
    this.disposables.push(...context.subscriptions);
  }

  private hasCoverageSource(): boolean {
    return this.resolver !== null;
  }

  private registerMcpServer(context: vscode.ExtensionContext): void {
    const covfluxConfig = vscode.workspace.getConfiguration("covflux");
    if (!isMcpServerEnabled(covfluxConfig)) {
      this.log("MCP server is disabled by setting covflux.enableMcpServer.");
      return;
    }
    const registerProvider = vscode.lm?.registerMcpServerDefinitionProvider;
    if (typeof registerProvider !== "function") {
      this.log(
        "MCP server definition API is unavailable in this VS Code host.",
      );
      return;
    }

    const serverScriptPath = context.asAbsolutePath(
      path.join("out", "mcp", "server.js"),
    );
    if (!fs.existsSync(serverScriptPath)) {
      this.log(`MCP server script not found at ${serverScriptPath}`);
      return;
    }

    const extensionVersion = String(
      (context.extension.packageJSON as { version?: string }).version ??
        "0.0.0",
    );
    const provider = registerProvider(MCP_SERVER_DEFINITION_PROVIDER_ID, {
      provideMcpServerDefinitions: () => {
        const serverDefinition = new vscode.McpStdioServerDefinition(
          "Covflux Hello Server",
          process.execPath,
          [serverScriptPath],
          {
            COVFLUX_EXTENSION_VERSION: extensionVersion,
          },
          extensionVersion,
        );

        serverDefinition.cwd = context.extensionUri;

        return [serverDefinition];
      },
      resolveMcpServerDefinition: (serverDefinition) => {
        return serverDefinition;
      },
    });

    context.subscriptions.push(provider);
  }

  /**
   * Get coverage for a file from the resolver (PHPUnit HTML).
   */
  private async getFileCoverage(
    filePath: string,
  ): Promise<CoverageData | null> {
    if (!this.resolver) return null;
    const record = await this.resolver.getCoverage(filePath);
    if (!record) return null;
    this.log(
      `[coverage-html] ${path.basename(filePath)}: ${record.uncoveredLines.size} uncovered line(s): [${[...record.uncoveredLines].sort((a, b) => a - b).join(", ")}]`,
    );
    return recordToCoverageData(record);
  }

  /**
   * Initialize coverage from config (.covflux.json / covflux.json) or defaults.
   */
  private async initializeCoverage(): Promise<void> {
    this.workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const workspaceFolders =
      vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ??
      [];
    const config = loadCovfluxConfig(this.workspaceFolder ?? "");
    const adapters = createAdaptersFromConfig(config);
    const coverageHtmlDir = getPhpUnitHtmlDir(config);
    const coverageRoots = CoverageHtmlReader.findCoverageRoots(
      workspaceFolders,
      coverageHtmlDir,
    );

    const covfluxConfig = vscode.workspace.getConfiguration("covflux");
    const debug = covfluxConfig.get<boolean>("debug", false);
    this.resolver = new CoverageResolver({
      workspaceRoots: workspaceFolders,
      adapters,
      ...(debug && {
        debugLog: (msg) => this.log(msg),
        adapterLabels: config.formats.map((f) => f.type),
      }),
    });

    if (debug && config.formats.length > 0) {
      this.log(
        `[resolver] adapters detected: ${config.formats.map((f) => `${f.type} (${f.path})`).join(", ")}`,
      );
    }

    if (coverageRoots.length > 0) {
      this.coverageHtml = new CoverageHtmlReader(workspaceFolders, {
        log: (msg) => this.log(msg),
        coverageHtmlDir,
        sourceSegment: getPhpUnitHtmlSourceSegment(config),
      });
      console.log(`[Covflux] ✓ coverage-html at ${coverageRoots.join(", ")}`);
    }
    this.updateSourceStatus(
      "$(file-code) Coverage",
      "Auto-discover coverage (PHPUnit HTML, LCOV) — uses whatever is available for the open file",
    );
  }

  /**
   * Watch coverage artifacts for changes (PHPUnit HTML folder and LCOV file(s)).
   * When any watched file changes, reload coverage and update editors.
   */
  private watchCoverage(): void {
    const workspaceFolders =
      vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
    const config = loadCovfluxConfig(this.workspaceFolder ?? "");
    const onChanged = () => {
      for (const root of workspaceFolders) {
        deleteCoverageCache(root);
      }
      this.reloadCoverage().then(() => {
        if (this.coverageEnabled) this.updateAllEditors();
      });
    };

    // Watch PHPUnit HTML coverage folder
    const htmlRoots = this.coverageHtml?.getCoverageRoots() ?? [];
    for (const htmlRoot of htmlRoots) {
      const htmlGlob = `${htmlRoot.replace(/\\/g, "/")}/**/*.html`;
      const htmlWatcher = vscode.workspace.createFileSystemWatcher(htmlGlob);
      htmlWatcher.onDidChange(onChanged);
      this.disposables.push(htmlWatcher);
    }

    // Watch LCOV file path(s) per workspace root
    const lcovPaths = getLcovPathsToWatch(config, workspaceFolders);
    for (const lcovPath of lcovPaths) {
      const lcovWatcher = vscode.workspace.createFileSystemWatcher(lcovPath);
      lcovWatcher.onDidChange(onChanged);
      lcovWatcher.onDidCreate(onChanged);
      this.disposables.push(lcovWatcher);
    }
  }

  /**
   * Start background prewarm after a short delay when covflux.prewarmCoverageCache is true.
   * Fire-and-forget: does not block activation.
   */
  private startPrewarmIfEnabled(): void {
    const covfluxConfig = vscode.workspace.getConfiguration("covflux");
    if (!isPrewarmCoverageCacheEnabled(covfluxConfig)) {
      return;
    }
    const delayMs = 2000;
    setTimeout(() => {
      const workspaceFolders =
        vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
      if (!this.resolver || workspaceFolders.length === 0) {
        return;
      }
      for (const root of workspaceFolders) {
        const config = loadCovfluxConfig(root);
        prewarmCoverageForRoot(root, {
          listPaths: () => listCoveredPathsFromFirstFormat([root], config),
          getCoverage: (p) => this.resolver!.getCoverage(p),
          batchSize: 20,
        }).catch(() => {
          // ignore; cache will be on-demand if prewarm fails
        });
      }
    }, delayMs);
  }

  private async reloadCoverage(): Promise<void> {
    this.coverageHtml = null;
    this.resolver = null;
    await this.initializeCoverage();
  }

  private isDarkTheme(): boolean {
    const kind = vscode.window.activeColorTheme.kind;
    return (
      kind === vscode.ColorThemeKind.Dark ||
      kind === vscode.ColorThemeKind.HighContrast
    );
  }

  private log(msg: string): void {
    if (
      !vscode.workspace.getConfiguration("covflux").get<boolean>("debug", false)
    )
      return;
    this.outputChannel.appendLine(msg);
    this.outputChannel.show(true);
  }

  /**
   * Update coverage decorations for a specific editor
   */
  private async updateEditor(editor: vscode.TextEditor): Promise<void> {
    const filePath = editor.document.uri.fsPath;
    this.log(
      `[update] ${path.basename(filePath)} hasResolver=${!!this.resolver} enabled=${this.coverageEnabled}`,
    );

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

      console.log(
        `[Covflux] ✓ Coverage loaded for ${path.basename(filePath)}: ${coveragePercent?.toFixed(1)}% (${covered}/${total} lines)`,
      );

      this.updateCoverageStatus(coverage);
    } catch (error: unknown) {
      this.updateCoverageStatus(null);
      console.error(
        `[Covflux] ✗ Error updating coverage for ${filePath}:`,
        error,
      );
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Covflux: Error loading coverage - ${message}`,
      );
    }
  }

  /**
   * Update coverage status bar
   */
  private updateCoverageStatus(coverage: CoverageData | null): void {
    if (!coverage || !this.coverageEnabled) {
      this.statusBarCoverage.text = "$(test-view-icon) Coverage";
      this.statusBarCoverage.backgroundColor = undefined;
      this.statusBarCoverage.hide();
      return;
    }

    const percent = coverage.file.lineCoveragePercent;
    if (percent === null || percent === undefined) {
      this.statusBarCoverage.text = "$(test-view-icon) Coverage: N/A";
      this.statusBarCoverage.backgroundColor = undefined;
    } else {
      const covered = coverage.file.coveredLines ?? coverage.coveredLines.size;
      const total = coverage.file.totalLines ?? 0;

      // Color based on coverage percentage
      if (percent >= 80) {
        this.statusBarCoverage.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.prominentBackground",
        );
      } else if (percent >= 50) {
        this.statusBarCoverage.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground",
        );
      } else {
        this.statusBarCoverage.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.errorBackground",
        );
      }

      this.statusBarCoverage.text = `$(test-view-icon) ${percent.toFixed(1)}% (${covered}/${total})`;
    }

    const coveredCount =
      coverage.file.coveredLines ?? coverage.coveredLines.size;
    this.statusBarCoverage.tooltip = `Coverage: ${percent?.toFixed(1)}%\nCovered lines: ${coveredCount}\nTotal lines: ${coverage.file.totalLines}\nClick to toggle coverage display`;
    this.statusBarCoverage.show();
  }

  /**
   * Update source status bar (coverage-html availability)
   */
  private updateSourceStatus(text: string, tooltip: string): void {
    this.statusBarDatabase.text = text;
    this.statusBarDatabase.tooltip = `Covflux: ${tooltip}`;
    this.statusBarDatabase.show();
  }

  /**
   * Apply coverage decorations to editor
   */
  private async applyDecorations(
    editor: vscode.TextEditor,
    coverage: CoverageData,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("covflux");
    const showCovered = config.get<boolean>("showCovered", true);
    const showUncovered = config.get<boolean>("showUncovered", true);
    const showLineCoverage = config.get<boolean>("showLineCoverage", true);
    const showGutterCoverage = config.get<boolean>("showGutterCoverage", true);

    const byStatus = getLinesByStatusCode(coverage);
    const statusKeys = [...byStatus.keys()];
    const useGranular =
      statusKeys.some(
        (k) =>
          k === LINE_STATUS.COVERED_LARGE ||
          k === LINE_STATUS.WARNING ||
          k === LINE_STATUS.UNCOVERABLE,
      ) || statusKeys.length > 2;

    const totalLines = editor.document.lineCount;

    if (useGranular && showLineCoverage) {
      const lineNumToRanges = (lineNums: number[]) =>
        lineNums
          .filter((n) => n >= 1 && n <= totalLines)
          .map((n) => editor.document.lineAt(n - 1).range);
      editor.setDecorations(
        this.decorations.coveredSmallWithBackground,
        showCovered
          ? lineNumToRanges(byStatus.get(LINE_STATUS.COVERED_SMALL) ?? [])
          : [],
      );
      editor.setDecorations(
        this.decorations.coveredMediumWithBackground,
        showCovered
          ? lineNumToRanges(byStatus.get(LINE_STATUS.COVERED_MEDIUM) ?? [])
          : [],
      );
      editor.setDecorations(
        this.decorations.coveredLargeWithBackground,
        showCovered
          ? lineNumToRanges(byStatus.get(LINE_STATUS.COVERED_LARGE) ?? [])
          : [],
      );
      editor.setDecorations(
        this.decorations.warningWithBackground,
        showUncovered
          ? lineNumToRanges(byStatus.get(LINE_STATUS.WARNING) ?? [])
          : [],
      );
      editor.setDecorations(
        this.decorations.uncoveredLineWithBackground,
        showUncovered
          ? lineNumToRanges(byStatus.get(LINE_STATUS.UNCOVERED) ?? [])
          : [],
      );
      editor.setDecorations(
        this.decorations.uncoverableLineWithBackground,
        showUncovered
          ? lineNumToRanges(byStatus.get(LINE_STATUS.UNCOVERABLE) ?? [])
          : [],
      );
      editor.setDecorations(this.decorations.coveredLineWithBackground, []);
    } else {
      const coveredRanges: vscode.Range[] = [];
      const uncoveredRanges: vscode.Range[] = [];
      const uncoverableRanges: vscode.Range[] = [];
      for (let i = 0; i < totalLines; i++) {
        const line = editor.document.lineAt(i);
        const lineNumber = i + 1;
        if (coverage.coveredLines.has(lineNumber)) {
          if (showCovered) coveredRanges.push(line.range);
        } else if (coverage.uncoveredLines.has(lineNumber)) {
          if (showUncovered) uncoveredRanges.push(line.range);
        } else if (coverage.uncoverableLines.has(lineNumber)) {
          if (showUncovered) uncoverableRanges.push(line.range);
        }
      }
      this.log(
        `[decorations] ${path.basename(editor.document.uri.fsPath)}: docLines=${totalLines} → covered=${coveredRanges.length} uncovered=${uncoveredRanges.length}`,
      );
      if (showLineCoverage) {
        editor.setDecorations(
          this.decorations.coveredLineWithBackground,
          coveredRanges,
        );
        editor.setDecorations(
          this.decorations.uncoveredLineWithBackground,
          uncoveredRanges,
        );
        editor.setDecorations(
          this.decorations.uncoverableLineWithBackground,
          uncoverableRanges,
        );
        editor.setDecorations(this.decorations.coveredSmallWithBackground, []);
        editor.setDecorations(this.decorations.coveredMediumWithBackground, []);
        editor.setDecorations(this.decorations.coveredLargeWithBackground, []);
        editor.setDecorations(this.decorations.warningWithBackground, []);
      } else {
        editor.setDecorations(this.decorations.coveredLineWithBackground, []);
        editor.setDecorations(this.decorations.uncoveredLineWithBackground, []);
        editor.setDecorations(
          this.decorations.uncoverableLineWithBackground,
          [],
        );
        editor.setDecorations(this.decorations.coveredSmallWithBackground, []);
        editor.setDecorations(this.decorations.coveredMediumWithBackground, []);
        editor.setDecorations(this.decorations.coveredLargeWithBackground, []);
        editor.setDecorations(this.decorations.warningWithBackground, []);
      }
    }

    if (showGutterCoverage) {
      const coveredRanges: vscode.Range[] = [];
      const uncoveredRanges: vscode.Range[] = [];
      const uncoverableRanges: vscode.Range[] = [];
      for (let i = 0; i < totalLines; i++) {
        const line = editor.document.lineAt(i);
        const lineNumber = i + 1;
        if (coverage.coveredLines.has(lineNumber)) {
          if (showCovered) coveredRanges.push(line.range);
        } else if (coverage.uncoveredLines.has(lineNumber)) {
          if (showUncovered) uncoveredRanges.push(line.range);
        } else if (coverage.uncoverableLines.has(lineNumber)) {
          if (showUncovered) uncoverableRanges.push(line.range);
        }
      }
      editor.setDecorations(this.decorations.coveredLine, coveredRanges);
      editor.setDecorations(this.decorations.uncoveredLine, uncoveredRanges);
      editor.setDecorations(
        this.decorations.uncoverableLine,
        uncoverableRanges,
      );
    } else {
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
      editor.setDecorations(this.decorations.coveredSmallWithBackground, []);
      editor.setDecorations(this.decorations.coveredMediumWithBackground, []);
      editor.setDecorations(this.decorations.coveredLargeWithBackground, []);
      editor.setDecorations(this.decorations.warningWithBackground, []);
    });
  }

  /**
   * Deactivate the extension
   */
  async deactivate(): Promise<void> {
    this.clearAllDecorations();
    this.decorations.dispose();
    this.statusBarCoverage.dispose();
    this.statusBarDatabase.dispose();

    // Dispose all disposables
    this.disposables.forEach((d) => d.dispose());
  }
}

let extension: CovfluxExtension | null = null;

export function activate(context: vscode.ExtensionContext): void {
  extension = new CovfluxExtension(context);
  extension.activate(context);
}

export function deactivate(): Promise<void> {
  if (extension) {
    return extension.deactivate();
  }
  return Promise.resolve();
}
