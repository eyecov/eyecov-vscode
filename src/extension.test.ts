import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const themeListeners: Array<(theme: { kind: number }) => void> = [];
const commandDisposables: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
const eventDisposables: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
const watcherDisposables: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];

let mockConfig: {
  debug: boolean;
  prewarmCoverageCache: boolean;
  showCoverageOnOpen: boolean;
};

let statusBarAssignments: Record<string, number>;
let statusBarItems: Array<{
  command?: string;
  text: string;
  tooltip?: string;
  backgroundColor?: unknown;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}>;
let outputChannel: {
  appendLine: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

interface DecorationOwner {
  dispose: () => void;
}

interface CoverageExtensionInternals {
  registerMcpServer: (context: vscode.ExtensionContext) => void;
  initializeCoverage: () => Promise<void>;
  watchCoverage: () => void;
  startPrewarmIfEnabled: () => void;
  updateAllEditors: () => void;
  updateCoverageStatus: (
    coverage: unknown,
    context?: {
      hasSource: boolean;
      workspaceFolder?: string;
      activeFilePath?: string;
      noCoverageReason?: "no-artifact" | "stale";
    },
  ) => void;
  decorations: DecorationOwner;
  resolver: {
    getCoverage: (
      path: string,
    ) => Promise<{ record: null; rejectReason: "no-artifact" }>;
  } | null;
}

function createDisposable(store: Array<{ dispose: ReturnType<typeof vi.fn> }>) {
  const disposable = { dispose: vi.fn() };
  store.push(disposable);
  return disposable;
}

function createStatusBarItem() {
  let text = "";
  let tooltip = "";
  let backgroundColor: unknown;

  const itemIndex = statusBarItems.length;
  const item = {
    command: undefined,
    get text() {
      return text;
    },
    set text(value: string) {
      if (itemIndex === 0) {
        statusBarAssignments.text++;
      }
      text = value;
    },
    get tooltip() {
      return tooltip;
    },
    set tooltip(value: string | undefined) {
      if (itemIndex === 0) {
        statusBarAssignments.tooltip++;
      }
      tooltip = value ?? "";
    },
    get backgroundColor() {
      return backgroundColor;
    },
    set backgroundColor(value: unknown) {
      if (itemIndex === 0) {
        statusBarAssignments.backgroundColor++;
      }
      backgroundColor = value;
    },
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };

  statusBarItems.push(item);
  return item;
}

vi.mock("vscode", () => {
  class ThemeColor {
    constructor(public readonly id: string) {}
  }

  return {
    ColorThemeKind: {
      Light: 1,
      Dark: 2,
      HighContrast: 3,
    },
    StatusBarAlignment: {
      Right: 1,
    },
    OverviewRulerLane: {
      Left: 1,
    },
    ThemeColor,
    Uri: {
      file: (value: string) => ({ fsPath: value }),
    },
    window: {
      activeColorTheme: { kind: 1 },
      activeTextEditor: undefined,
      visibleTextEditors: [],
      createTextEditorDecorationType: vi.fn(() => ({
        dispose: vi.fn(),
      })),
      createOutputChannel: vi.fn(() => {
        outputChannel = {
          appendLine: vi.fn(),
          show: vi.fn(),
          dispose: vi.fn(),
        };
        return outputChannel;
      }),
      createStatusBarItem: vi.fn(() => createStatusBarItem()),
      onDidChangeActiveTextEditor: vi.fn(() =>
        createDisposable(eventDisposables),
      ),
      onDidChangeActiveColorTheme: vi.fn((callback) => {
        themeListeners.push(callback);
        return createDisposable(eventDisposables);
      }),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
      getConfiguration: vi.fn(() => ({
        get: (key: string, fallback?: unknown) => {
          if (key === "debug") return mockConfig.debug;
          if (key === "prewarmCoverageCache")
            return mockConfig.prewarmCoverageCache;
          if (key === "showCoverageOnOpen")
            return mockConfig.showCoverageOnOpen;
          return fallback;
        },
      })),
      onDidChangeTextDocument: vi.fn(() => createDisposable(eventDisposables)),
      onDidCloseTextDocument: vi.fn(() => createDisposable(eventDisposables)),
      createFileSystemWatcher: vi.fn(() => {
        const watcher = {
          onDidChange: vi.fn(),
          onDidCreate: vi.fn(),
          dispose: vi.fn(),
        };
        watcherDisposables.push(watcher);
        return watcher;
      }),
    },
    commands: {
      registerCommand: vi.fn(() => createDisposable(commandDisposables)),
    },
    lm: undefined,
  };
});

vi.mock("./coverage-data-mapper", () => ({
  getDecorationPlan: vi.fn(() => ({
    useGranular: false,
    covered: [],
    uncovered: [],
    uncoverable: [],
  })),
  getStatusBarContent: vi.fn(() => ({
    text: "EyeCov: No coverage",
    tooltip: "No coverage",
    backgroundColor: undefined,
    show: true,
  })),
  recordToCoverageData: vi.fn(),
}));

vi.mock("./coverage-html-reader", () => ({
  CoverageHtmlReader: class {
    static findCoverageRoots() {
      return [];
    }
  },
}));

vi.mock("./coverage-config", () => ({
  loadCoverageConfig: vi.fn(() => ({ formats: [] })),
  getPhpUnitHtmlDir: vi.fn(() => "coverage-html"),
  getPhpUnitHtmlSourceSegment: vi.fn(() => "auto"),
  getCoverageArtifactPathsToWatch: vi.fn(() => []),
  getCoverageArtifactPaths: vi.fn(() => []),
}));

vi.mock("./coverage-aggregate", () => ({
  listCoveredPathsFromFirstFormat: vi.fn(() => ({
    paths: ["/workspace/src/demo.ts"],
    formatType: "lcov",
  })),
}));

vi.mock("./coverage-cache", () => ({
  deleteCoverageCache: vi.fn(),
}));

const prewarmCoverageForRoot = vi.fn<(...args: unknown[]) => Promise<void>>(
  () => Promise.resolve(),
);
vi.mock("./coverage-prewarm", () => ({
  prewarmCoverageForRoot,
}));

vi.mock("./coverage-resolver", () => ({
  CoverageResolver: class {
    async getCoverage() {
      return { record: null, rejectReason: "no-artifact" };
    }
  },
  createAdaptersFromConfig: vi.fn(() => []),
}));

vi.mock("./mcp/settings", () => ({
  isMcpServerEnabled: vi.fn(() => false),
  isPrewarmCoverageCacheEnabled: vi.fn(() => mockConfig.prewarmCoverageCache),
}));

vi.mock("./edit-tracking", () => ({
  applyContentChangesToTrackedState: vi.fn(),
  normalizeContentChangeFromZeroBased: vi.fn(),
  recordToTrackedState: vi.fn(),
  trackedStateToCoverageData: vi.fn(),
}));

vi.mock("./edit-boundary-detection", () => ({
  shouldPreserveStartLineOnInsert: vi.fn(() => false),
  shouldShiftStartLineOnInsert: vi.fn(() => false),
}));

vi.mock("./edit-recovery", () => ({
  createTrackedCoverageEntry: vi.fn(),
  pushRecoverableEntry: vi.fn(),
  tryRestoreTrackedCoverageEntry: vi.fn(() => null),
}));

describe("CoverageExtension", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    themeListeners.length = 0;
    commandDisposables.length = 0;
    eventDisposables.length = 0;
    watcherDisposables.length = 0;
    mockConfig = {
      debug: false,
      prewarmCoverageCache: false,
      showCoverageOnOpen: false,
    };
    statusBarItems = [];
    statusBarAssignments = {
      text: 0,
      tooltip: 0,
      backgroundColor: 0,
    };
    outputChannel = {
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    };
  });

  it("recreates decorations and refreshes editors when the theme changes", async () => {
    const vscode = await import("vscode");
    const { CoverageExtension } = await import("./extension");
    const context = {
      subscriptions: [],
      asAbsolutePath: (value: string) => `/ext/${value}`,
      extensionUri: "/ext",
      extension: { packageJSON: { version: "1.0.0" } },
    } as unknown as vscode.ExtensionContext;

    const extension = new CoverageExtension(context);
    const internals = extension as unknown as CoverageExtensionInternals;
    internals.registerMcpServer = vi.fn();
    internals.initializeCoverage = vi.fn(async () => {});
    internals.watchCoverage = vi.fn();
    internals.startPrewarmIfEnabled = vi.fn();
    const updateAllEditors = vi.fn();
    internals.updateAllEditors = updateAllEditors;

    await extension.activate(context);

    const originalDecorations = internals.decorations;
    const originalDispose = vi.spyOn(originalDecorations, "dispose");
    (vscode.window.activeColorTheme as unknown as { kind: number }).kind =
      vscode.ColorThemeKind.Dark;
    themeListeners[0]({ kind: vscode.ColorThemeKind.Dark });

    expect(originalDispose).toHaveBeenCalledTimes(1);
    expect(internals.decorations).not.toBe(originalDecorations);
    expect(updateAllEditors).toHaveBeenCalledTimes(1);
  });

  it("skips redundant status bar writes when content is unchanged", async () => {
    const { CoverageExtension } = await import("./extension");
    const context = {
      subscriptions: [],
      asAbsolutePath: (value: string) => `/ext/${value}`,
    } as unknown as vscode.ExtensionContext;
    const extension = new CoverageExtension(context);
    const internals = extension as unknown as CoverageExtensionInternals;
    const coverageStatusBarItem = statusBarItems[0]!;

    statusBarAssignments.text = 0;
    statusBarAssignments.tooltip = 0;
    statusBarAssignments.backgroundColor = 0;
    coverageStatusBarItem.show.mockClear();
    coverageStatusBarItem.hide.mockClear();

    internals.updateCoverageStatus(null, {
      hasSource: false,
      workspaceFolder: "/workspace",
      activeFilePath: "/workspace/src/demo.ts",
    });
    internals.updateCoverageStatus(null, {
      hasSource: false,
      workspaceFolder: "/workspace",
      activeFilePath: "/workspace/src/demo.ts",
    });

    expect(statusBarAssignments.text).toBe(1);
    expect(statusBarAssignments.tooltip).toBe(1);
    expect(statusBarAssignments.backgroundColor).toBe(1);
    expect(coverageStatusBarItem.show).toHaveBeenCalledTimes(1);
    expect(coverageStatusBarItem.hide).not.toHaveBeenCalled();
  });

  it("disposes owned resources through the extension lifecycle", async () => {
    const { CoverageExtension } = await import("./extension");
    const context = {
      subscriptions: [],
      asAbsolutePath: (value: string) => `/ext/${value}`,
      extensionUri: "/ext",
      extension: { packageJSON: { version: "1.0.0" } },
    } as unknown as vscode.ExtensionContext;
    const extension = new CoverageExtension(context);
    const internals = extension as unknown as CoverageExtensionInternals;
    const coverageStatusBarItem = statusBarItems[0]!;
    const prewarmStatusBarItem = statusBarItems[1]!;
    internals.registerMcpServer = vi.fn();
    internals.initializeCoverage = vi.fn(async () => {});
    internals.watchCoverage = vi.fn();
    internals.startPrewarmIfEnabled = vi.fn();

    await extension.activate(context);
    const decorationsDispose = vi.spyOn(internals.decorations, "dispose");
    extension.dispose();

    expect(coverageStatusBarItem.dispose).toHaveBeenCalledTimes(1);
    expect(prewarmStatusBarItem.dispose).toHaveBeenCalledTimes(1);
    expect(outputChannel.dispose).toHaveBeenCalledTimes(1);
    expect(decorationsDispose).toHaveBeenCalledTimes(1);
    expect(
      commandDisposables.every((d) => d.dispose.mock.calls.length === 1),
    ).toBe(true);
    expect(
      eventDisposables.every((d) => d.dispose.mock.calls.length === 1),
    ).toBe(true);
  });

  it("logs prewarm start and success when debug logging is enabled", async () => {
    vi.useFakeTimers();
    mockConfig.debug = true;
    mockConfig.prewarmCoverageCache = true;

    const { CoverageExtension } = await import("./extension");
    const context = {
      subscriptions: [],
      asAbsolutePath: (value: string) => `/ext/${value}`,
    } as unknown as vscode.ExtensionContext;
    const extension = new CoverageExtension(context);
    const internals = extension as unknown as CoverageExtensionInternals;
    internals.resolver = {
      getCoverage: vi.fn(async () => ({
        record: null,
        rejectReason: "no-artifact" as const,
      })),
    };

    internals.startPrewarmIfEnabled();
    await vi.advanceTimersByTimeAsync(2000);

    expect(prewarmCoverageForRoot).toHaveBeenCalledTimes(1);
    expect(outputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining("[prewarm] starting for /workspace"),
    );
    expect(outputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining("[prewarm] completed for /workspace"),
    );

    vi.useRealTimers();
  });

  it("shows prewarm progress and passes visible editors as priority paths", async () => {
    vi.useFakeTimers();
    mockConfig.prewarmCoverageCache = true;

    const vscode = await import("vscode");
    vscode.window.visibleTextEditors = [
      { document: { uri: { fsPath: "/workspace/src/visible.ts" } } },
    ] as unknown as typeof vscode.window.visibleTextEditors;

    prewarmCoverageForRoot.mockImplementationOnce(
      async (...args: unknown[]) => {
        const options = args[1] as {
          onProgress?: (current: number, total: number) => void;
        };
        options.onProgress?.(1, 3);
        options.onProgress?.(3, 3);
      },
    );

    const { CoverageExtension } = await import("./extension");
    const context = {
      subscriptions: [],
      asAbsolutePath: (value: string) => `/ext/${value}`,
    } as unknown as vscode.ExtensionContext;
    const extension = new CoverageExtension(context);
    const internals = extension as unknown as CoverageExtensionInternals;
    const prewarmStatusBarItem = statusBarItems[1]!;
    internals.resolver = {
      getCoverage: vi.fn(async () => ({
        record: null,
        rejectReason: "no-artifact" as const,
      })),
    };

    internals.startPrewarmIfEnabled();
    await vi.advanceTimersByTimeAsync(2000);

    expect(prewarmCoverageForRoot).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        priorityPaths: ["/workspace/src/visible.ts"],
      }),
    );
    expect(prewarmStatusBarItem.text).toBe(
      "$(sync~spin) EyeCov: Indexing (1/3)...",
    );
    expect(prewarmStatusBarItem.show).toHaveBeenCalledTimes(1);
    expect(prewarmStatusBarItem.hide).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
