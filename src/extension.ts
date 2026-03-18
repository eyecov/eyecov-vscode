import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  getDecorationPlan,
  getStatusBarContent,
  recordToCoverageData,
  type StatusBarNoCoverageContext,
} from "./coverage-data-mapper";
import { CoverageData, LINE_STATUS } from "./coverage-types";
import { CoverageHtmlReader } from "./coverage-html-reader";
import {
  loadCoverageConfig,
  getPhpUnitHtmlDir,
  getPhpUnitHtmlSourceSegment,
  getCoverageArtifactPathsToWatch,
} from "./coverage-config";
import { listCoveredPathsFromFirstFormat } from "./coverage-aggregate";
import { deleteCoverageCache } from "./coverage-cache";
import { prewarmCoverageForRoot } from "./coverage-prewarm";
import {
  type CoverageRecord,
  CoverageResolver,
  createAdaptersFromConfig,
} from "./coverage-resolver";
import {
  isMcpServerEnabled,
  isPrewarmCoverageCacheEnabled,
} from "./mcp/settings";
import {
  applyContentChangesToTrackedState,
  type ContentChange,
  normalizeContentChangeFromZeroBased,
  recordToTrackedState,
  trackedStateToCoverageData,
} from "./edit-tracking";
import {
  shouldPreserveStartLineOnInsert,
  shouldShiftStartLineOnInsert,
} from "./edit-boundary-detection";
import {
  createTrackedCoverageEntry,
  pushRecoverableEntry,
  tryRestoreTrackedCoverageEntry,
  type TrackedCoverageEntry,
} from "./edit-recovery";

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
const MCP_SERVER_DEFINITION_PROVIDER_ID = "eyecov.builtin";

interface StatusBarRenderState {
  text: string;
  tooltip?: string;
  backgroundColor?: string;
  show: boolean;
}

