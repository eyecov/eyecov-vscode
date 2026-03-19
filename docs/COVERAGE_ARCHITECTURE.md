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
- **`src/coverage-config.ts`** — `loadCoverageConfig(workspaceRoot)`, `DEFAULT_CONFIG`, `getPhpUnitHtmlDir`, `getLcovPath`, shared artifact watch-path helpers. Reads `.eyecov.json` or `eyecov.json`.
- **`src/coverage-formats/phpunit-html/`** — Parser, adapter (`PhpUnitHtmlAdapter`), types; path/read/parse live here. Default dir `coverage-html/`.
- **`src/coverage-formats/cobertura/`** — Parser and adapter (`CoberturaAdapter`) for a single Cobertura XML artifact. Default path `coverage/cobertura-coverage.xml`.
- **`src/coverage-formats/clover/`** — Parser and adapter (`CloverAdapter`) for a single Clover XML artifact. Default path `coverage/clover.xml`.
- **`src/coverage-formats/lcov/`** — Parser, adapter (`LcovAdapter`); default path `coverage/lcov.info`.
- **`src/coverage-formats/istanbul-json/`** — Parser and adapter (`IstanbulJsonAdapter`) for a single Istanbul/NYC JSON artifact. Default path `coverage/coverage-final.json`.
- **`src/coverage-formats/jacoco/`** — Parser and adapter (`JacocoAdapter`) for a single JaCoCo XML artifact. Default paths `target/site/jacoco/jacoco.xml` and `build/reports/jacoco/test/jacocoTestReport.xml`.
- **`src/coverage-formats/go-coverprofile/`** — Parser and adapter (`GoCoverprofileAdapter`) for a single Go coverprofile artifact. Default path `coverage.out`.
- **`src/coverage-formats/coveragepy-json/`** — Parser and adapter (`CoveragePyJsonAdapter`) for a single coverage.py JSON artifact. Default path `coverage.json`.
- **`src/coverage-formats/opencover/`** — Parser and adapter (`OpenCoverAdapter`) for a single OpenCover XML artifact. Config-only in v1.
- **`src/coverage-formats/xml/`** — Shared helpers for machine-readable single-artifact coverage XML formats (path resolution, normalization, capability helpers).
- **`src/coverage-aggregate.ts`** — On-demand path/project aggregation: `listCoveredPaths`, `listCoveredPathsFromFirstFormat`, `aggregateCoverage`, `getPathAggregateResponse`, `getProjectAggregateResponse`. Supports `worstFilesLimit`, `zeroCoverageFilesLimit`, `coveredLinesCutoff`; results include `worstFiles` and optional `zeroCoverageFiles`. Cache-based helpers: `projectAggregateFromCache`, `pathAggregateFromCache` (used by MCP when a valid cache exists).
- **`src/coverage-cache.ts`** — Coverage cache for path/project tools: `writeCoverageCache`, `readCoverageCache`, `deleteCoverageCache`, `buildCoverageCachePayload`. Cache file: `{workspaceRoot}/.eyecov/coverage-cache.json` (per-file entries + pre-aggregated project totals).
- **`src/coverage-prewarm.ts`** — Background prewarm: `prewarmCoverageForRoot(workspaceRoot, options)` fingerprints artifacts, can skip unchanged work, prioritizes visible-editor paths first, runs `getCoverage` in batches (with `setImmediate` between batches), writes a `partial` cache after the priority pass when background work remains, then writes the final `full` cache. Used by the extension when `eyecov.prewarmCoverageCache` is true (fire-and-forget after a short delay).

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

**Coverage cache (prewarm):** When `eyecov.prewarmCoverageCache` is true, the extension starts a fire-and-forget prewarm after a short delay: for each workspace root it fingerprints configured artifacts, skips the crawl entirely when the fingerprint matches the existing cache, otherwise calls `listCoveredPathsFromFirstFormat`, prioritizes visible editor paths, and resolves coverage in batches. If priority work finishes while background work remains, it writes `.eyecov/coverage-cache.json` with `cacheState: "partial"`. When the full crawl finishes, it overwrites that cache with `cacheState: "full"`. On coverage or config change the extension deletes the cache (invalidation). The MCP server reads the cache when handling `coverage_path`, `coverage_project`, and `coverage_test_priority`; if valid it returns aggregates or priority results from the cache with `cacheState: "partial"` or `"full"`, otherwise it aggregates on demand and returns `cacheState: "on-demand"`.

## Main Components

### `CoverageResolver`

Coordinates lookup for one source file. **Current:** Takes `workspaceRoots` and `adapters` (from `createAdaptersFromConfig`). Tries each adapter in order; returns first non-null `CoverageRecord`. No explicit freshness or cache layer yet.

**Current:** Staleness is enforced per adapter (see Freshness Model). **Possible evolution:** Cache parsed records keyed by path and artifact timestamp.

### `CoverageAdapter`

Represents one coverage source format. **Current:** Single method `getCoverage(filePath, workspaceRoots)` returning `CoverageRecord | null`. Each adapter is format-specific; paths come from config or defaults.

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

