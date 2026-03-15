# Coverage Architecture

## Goal

Define the target architecture for coverage lookup and editor highlighting.

This document describes the technical structure. For the canonical data flow and shared runtime semantics, see [COVERAGE_MODEL.md](COVERAGE_MODEL.md). For a feature-level overview (editor, formats, config, MCP), see [COVERAGE_FEATURES.md](COVERAGE_FEATURES.md). Roadmap and future work live in [COVERAGE_ROADMAP.md](COVERAGE_ROADMAP.md). The **Current implementation** section below reflects the codebase; the **Main Components** and **Freshness Model** sections describe both current shape and possible evolution.

- [COVERAGE_FEATURES.md](COVERAGE_FEATURES.md)
- [COVERAGE_ROADMAP.md](COVERAGE_ROADMAP.md)
- [MCP_SERVER.md](MCP_SERVER.md)

## Architectural Principles

- Keep the architecture small and readable.
- Optimize for fast file-open highlighting.
- Prefer fast execution, but not at the expense of bloated memory use.
- Use version-specific adapters for unstable coverage formats.
- Normalize all accepted coverage into one shared runtime coverage model.
- Keep the hot path free of unnecessary abstraction and allocation.
- Prefer direct path resolution and cheap freshness checks before heavy parsing.

## Runtime Flow

The runtime flow below is the implementation view of the model defined in [COVERAGE_MODEL.md](COVERAGE_MODEL.md).

Target flow when an editor opens a file:

1. Normalize the opened file path.
2. Ask the coverage resolver for matching coverage candidates.
3. For each supported adapter, attempt to locate coverage for the file.
4. Reject any candidate whose coverage artifact is stale relative to the source file.
5. Read the winning coverage artifact.
6. Convert it into the internal format.
7. Cache the normalized internal coverage record.
8. Apply editor decorations from the internal format.

This flow should be asynchronous but avoid unnecessary work on repeated opens of the same file.

## Current implementation

**File layout:**

- **`src/coverage-resolver.ts`** — `CoverageResolver`, `CoverageRecord`, `CoverageAdapter`, `createAdaptersFromConfig(config)`. Adapters are built from config (order and paths).
- **`src/coverage-staleness.ts`** — `isCoverageStale(sourcePath, artifactPath)`. Used by adapters to reject coverage when source is newer than artifact or either path is missing.
- **`src/coverage-runtime.ts`** — `toFileSystemPath`, `resolveFilePath`, `getCandidatePathsForQuery` (query → candidate file paths; extension and MCP then use `CoverageResolver.getCoverage(path)` for each).
- **`src/covflux-config.ts`** — `loadCovfluxConfig(workspaceRoot)`, `DEFAULT_CONFIG`, `getPhpUnitHtmlDir`, `getLcovPath`. Reads `.covflux.json` or `covflux.json`.
- **`src/coverage-formats/phpunit-html/`** — Parser, adapter (`PhpUnitHtmlAdapter`), types; path/read/parse live here. Default dir `coverage-html/`.
- **`src/coverage-formats/lcov/`** — Parser, adapter (`LcovAdapter`); default path `coverage/lcov.info`.
- **`src/coverage-aggregate.ts`** — On-demand path/project aggregation: `listCoveredPaths`, `listCoveredPathsFromFirstFormat`, `aggregateCoverage`, `getPathAggregateResponse`, `getProjectAggregateResponse`. Supports `worstFilesLimit`, `zeroCoverageFilesLimit`, `coveredLinesCutoff`; results include `worstFiles` and optional `zeroCoverageFiles`. Cache-based helpers: `projectAggregateFromCache`, `pathAggregateFromCache` (used by MCP when a valid cache exists).
- **`src/coverage-cache.ts`** — Coverage cache for path/project tools: `writeCoverageCache`, `readCoverageCache`, `deleteCoverageCache`, `buildCoverageCachePayload`. Cache file: `{workspaceRoot}/.covflux/coverage-cache.json` (per-file entries + pre-aggregated project totals).
- **`src/coverage-prewarm.ts`** — Background prewarm: `prewarmCoverageForRoot(workspaceRoot, options)` runs `listPaths` + `getCoverage` in batches (with `setImmediate` between batches), then writes the cache. Used by the extension when `covflux.prewarmCoverageCache` is true (fire-and-forget after a short delay).

**Adapter interface (current):**

```ts
interface CoverageAdapter {
  getCoverage(
    filePath: string,
    workspaceRoots: string[],
  ): Promise<CoverageRecord | null>;
}
```

Resolver calls adapters in config order; first non-null wins. Staleness is enforced inside each adapter: before returning a record, the adapter calls `isCoverageStale(sourcePath, artifactPath)` and returns `null` if stale (see Freshness Model).

**CoverageRecord (current):**

```ts
interface CoverageRecord {
  sourcePath: string;
  coveredLines: Set<number>;
  uncoveredLines: Set<number>;
  uncoverableLines: Set<number>;
  lineCoveragePercent: number | null;
  coverageHtmlPath?: string; // PHPUnit HTML adapter only
  testsByLine?: Map<number, string[]>; // PHPUnit HTML adapter only
  lineStatuses?: Map<number, number>; // optional: S/M/L, uncovered, warning, uncoverable (see coverage-types.ts)
}
```

Optimized for fast line lookup and decoration generation. Optional `coverageHtmlPath` and `testsByLine` are set by the PHPUnit HTML adapter. When present, `lineStatuses` encodes per-line state (e.g. covered-small, covered-medium, covered-large, uncovered, warning, uncoverable) in a single compact map used for editor decorations.