export class CoverageExtension implements vscode.Disposable {
  private coverageHtml: CoverageHtmlReader | null = null;
  private resolver: CoverageResolver | null = null;
  private decorations: CoverageDecorations;
  private coverageEnabled: boolean = true;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private disposables: vscode.Disposable[] = [];
  private statusBarCoverage: vscode.StatusBarItem;
  private currentCoverage: CoverageData | null = null;
  private workspaceFolder: string | undefined;
  private outputChannel: vscode.OutputChannel;
  private trackedByUri = new Map<string, TrackedCoverageEntry>();
  private recoverableByUri = new Map<string, TrackedCoverageEntry[]>();
  private readonly mediaDir: string;
  private lastStatusBarRender: StatusBarRenderState | null = null;
  private prewarmTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(context: vscode.ExtensionContext) {
    this.mediaDir = context.asAbsolutePath("media");
    this.decorations = this.createDecorations();
    this.outputChannel = this.trackDisposable(
      vscode.window.createOutputChannel("EyeCov"),
    );

    // Create status bar items
    this.statusBarCoverage = this.trackDisposable(
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100),
    );
    this.statusBarCoverage.command = "eyecov.toggleCoverage";
    this.statusBarCoverage.tooltip = "EyeCov: Click to toggle coverage display";
  }

  private createDecorations(): CoverageDecorations {
    const decorations = new CoverageDecorations(
      this.isDarkTheme(),
      this.mediaDir,
    );
    this.trackDisposable(decorations);
    return decorations;
  }

  private trackDisposable<T extends vscode.Disposable>(disposable: T): T {
    this.disposables.push(disposable);
    return disposable;
  }

  /**
   * Activate the extension
   */
  async activate(context: vscode.ExtensionContext): Promise<void> {
    this.log(
      "EyeCov activated. Open a file to see coverage; output will appear here.",
    );
    this.registerMcpServer(context);
    await this.initializeCoverage();

    // Register commands
    const showCommand = vscode.commands.registerCommand(
      "eyecov.showCoverage",
      () => {
        this.coverageEnabled = true;
        this.updateAllEditors();
        vscode.window.showInformationMessage("Coverage display enabled");
      },
    );

    const hideCommand = vscode.commands.registerCommand(
      "eyecov.hideCoverage",
      () => {
        this.coverageEnabled = false;
        this.clearAllDecorations();
        vscode.window.showInformationMessage("Coverage display disabled");
      },
    );

    const toggleCommand = vscode.commands.registerCommand(
      "eyecov.toggleCoverage",
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
      "eyecov.showCoverageInfo",
      () => {
        if (!this.hasCoverageSource()) {
          vscode.window.showWarningMessage(
            "EyeCov: No coverage source (no supported coverage artifacts found in workspace)",
          );
          return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage("EyeCov: No active editor");
          return;
        }

        const filePath = editor.document.uri.fsPath;
        this.getFileCoverage(filePath)
          .then((result) => {
            if ("noCoverage" in result) {
              vscode.window.showInformationMessage(
                `EyeCov: No coverage data for ${path.basename(filePath)} (${result.reason})`,
              );
              return;
            }

            const coverage = result.coverage;
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
            this.log(`[coverage-info] ${message}`);
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(
              `EyeCov: Error getting coverage info: ${message}`,
            );
          });
      },
    );

    const rereadCoverageCommand = vscode.commands.registerCommand(
      "eyecov.rereadCoverage",
      async () => {
        await this.rereadCoverage();
        vscode.window.showInformationMessage("EyeCov: Coverage re-read");
      },
    );

    const showDebugOutputCommand = vscode.commands.registerCommand(
      "eyecov.showDebugOutput",
      () => {
        try {
          this.outputChannel.show(false);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `EyeCov: Could not show debug output: ${message}`,
          );
        }
      },
    );

    const toggleGutterCommand = vscode.commands.registerCommand(
      "eyecov.toggleGutterCoverage",
      async () => {
        const config = vscode.workspace.getConfiguration("eyecov");
        const current = config.get<boolean>("showGutterCoverage", true);
        await config.update(
          "showGutterCoverage",
          !current,
          vscode.ConfigurationTarget.Global,
        );
        if (this.coverageEnabled) this.updateAllEditors();
        vscode.window.showInformationMessage(
          `EyeCov: Gutter coverage ${!current ? "on" : "off"}`,
        );
      },
    );

    const toggleLineCommand = vscode.commands.registerCommand(
      "eyecov.toggleLineCoverage",
      async () => {
        const config = vscode.workspace.getConfiguration("eyecov");
        const current = config.get<boolean>("showLineCoverage", true);
        await config.update(
          "showLineCoverage",
          !current,
          vscode.ConfigurationTarget.Global,
        );
        if (this.coverageEnabled) this.updateAllEditors();
        vscode.window.showInformationMessage(
          `EyeCov: Line highlight ${!current ? "on" : "off"}`,
        );
      },
    );

    const toggleTrackCoverageThroughEditsCommand =
      vscode.commands.registerCommand(
        "eyecov.toggleTrackCoverageThroughEdits",
        async () => {
          const config = vscode.workspace.getConfiguration("eyecov");
          const current = config.get<boolean>(
            "trackCoverageThroughEdits",
            true,
          );
          await config.update(
            "trackCoverageThroughEdits",
            !current,
            vscode.ConfigurationTarget.Global,
          );
          if (current) {
            this.clearAllTrackedState();
          }
          if (this.coverageEnabled) this.updateAllEditors();
          vscode.window.showInformationMessage(
            `EyeCov: Track coverage through edits ${!current ? "on" : "off"}`,
          );
        },
      );

    const debugGetTrackedStateCommand = vscode.commands.registerCommand(
      "eyecov._debugGetTrackedState",
      () => Array.from(this.trackedByUri.keys()),
    );

    const debugGetTrackedStateDetailsCommand = vscode.commands.registerCommand(
      "eyecov._debugGetTrackedStateDetails",
      () => {
        const result: Record<
          string,
          {
            coveredLines: number[];
            uncoveredLines: number[];
            uncoverableLines: number[];
          }
        > = {};
        for (const [uri, { state }] of this.trackedByUri.entries()) {
          result[uri] = {
            coveredLines: state.coveredLines.slice(),
            uncoveredLines: state.uncoveredLines.slice(),
            uncoverableLines: state.uncoverableLines.slice(),
          };
        }
        return result;
      },
    );

    const debugClearTrackedStateForUriCommand = vscode.commands.registerCommand(
      "eyecov._debugClearTrackedStateForUri",
      (uriString: string) => {
        if (typeof uriString === "string") {
          this.clearTrackedStateForUri(uriString);
        }
      },
    );

    const debugReloadCoverageCommand = vscode.commands.registerCommand(
      "eyecov._debugReloadCoverage",
      () => this.reloadCoverage(),
    );

    this.trackDisposable(showCommand);
    this.trackDisposable(hideCommand);
    this.trackDisposable(toggleCommand);
    this.trackDisposable(showInfoCommand);
    this.trackDisposable(rereadCoverageCommand);
    this.trackDisposable(showDebugOutputCommand);
    this.trackDisposable(toggleGutterCommand);
    this.trackDisposable(toggleLineCommand);
    this.trackDisposable(toggleTrackCoverageThroughEditsCommand);
    this.trackDisposable(debugGetTrackedStateCommand);
    this.trackDisposable(debugGetTrackedStateDetailsCommand);
    this.trackDisposable(debugClearTrackedStateForUriCommand);
    this.trackDisposable(debugReloadCoverageCommand);

    // Watch for editor changes
    const onDidChangeActiveEditor = vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        if (editor && this.coverageEnabled) {
          this.updateEditor(editor);
        } else if (!editor) {
          this.updateCoverageStatus(null);
        }
      },
    );

    // Watch for document changes
    const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(
      (event) => {
        const trackThroughEdits = vscode.workspace
          .getConfiguration("eyecov")
          .get<boolean>("trackCoverageThroughEdits", true);
        if (!trackThroughEdits) {
          if (
            vscode.window.activeTextEditor &&
            event.document === vscode.window.activeTextEditor.document &&
            this.coverageEnabled
          ) {
            this.updateEditor(vscode.window.activeTextEditor);
          }
          return;
        }

        const uriKey = event.document.uri.toString();
        const tracked = this.trackedByUri.get(uriKey);
        const editor = vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.toString() === uriKey,
        );
        const recoverable = this.recoverableByUri.get(uriKey);

        // Cursor can emit document change events with no content changes.
        // Treat them as no-ops so they do not overwrite the recoverable
        // snapshot needed for the following real undo/redo event.
        if (event.contentChanges.length === 0) {
          return;
        }

        const restored = tryRestoreTrackedCoverageEntry({
          reason: event.reason,
          currentDocumentText: event.document.getText(),
          recoverableEntries: recoverable,
        });
        const debugEdits = vscode.workspace
          .getConfiguration("eyecov")
          .get<boolean>("debug", false);
        if (debugEdits) {
          this.log(
            `[edit] reason=${String(event.reason)} tracked=${tracked != null} recoverable=${recoverable != null} restored=${restored != null} changes=${JSON.stringify(
              event.contentChanges.map((change) => ({
                range: {
                  start: {
                    line: change.range.start.line,
                    character: change.range.start.character,
                  },
                  end: {
                    line: change.range.end.line,
                    character: change.range.end.character,
                  },
                },
                text: change.text,
              })),
            )}`,
          );
        }
        if (this.coverageEnabled && restored) {
          this.trackedByUri.set(uriKey, restored);
          if (tracked) {
            this.recoverableByUri.set(
              uriKey,
              pushRecoverableEntry(recoverable, tracked),
            );
          } else {
            this.recoverableByUri.delete(uriKey);
          }
          this.currentCoverage = trackedStateToCoverageData(restored.state);
          if (editor) {
            this.applyDecorations(editor, this.currentCoverage);
          }
          if (
            vscode.window.activeTextEditor &&
            event.document === vscode.window.activeTextEditor.document
          ) {
            this.updateCoverageStatus(this.currentCoverage);
          }
          return;
        }

        if (!this.coverageEnabled || !tracked) {
          if (recoverable && event.reason === undefined) {
            this.recoverableByUri.delete(uriKey);
          }
          if (
            vscode.window.activeTextEditor &&
            event.document === vscode.window.activeTextEditor.document &&
            this.coverageEnabled
          ) {
            this.updateEditor(vscode.window.activeTextEditor);
          }
          return;
        }

        if (!editor) {
          return;
        }

        const { state: existingState, editCount: editCountBefore } = tracked;
        const contentChanges = event.contentChanges.map(
          (change): ContentChange => {
            const currentLineText = event.document.lineAt(
              change.range.start.line,
            ).text;
            const nextLineIndex = change.range.start.line + 1;
            const nextLineText =
              nextLineIndex < event.document.lineCount
                ? event.document.lineAt(nextLineIndex).text
                : "";

            return normalizeContentChangeFromZeroBased({
              range: {
                start: {
                  line: change.range.start.line,
                  character: change.range.start.character,
                },
                end: {
                  line: change.range.end.line,
                  character: change.range.end.character,
                },
              },
              text: change.text,
              preserveStartLine: shouldPreserveStartLineOnInsert(
                currentLineText,
                nextLineText,
                change,
              ),
              shiftStartLine: shouldShiftStartLineOnInsert(
                currentLineText,
                nextLineText,
                change,
              ),
            });
          },
        );
        const result = applyContentChangesToTrackedState(
          existingState,
          contentChanges,
          editCountBefore,
        );

        if (result.kind === "invalidated") {
          this.recoverableByUri.set(
            uriKey,
            pushRecoverableEntry(recoverable, tracked),
          );
          this.trackedByUri.delete(uriKey);
          this.clearDecorationsForEditor(editor);
          return;
        }

        this.recoverableByUri.set(
          uriKey,
          pushRecoverableEntry(recoverable, tracked),
        );
        this.trackedByUri.set(
          uriKey,
          createTrackedCoverageEntry(
            result.state,
            result.newEditCount,
            event.document.getText(),
          ),
        );
        this.currentCoverage = result.coverage;
        this.applyDecorations(editor, result.coverage);
      },
    );

    const onDidCloseTextDocument = vscode.workspace.onDidCloseTextDocument(
      (document) => {
        this.clearTrackedStateForUri(document.uri.toString());
      },
    );

    const onDidChangeActiveColorTheme =
      vscode.window.onDidChangeActiveColorTheme(() => {
        this.recreateDecorationsForTheme();
      });

    this.trackDisposable(onDidChangeActiveEditor);
    this.trackDisposable(onDidChangeTextDocument);
    this.trackDisposable(onDidCloseTextDocument);
    this.trackDisposable(onDidChangeActiveColorTheme);

    this.watchCoverage();

    this.startPrewarmIfEnabled();

    this.statusBarCoverage.show();

    if (this.coverageEnabled) {
      const showOnOpen = vscode.workspace
        .getConfiguration("eyecov")
        .get<boolean>("showCoverageOnOpen", true);
      if (showOnOpen) {
        this.updateAllEditors();
      }
    }

    context.subscriptions.push(this);
  }

  private hasCoverageSource(): boolean {
    return this.resolver !== null;
  }

  /** Remove tracked coverage state for a document (e.g. on close). */
  private clearTrackedStateForUri(uriKey: string): void {
    this.trackedByUri.delete(uriKey);
    this.recoverableByUri.delete(uriKey);
  }

  /** Clear all tracked coverage state (e.g. on coverage reload). */
  private clearAllTrackedState(): void {
    this.trackedByUri.clear();
    this.recoverableByUri.clear();
  }

  private registerMcpServer(context: vscode.ExtensionContext): void {
    const workspaceConfig = vscode.workspace.getConfiguration("eyecov");
    if (!isMcpServerEnabled(workspaceConfig)) {
      this.log("MCP server is disabled by setting eyecov.enableMcpServer.");
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
          "EyeCov",
          process.execPath,
          [serverScriptPath],
          {
            EYECOV_EXTENSION_VERSION: extensionVersion,
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

    this.trackDisposable(provider);
  }

  /**
   * Get coverage record and mapped CoverageData for a file from the resolver.
   * Returns noCoverage with reason when the file has no coverage or report is stale.
   */
  private async getFileCoverage(
    filePath: string,
  ): Promise<
    | { record: CoverageRecord; coverage: CoverageData; sourceFormat?: string }
    | { noCoverage: true; reason: "no-artifact" | "stale" }
  > {
    if (!this.resolver) {
      return { noCoverage: true, reason: "no-artifact" };
    }
    const result = await this.resolver.getCoverage(filePath);
    if (!result.record) {
      return {
        noCoverage: true,
        reason: result.rejectReason ?? "no-artifact",
      };
    }
    const record = result.record;
    this.log(
      `[coverage-html] ${path.basename(filePath)}: ${record.uncoveredLines.size} uncovered line(s): [${[...record.uncoveredLines].sort((a, b) => a - b).join(", ")}]`,
    );
    return {
      record,
      coverage: recordToCoverageData(record),
      sourceFormat: record.sourceFormat ?? result.sourceFormat,
    };
  }

  /**
   * Initialize coverage from config (.eyecov.json / eyecov.json) or defaults.
   */
  private async initializeCoverage(): Promise<void> {
    this.workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const workspaceFolders =
      vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ??
      [];
    const config = loadCoverageConfig(this.workspaceFolder ?? "");
    const adapters = createAdaptersFromConfig(config);
    const coverageHtmlDir = getPhpUnitHtmlDir(config);
    const coverageRoots = CoverageHtmlReader.findCoverageRoots(
      workspaceFolders,
      coverageHtmlDir,
    );

    const workspaceConfig = vscode.workspace.getConfiguration("eyecov");
    const debug = workspaceConfig.get<boolean>("debug", false);
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
      this.log(`[init] coverage-html at ${coverageRoots.join(", ")}`);
    }
  }

  /**
   * Watch coverage artifacts for changes (PHPUnit HTML folder and shared-file format artifacts).
   * When any watched file changes, reload coverage and update editors.
   */
  private watchCoverage(): void {
    const workspaceFolders =
      vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
    const config = loadCoverageConfig(this.workspaceFolder ?? "");
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
      const htmlWatcher = this.trackDisposable(
        vscode.workspace.createFileSystemWatcher(htmlGlob),
      );
      this.trackDisposable(htmlWatcher.onDidChange(onChanged));
    }

    // Watch shared-file coverage artifact path(s) per workspace root
    const artifactPaths = getCoverageArtifactPathsToWatch(
      config,
      workspaceFolders,
    );
    for (const artifactPath of artifactPaths) {
      const artifactWatcher = this.trackDisposable(
        vscode.workspace.createFileSystemWatcher(artifactPath),
      );
      this.trackDisposable(artifactWatcher.onDidChange(onChanged));
      this.trackDisposable(artifactWatcher.onDidCreate(onChanged));
    }
  }

  /**
   * Start background prewarm after a short delay when eyecov.prewarmCoverageCache is true.
   * Fire-and-forget: does not block activation.
   */
  private startPrewarmIfEnabled(): void {
    const workspaceConfig = vscode.workspace.getConfiguration("eyecov");
    if (!isPrewarmCoverageCacheEnabled(workspaceConfig)) {
      return;
    }
    const delayMs = 2000;
    this.prewarmTimer = setTimeout(() => {
      this.prewarmTimer = null;
      const workspaceFolders =
        vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
      if (!this.resolver || workspaceFolders.length === 0) {
        return;
      }
      for (const root of workspaceFolders) {
        const config = loadCoverageConfig(root);
        const listed = listCoveredPathsFromFirstFormat([root], config);
        this.log(
          `[prewarm] starting for ${root} (${listed.formatType}, ${listed.paths.length} path(s))`,
        );
        prewarmCoverageForRoot(root, {
          listPaths: () => listed,
          getCoverage: (p) =>
            this.resolver!.getCoverage(p).then((r) => r.record),
          batchSize: 20,
        })
          .then(() => {
            this.log(`[prewarm] completed for ${root}`);
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.log(`[prewarm] failed for ${root}: ${message}`);
            // Cache will be built on-demand if prewarm fails.
            console.error(`[EyeCov] prewarm error: ${message}`);
          });
      }
    }, delayMs);
  }

  private recreateDecorationsForTheme(): void {
    const previous = this.decorations;
    this.decorations = this.createDecorations();
    previous.dispose();
    this.disposables = this.disposables.filter((entry) => entry !== previous);
    if (this.coverageEnabled) {
      this.updateAllEditors();
    } else {
      this.clearAllDecorations();
    }
  }

  private async reloadCoverage(): Promise<void> {
    this.clearAllTrackedState();
    this.coverageHtml = null;
    this.resolver = null;
    await this.initializeCoverage();
  }

  private async rereadCoverage(): Promise<void> {
    await this.reloadCoverage();
    if (this.coverageEnabled) {
      this.updateAllEditors();
    } else {
      this.updateCoverageStatus(null);
    }
  }

  private isDarkTheme(): boolean {
    const kind = vscode.window.activeColorTheme.kind;
    return (
      kind === vscode.ColorThemeKind.Dark ||
      kind === vscode.ColorThemeKind.HighContrast
    );
  }

  private appendDebugLogToFile(msg: string): void {
    const workspaceRoot =
      this.workspaceFolder ??
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    try {
      const dir = path.join(workspaceRoot, ".eyecov");
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const logPath = path.join(dir, "debug.log");
      fs.appendFileSync(
        logPath,
        `${new Date().toISOString()} ${msg}\n`,
        "utf8",
      );
    } catch {
      // Ignore file logging failures; output channel is still attempted below.
    }
  }

  private log(msg: string): void {
    if (
      !vscode.workspace.getConfiguration("eyecov").get<boolean>("debug", false)
    )
      return;
    this.appendDebugLogToFile(msg);
    this.outputChannel.appendLine(msg);
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
      const uriKey = editor.document.uri.toString();
      const trackThroughEdits = vscode.workspace
        .getConfiguration("eyecov")
        .get<boolean>("trackCoverageThroughEdits", true);
      const existingState = this.trackedByUri.get(uriKey)?.state;

      let coverage: CoverageData | null = null;

      if (trackThroughEdits && existingState) {
        coverage = trackedStateToCoverageData(existingState);
      } else {
        const result = await this.getFileCoverage(filePath);
        if ("noCoverage" in result) {
          this.updateCoverageStatus(null, {
            hasSource: true,
            noCoverageReason: result.reason,
            workspaceFolder: this.workspaceFolder,
            activeFilePath: filePath,
          });
          this.log(
            `[update] No coverage for ${path.basename(filePath)} (${result.reason})`,
          );
          return;
        }

        const state = recordToTrackedState(
          result.record,
          editor.document.version,
        );
        if (trackThroughEdits) {
          this.trackedByUri.set(
            uriKey,
            createTrackedCoverageEntry(state, 0, editor.document.getText()),
          );
          this.recoverableByUri.delete(uriKey);
        }
        coverage = trackedStateToCoverageData(state);
      }

      if (!coverage) {
        this.updateCoverageStatus(null, {
          hasSource: true,
          workspaceFolder: this.workspaceFolder,
          activeFilePath: filePath,
        });
        this.log(`[update] No coverage for ${path.basename(filePath)}`);
        return;
      }

      this.currentCoverage = coverage;
      await this.applyDecorations(editor, coverage);

      const coveragePercent = coverage.file.lineCoveragePercent;
      const covered = coverage.file.coveredLines ?? coverage.coveredLines.size;
      const total = coverage.file.totalLines || editor.document.lineCount;

      this.log(
        `[update] Coverage loaded for ${path.basename(filePath)}: ${coveragePercent?.toFixed(1)}% (${covered}/${total} lines)`,
      );

      this.updateCoverageStatus(coverage);
    } catch (error: unknown) {
      this.updateCoverageStatus(null);
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[EyeCov] error updating coverage for ${filePath}: ${message}`,
      );
      vscode.window.showErrorMessage(
        `EyeCov: Error loading coverage - ${message}`,
      );
    }
  }

  /**
   * Update coverage status bar. Pass noCoverageContext when coverage is null
   * so the bar can show reason (stale, no artifact), relative path, etc.
   */
  private updateCoverageStatus(
    coverage: CoverageData | null,
    noCoverageContext?: StatusBarNoCoverageContext,
  ): void {
    const noCovCtx: StatusBarNoCoverageContext | undefined =
      noCoverageContext ??
      (coverage === null
        ? {
            hasSource: this.hasCoverageSource(),
            workspaceFolder: this.workspaceFolder,
            activeFilePath: vscode.window.activeTextEditor?.document.uri.fsPath,
          }
        : { hasSource: true, workspaceFolder: this.workspaceFolder });
    const content = getStatusBarContent(coverage, {
      coverageEnabled: this.coverageEnabled,
      noCoverageContext: noCovCtx,
    });
    const nextState: StatusBarRenderState = {
      text: content.text,
      tooltip: content.tooltip,
      backgroundColor: content.backgroundColor,
      show: content.show,
    };
    if (
      this.lastStatusBarRender &&
      this.lastStatusBarRender.text === nextState.text &&
      this.lastStatusBarRender.tooltip === nextState.tooltip &&
      this.lastStatusBarRender.backgroundColor === nextState.backgroundColor &&
      this.lastStatusBarRender.show === nextState.show
    ) {
      return;
    }
    this.lastStatusBarRender = nextState;
    this.statusBarCoverage.text = content.text;
    this.statusBarCoverage.tooltip = content.tooltip;
    this.statusBarCoverage.backgroundColor = content.backgroundColor
      ? new vscode.ThemeColor(content.backgroundColor)
      : undefined;
    if (content.show) {
      this.statusBarCoverage.show();
    } else {
      this.statusBarCoverage.hide();
    }
  }

  /**
   * Apply coverage decorations to editor
   */
  private async applyDecorations(
    editor: vscode.TextEditor,
    coverage: CoverageData,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("eyecov");
    const showCovered = config.get<boolean>("showCovered", true);
    const showUncovered = config.get<boolean>("showUncovered", true);
    const showLineCoverage = config.get<boolean>("showLineCoverage", true);
    const showGutterCoverage = config.get<boolean>("showGutterCoverage", true);
    const totalLines = editor.document.lineCount;

    const plan = getDecorationPlan(coverage, {
      showCovered,
      showUncovered,
      showLineCoverage,
      showGutterCoverage,
      totalLines,
    });

    const toRanges = (lineNums: number[]) =>
      lineNums.map((n) => editor.document.lineAt(n - 1).range);

    if (plan.useGranular && showLineCoverage && plan.byStatus) {
      editor.setDecorations(
        this.decorations.coveredSmallWithBackground,
        toRanges(plan.byStatus.get(LINE_STATUS.COVERED_SMALL) ?? []),
      );
      editor.setDecorations(
        this.decorations.coveredMediumWithBackground,
        toRanges(plan.byStatus.get(LINE_STATUS.COVERED_MEDIUM) ?? []),
      );
      editor.setDecorations(
        this.decorations.coveredLargeWithBackground,
        toRanges(plan.byStatus.get(LINE_STATUS.COVERED_LARGE) ?? []),
      );
      editor.setDecorations(
        this.decorations.warningWithBackground,
        toRanges(plan.byStatus.get(LINE_STATUS.WARNING) ?? []),
      );
      editor.setDecorations(
        this.decorations.uncoveredLineWithBackground,
        toRanges(plan.byStatus.get(LINE_STATUS.UNCOVERED) ?? []),
      );
      editor.setDecorations(
        this.decorations.uncoverableLineWithBackground,
        toRanges(plan.byStatus.get(LINE_STATUS.UNCOVERABLE) ?? []),
      );
      editor.setDecorations(this.decorations.coveredLineWithBackground, []);
    } else {
      this.log(
        `[decorations] ${path.basename(editor.document.uri.fsPath)}: docLines=${totalLines} → covered=${plan.covered.length} uncovered=${plan.uncovered.length}`,
      );
      if (showLineCoverage) {
        editor.setDecorations(
          this.decorations.coveredLineWithBackground,
          toRanges(plan.covered),
        );
        editor.setDecorations(
          this.decorations.uncoveredLineWithBackground,
          toRanges(plan.uncovered),
        );
        editor.setDecorations(
          this.decorations.uncoverableLineWithBackground,
          toRanges(plan.uncoverable),
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
      editor.setDecorations(
        this.decorations.coveredLine,
        toRanges(plan.covered),
      );
      editor.setDecorations(
        this.decorations.uncoveredLine,
        toRanges(plan.uncovered),
      );
      editor.setDecorations(
        this.decorations.uncoverableLine,
        toRanges(plan.uncoverable),
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

  private clearDecorationsForEditor(editor: vscode.TextEditor): void {
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
  }

  /**
   * Clear all coverage decorations
   */
  private clearAllDecorations(): void {
    vscode.window.visibleTextEditors.forEach((editor) => {
      this.clearDecorationsForEditor(editor);
    });
  }

  /**
   * Deactivate the extension
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.prewarmTimer) {
      clearTimeout(this.prewarmTimer);
      this.prewarmTimer = null;
    }
    this.clearAllDecorations();
    for (const disposable of [...this.disposables].reverse()) {
      disposable.dispose();
    }
    this.disposables = [];
  }

  async deactivate(): Promise<void> {
    this.dispose();
  }
}

let extension: CoverageExtension | null = null;

export function activate(context: vscode.ExtensionContext): void {
  extension = new CoverageExtension(context);
  void extension.activate(context);
}

export function deactivate(): Promise<void> {
  if (extension) {
    return extension.deactivate();
  }
  return Promise.resolve();
}
