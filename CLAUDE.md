# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Full build (lint + format check + typecheck + esbuild)
npm run compile

# Watch mode
npm run watch

# Typecheck only
npm run typecheck

# Lint
npm run lint
npm run lint:fix

# Format
npm run format:check
npm run format

# Unit tests (Vitest, with coverage)
npm test

# Unit tests without coverage (faster)
npm run test:no-coverage

# Run a single test file
npx vitest run src/coverage-resolver.test.ts

# Extension host tests (downloads VS Code on first run)
npm run test:extension

# MCP server smoke test
npm run test:mcp

# Package as .vsix
npm run package
```

`npm run compile` is the gate check — it must pass before committing (runs lint, format:check, typecheck, and esbuild). CI runs the same checks plus `npm test`.

Node.js 22+ required (see `.nvmrc`; use `nvm use`).

## Architecture

EyeCov is a VS Code extension that reads coverage artifacts, normalizes them into a shared runtime model, and exposes that model to both the editor and AI tools via MCP.

### Coverage pipeline

```
coverage artifact (PHPUnit HTML, LCOV)
    ↓
adapter (format-specific: PhpUnitHtmlAdapter, LcovAdapter)
    ↓
CoverageRecord (normalized per-file model)
    ↓
editor decorations + MCP server tools
```

### Key source files

- **`src/extension.ts`** — Extension entry point. `CoverageExtension` class handles activation, command registration, file watchers, editor decorations, edit tracking, prewarm, and MCP registration. Depends on `vscode` API; not unit-testable with Vitest.
- **`src/coverage-resolver.ts`** — `CoverageResolver` and `CoverageAdapter` interface. Tries adapters in config order; first non-null `CoverageRecord` wins. `createAdaptersFromConfig(config)` builds adapter list.
- **`src/coverage-formats/phpunit-html/`** — `PhpUnitHtmlAdapter`; parses per-file HTML reports. Supports optional `sourceSegment` (`app` | `src` | `lib` | `auto`). Sets `testsByLine` and `lineStatuses` (S/M/L granularity) on the record.
- **`src/coverage-formats/lcov/`** — `LcovAdapter`; reads a single `lcov.info` and finds the matching `SF:` record.
- **`src/coverage-formats/fixture/`** — Deterministic test-only adapter; used in unit tests instead of real coverage artifacts.
- **`src/coverage-config.ts`** — Reads `.eyecov.json` / `eyecov.json` from workspace root. Provides `DEFAULT_CONFIG`, format-path helpers.
- **`src/coverage-runtime.ts`** — Path utilities: `toFileSystemPath`, `resolveFilePath`, `getCandidatePathsForQuery`.
- **`src/coverage-staleness.ts`** — `isCoverageStale(sourcePath, artifactPath)`. Each adapter calls this before returning a record; stale → returns `null`.
- **`src/coverage-aggregate.ts`** — On-demand path/project aggregation for MCP tools: `getPathAggregateResponse`, `getProjectAggregateResponse`, `listCoveredPaths`.
- **`src/coverage-cache.ts`** — Persistent cache at `{workspaceRoot}/.eyecov/coverage-cache.json`. Written by prewarm; read by MCP for fast path/project queries.
- **`src/coverage-prewarm.ts`** — Background crawl: `prewarmCoverageForRoot`. Batched with `setImmediate`; fire-and-forget from extension on startup.
- **`src/edit-tracking.ts`** — Pure line-offset mapping for `trackCoverageThroughEdits`. `applyChanges` shifts line numbers on insert/delete; invalidates state when edits exceed thresholds.
- **`src/coverage-data-mapper.ts`** — Maps `CoverageRecord` → `CoverageData` for decoration plan; `getStatusBarContent` for status bar.
- **`src/mcp/server.ts`** — Standalone MCP server (stdio). Registers tools: `coverage_file`, `coverage_line_tests`, `coverage_path`, `coverage_project`, `coverage_test_priority`. Uses `@modelcontextprotocol/sdk` and `zod` for input schemas.
- **`src/mcp/settings.ts`** — `isMcpServerEnabled`, `isPrewarmCoverageCacheEnabled`.

### CoverageRecord shape

```ts
interface CoverageRecord {
  sourcePath: string;
  coveredLines: Set<number>;
  uncoveredLines: Set<number>;
  uncoverableLines: Set<number>;
  lineCoveragePercent: number | null;
  coverageHtmlPath?: string; // PHPUnit HTML only
  testsByLine?: Map<number, string[]>; // PHPUnit HTML only
  lineStatuses?: Map<number, number>; // S/M/L, uncovered, warning, uncoverable
}
```

### Test strategy

- **Vitest** (`src/**/*.test.ts`, excluding `src/test/**`): Unit tests for all pure Node code (no `vscode` import). Fixture adapter is used for deterministic coverage inputs.
- **Extension host tests** (`src/test/suite/*.test.ts`): Run via `npm run test:extension` inside the Extension Development Host with full VS Code API. Currently just checks extension loads and commands are registered.
- **Manual UI testing**: Open `test-workspace/` in the Extension Development Host (F5) and open `src/demo.ts`; coverage loads from `test-workspace/coverage/lcov.info`.

### Build

esbuild via `scripts/build.mjs`. Output goes to `out/`. The MCP server is bundled separately as `out/mcp/server.js`. Extension main is `out/extension.js`.

### Docs

Detailed docs are in `docs/`:

- `COVERAGE_MODEL.md` — canonical data flow
- `COVERAGE_ARCHITECTURE.md` — component details, freshness model, caching strategy
- `COVERAGE_FEATURES.md` — user-visible features and edit-tolerant tracking
- `MCP_SERVER.md` — MCP tool contracts and response shapes
- `TESTING.md` — test scope and how to run