**Coverage cache (prewarm):** When `covflux.prewarmCoverageCache` is true, the extension starts a fire-and-forget prewarm after a short delay: for each workspace root it calls `listCoveredPathsFromFirstFormat` and then `getCoverage` in batches, builds a payload with `buildCoverageCachePayload`, and writes `.covflux/coverage-cache.json`. On coverage or config change the extension deletes the cache (invalidation). The MCP server reads the cache when handling `coverage_path` and `coverage_project`; if valid it returns aggregates from the cache with `cacheState: "full"`, otherwise it aggregates on demand and returns `cacheState: "on-demand"`.

## Main Components

### `CoverageResolver`

Coordinates lookup for one source file. **Current:** Takes `workspaceRoots` and `adapters` (from `createAdaptersFromConfig`). Tries each adapter in order; returns first non-null `CoverageRecord`. No explicit freshness or cache layer yet.

**Current:** Staleness is enforced per adapter (see Freshness Model). **Possible evolution:** Cache parsed records keyed by path and artifact timestamp.

### `CoverageAdapter`

Represents one coverage source format. **Current:** Single method `getCoverage(filePath, workspaceRoots)` returning `CoverageRecord | null`. Each adapter is format-specific (PHPUnit HTML, LCOV); paths come from config or defaults.

**Suggested future shape** (if adding freshness and two-phase lookup):

```ts
interface CoverageAdapter {
  readonly id: string;
  canHandle(workspace: WorkspaceContext): Promise<boolean>;
  findCoverageForFile(
    filePath: string,
    workspace: WorkspaceContext,
  ): Promise<CoverageMatch | null>;
  isFresh(match: CoverageMatch, sourceStat: SourceStat): Promise<boolean>;
  read(match: CoverageMatch): Promise<CoverageRecord | null>;
}
```

Rules: keep `findCoverageForFile` cheap; do heavy parsing in `read` after freshness is confirmed; support both per-file and shared artifacts.

### `CoverageRecord`

**Current shape** (see above): `sourcePath`, `coveredLines`, `uncoveredLines`, `uncoverableLines`, `lineCoveragePercent`, optional `lineStatuses`, `coverageHtmlPath`, `testsByLine`. Fast `Set<number>` lookup for covered/uncovered; optional `lineStatuses` for per-line state (S/M/L, warning, uncoverable) when the adapter supplies it.

**Possible evolution:** Add `sourceVersion` (mtime/size) and optional `trackingMap` for edit-tolerant display when that feature is implemented.

## Supported Adapters for Core

### `PhpUnitHtmlAdapter` (implemented)

**Location:** `src/coverage-formats/phpunit-html/`. Default path `coverage-html/`; overridden by config (`type: "phpunit-html"`, `path`). Optional `sourceSegment` in config (`app` | `src` | `lib` | `auto`); when `auto`, tries those segments per workspace root. File discovery excludes `index.html` and `dashboard.html`. Resolves source file to HTML report path; reads and parses; returns `CoverageRecord` with optional `lineStatuses` (S/M/L, uncovered, warning, uncoverable). Popover content above a size limit is skipped to avoid unbounded parsing. One HTML file per source file. Treated as version-specific for PHPUnit HTML output.

### `LcovAdapter` (implemented)

**Location:** `src/coverage-formats/lcov/`. Default path `coverage/lcov.info`; overridden by config (`type: "lcov"`, `path`). Reads single lcov.info per workspace root; finds matching `SF:` record for the source path; returns `CoverageRecord`. Used for Vitest and other LCOV producers.

### Fixture / test-suite-native format (not implemented)

**Purpose:** Deterministic automated tests without real PHPUnit HTML. Suggested JSON shape in plan; add a new adapter under `coverage-formats/` when needed.

## Freshness Model

**Current (implemented):** Staleness is enforced in `src/coverage-staleness.ts` via `isCoverageStale(sourcePath, artifactPath)`. Each adapter calls it before returning a `CoverageRecord`; if stale, the adapter returns `null`. User-visible rules (mtime comparison, fail-safe when paths unstatable) are in [COVERAGE_FEATURES.md](COVERAGE_FEATURES.md#editor-coverage). **Possible evolution:** compare source size or hash when available.

## Edit Tracking

Optional advanced feature; behavior and non-goals are in [COVERAGE_FEATURES.md](COVERAGE_FEATURES.md#planned-and-optional). **Implementation:** maintain a lightweight line-offset mapping from document change events; support simple insert/delete shifts first; invalidate and fall back to no highlighting when mapping confidence drops.

## Caching

The extension must feel fast.

Recommended cache layers:

- adapter discovery cache per workspace
- coverage match cache per source file path
- parsed `CoverageRecord` cache keyed by source path plus artifact timestamp

Cache keys should not assume the artifact is unique per source file. They should be able to represent:

- source file identity
- artifact identity
- artifact version or timestamp

Cache invalidation triggers:

- source file changed
- coverage artifact changed
- relevant settings changed
- workspace changed

Keep caching simple and observable. Avoid speculative background work until needed.

Cache backend note:

- in-memory cache is the default and simplest choice
- the architecture may later allow an optional persistent cache backend
- a file-based on-disk cache is the most plausible first persistent backend
- external cache services must remain optional and must not be required for the core extension
- persistent cache support is only worth adding if it improves real workloads without making the extension harder to operate

## Performance Rules

Non-negotiables:

- no full-workspace scans on every file open
- no heavy parsing before a candidate is known and freshness is confirmed
- no per-line object graphs in the hot render path
- no broad abstraction layers that make the runtime harder to reason about

Preferred practices:

- use direct path resolution
- parse only what is needed
- cache aggressively but simply
- fail fast
- log only when debug is enabled
