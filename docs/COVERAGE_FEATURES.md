# Coverage Features

This document describes what the Eyecov coverage system does from a feature and user perspective. For the canonical coverage data flow, see [COVERAGE_MODEL.md](COVERAGE_MODEL.md). For technical structure (resolver, adapters, flow), see [COVERAGE_ARCHITECTURE.md](COVERAGE_ARCHITECTURE.md). For roadmap and future work, see [COVERAGE_ROADMAP.md](COVERAGE_ROADMAP.md).

## Editor coverage

- **Line highlighting** — When you open a file, the extension looks up coverage for that file and highlights lines: covered, uncovered, and (when the format provides it) uncoverable. When the format supplies per-line test size (e.g. PHPUnit HTML), covered lines are shaded by size (small / medium / large); warning and uncoverable lines use distinct decorations.
- **Gutter and line decorations** — You can toggle gutter coverage, line coverage, and whether covered/uncovered lines are shown via settings (`eyecov.showGutterCoverage`, `eyecov.showLineCoverage`, `eyecov.showCovered`, `eyecov.showUncovered`, etc.).
- **Staleness** — Coverage is only shown if the coverage artifact is not older than the source file. If you’ve edited the file after the last run, coverage is hidden until you regenerate it. If the source or coverage artifact path cannot be read, coverage is not shown (fail-safe).
- **Single lookup path** — The same resolution path is used for the editor and for MCP: try each configured format in order and use the first that has data for the file.

## Supported formats

- **PHPUnit HTML** — Per-file HTML reports (e.g. under `coverage-html/`). Used for PHP projects that run PHPUnit with HTML coverage. Can provide uncoverable lines and, when available, which tests cover each line.
- **LCOV** — A single `lcov.info` (or equivalent) per workspace. Used by Vitest and other tools. See [COVERAGE_FORMAT_RECOMMENDATION.md](COVERAGE_FORMAT_RECOMMENDATION.md) for Vitest setup.

Formats are **auto-discovered**: the resolver tries each configured format in order and uses the first that has coverage for the open file. There is no separate “primary” or “secondary” source.

## Configuration

Coverage sources and order are configured via a JSON file in the workspace root: `.eyecov.json` or `eyecov.json`. You specify which formats to use, in which order, and the path to each format’s artifact (folder for PHPUnit HTML, file for LCOV). If no config file is present, defaults are used (e.g. PHPUnit HTML at `coverage-html/`, LCOV at `coverage/lcov.info`). See [COVERAGE_ARCHITECTURE.md](COVERAGE_ARCHITECTURE.md) (Current implementation) for config; implementation lives in `src/coverage-config.ts`.

## MCP tools

The extension runs an MCP server that exposes coverage to other tools (e.g. Cursor). It uses the same runtime coverage model and adapters as the editor.

- **`coverage_file`** — Resolve coverage for one file by path or basename; returns line counts, percentages, and (when available) uncoverable lines and HTML path.
- **`coverage_line_tests`** — Return which tests cover a given file and line(s); used for “covering tests” workflows.
- **`coverage_path`** — Aggregate coverage for one or more path/folder prefixes (totals, worst files, optional zero-coverage files). Accepts optional `worstFilesLimit`, `zeroCoverageFilesLimit`, and `coveredLinesCutoff`.
- **`coverage_project`** — Project-wide aggregate; optional same limits and cutoff; can return `zeroCoverageFiles` when requested.
- **`coverage_test_priority`** — Prioritize tests by impact on coverage.

When a prewarm cache is valid, `coverage_path` and `coverage_project` (and related aggregates) use it for faster responses. Full tool behavior, inputs, and response shapes are in [MCP_SERVER.md](MCP_SERVER.md).

## Cache and prewarm

- **Optional prewarm** — If `eyecov.prewarmCoverageCache` is enabled, the extension builds a coverage cache in the background (`.eyecov/coverage-cache.json` per workspace root). That cache is used by MCP for path/project aggregates when valid, so those tools avoid re-scanning and re-parsing on every call.
- **Invalidation** — The cache is dropped when coverage artifacts or the config change, so results stay consistent with the current workspace state.

## Edit-tolerant tracking

When **`eyecov.trackCoverageThroughEdits`** is **`true`** (default), the extension keeps coverage line numbers in sync with simple edits: insert/delete lines shift the mapping in memory so highlighting stays aligned. When you edit a covered line directly (overlap) or make very large or numerous edits, tracked state is invalidated and decorations are cleared until coverage is reloaded. Reload happens automatically when coverage artifacts change or when you turn the feature off.

- **Setting** — `eyecov.trackCoverageThroughEdits` (default: `true`). When `false`, coverage is not tracked through edits; after you change the file, highlighting stays on the original line numbers until you refresh coverage or reopen the file.
- **Toggle** — Command **“Eyecov: Toggle Track Coverage Through Edits”** (Command Palette) flips the setting and refreshes editors.
- **Non-goals:** perfect semantic remapping, surviving arbitrary refactors, or complex diff algorithms. Implementation details: [COVERAGE_ARCHITECTURE.md](COVERAGE_ARCHITECTURE.md#edit-tracking).

## Planned and optional

- **Plan settings** — Settings such as `eyecov.coverageSource` and `eyecov.phpunitHtmlPath` from the plan are not yet implemented; format order and paths are currently controlled only by the config file.
- **PHPUnit HTML verification** — _(Postponed.)_ Validate the PHPUnit HTML implementation on a large codebase (path resolution, parsing, highlighting, MCP tools), including version detection and handling of lines with many covering tests. To be done when focusing on the covering-tests feature.