**Note:** Edit-tolerant display is implemented via `TrackedCoverageState` and line-delta mapping in `src/edit-tracking.ts`; see [COVERAGE_FEATURES.md](COVERAGE_FEATURES.md#edit-tolerant-tracking).

## Supported Adapters for Core

### `PhpUnitHtmlAdapter` (implemented)

**Location:** `src/coverage-formats/phpunit-html/`. Default path `coverage-html/`; overridden by config (`type: "phpunit-html"`, `path`). Optional `sourceSegment` in config (`app` | `src` | `lib` | `auto`); when `auto`, tries those segments per workspace root. File discovery excludes `index.html` and `dashboard.html`. Resolves source file to HTML report path; reads and parses; returns `CoverageRecord` with optional `lineStatuses` (S/M/L, uncovered, warning, uncoverable). Popover content above a size limit is skipped to avoid unbounded parsing. One HTML file per source file. Treated as version-specific for PHPUnit HTML output.

### `CoberturaAdapter` (implemented)

**Location:** `src/coverage-formats/cobertura/`. Default path `coverage/cobertura-coverage.xml`; overridden by config (`type: "cobertura"`, `path`). Reads one Cobertura XML artifact per workspace root; extracts per-file line coverage and returns `CoverageRecord`. No covering-test data.

### `CloverAdapter` (implemented)

**Location:** `src/coverage-formats/clover/`. Default path `coverage/clover.xml`; overridden by config (`type: "clover"`, `path`). Reads one Clover XML artifact per workspace root; extracts per-file line coverage and returns `CoverageRecord`. No covering-test data.

### `LcovAdapter` (implemented)

**Location:** `src/coverage-formats/lcov/`. Default path `coverage/lcov.info`; overridden by config (`type: "lcov"`, `path`). Reads single lcov.info per workspace root; finds matching `SF:` record for the source path; returns `CoverageRecord`. Used for Vitest and other LCOV producers.

### `IstanbulJsonAdapter` (implemented)

**Location:** `src/coverage-formats/istanbul-json/`. Default path `coverage/coverage-final.json`; overridden by config (`type: "istanbul-json"`, `path`). Reads one Istanbul/NYC JSON artifact per workspace root; maps statement coverage to per-line covered/uncovered state; returns `CoverageRecord`. No covering-test data.

### `JacocoAdapter` (implemented)

**Location:** `src/coverage-formats/jacoco/`. Default paths `target/site/jacoco/jacoco.xml` and `build/reports/jacoco/test/jacocoTestReport.xml`; overridden by config (`type: "jacoco"`, `path`). Reads one JaCoCo XML artifact per workspace root; resolves `package/sourcefile` paths under the workspace root; returns `CoverageRecord`. No covering-test data.

### `GoCoverprofileAdapter` (implemented)

**Location:** `src/coverage-formats/go-coverprofile/`. Default path `coverage.out`; overridden by config (`type: "go-coverprofile"`, `path`). Reads one Go coverprofile per workspace root; expands line ranges to per-line covered/uncovered state; returns `CoverageRecord`. No covering-test data.

### `CoveragePyJsonAdapter` (implemented)

**Location:** `src/coverage-formats/coveragepy-json/`. Default path `coverage.json`; overridden by config (`type: "coveragepy-json"`, `path`). Reads one coverage.py JSON artifact per workspace root; uses `executed_lines` and `missing_lines` for per-line state; returns `CoverageRecord`. No covering-test data.

### `OpenCoverAdapter` (implemented)

**Location:** `src/coverage-formats/opencover/`. Configured via `type: "opencover"`, `path`. Reads one OpenCover XML artifact per workspace root; resolves files from the report file table and sequence points; returns `CoverageRecord`. No covering-test data.

### Machine-readable coverage XML family

Cobertura and Clover are handled as a shared capability family: one XML artifact per workspace root, line-coverage only, no covering-test data. The shared helpers under `src/coverage-formats/xml/` should stay narrow and utility-based so future formats such as PHPUnit coverage XML can reuse them without introducing a broad adapter framework.

### Fixture / test-suite-native format (not implemented)

**Purpose:** Deterministic automated tests without real PHPUnit HTML. Suggested JSON shape in plan; add a new adapter under `coverage-formats/` when needed.

## Freshness Model

**Current (implemented):** Staleness is enforced in `src/coverage-staleness.ts` via `isCoverageStale(sourcePath, artifactPath)`. Each adapter calls it before returning a `CoverageRecord`; if stale, the adapter returns `null`. User-visible rules (mtime comparison, fail-safe when paths unstatable) are in [COVERAGE_FEATURES.md](COVERAGE_FEATURES.md#editor-coverage). **Possible evolution:** compare source size or hash when available.

## Edit Tracking

**Implemented.** When `eyecov.trackCoverageThroughEdits` is true (default), the extension keeps coverage line numbers in sync with simple edits via a lightweight line-offset mapping from document change events; insert/delete shifts are applied first. When edits overlap coverage lines or exceed size/count thresholds, tracked state is invalidated and highlighting is cleared until coverage is reloaded. Behavior, setting, and toggle command are documented in [COVERAGE_FEATURES.md](COVERAGE_FEATURES.md#edit-tolerant-tracking). Implementation: `src/edit-tracking.ts` (pure mapping) and extension state in `src/extension.ts`.

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
