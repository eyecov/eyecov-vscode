# Covflux Coverage Plan

## Current state

Supported coverage inputs are PHPUnit HTML and LCOV only. The extension discovers coverage per format (e.g. PHPUnit HTML at `coverage-html/`), resolves per file, and normalizes into one internal format. Path and project aggregates support worstFiles, zeroCoverageFiles, and configurable limits/cutoff; MCP tools pass these options through and return zeroCoverageFiles when requested. PHPUnit HTML provides per-line test size (small/medium/large), warning and uncoverable states; the internal format encodes them in a single compact structure and the editor applies matching decorations. Optional edit-tolerant tracking and plan-level settings (e.g. `covflux.phpunitHtmlPath`, `covflux.trackCoverageThroughEdits`) remain not implemented or differ from the plan; PHPUnit HTML verification on large codebases is postponed.

---

## Goal

Refocus the extension around a simple, fast runtime pipeline that activates coverage highlighting when a file is opened.

When the editor opens a file, the extension must:

1. Look for matching coverage in any supported coverage format.
2. Discard the coverage if it is out of date.
3. Read the coverage.
4. Transform it into an internal editor-optimized format.
5. Activate line highlighting.

This plan should guide implementation work in a way that keeps the code lean, simple, and fast.

## Product Direction

- **Auto-discover coverage** — The extension discovers what coverage is available (PHPUnit HTML, LCOV, etc.) and uses it for the open file. No "primary" or "secondary"; the resolver tries adapters in order and uses the first that has data for that file.
- Supported formats: PHPUnit v12 HTML (e.g. `coverage-html/`), LCOV (e.g. `coverage/lcov.info` from Vitest). Adapters are version-specific when tied to a tool (e.g. PHPUnit HTML output changes across versions).
- **Vitest / LCOV:** LCOV from `vitest run --coverage` is supported; see [COVERAGE_FORMAT_RECOMMENDATION.md](COVERAGE_FORMAT_RECOMMENDATION.md). If a newer Vitest adds a richer format, re-evaluate when the toolchain is compatible (Node 20/22+).
- **Adapter symmetry** — New formats go in a dedicated folder under `coverage-formats/` with parser, adapter, and tests (see [Adding more coverage formats](#adding-more-coverage-formats)).
- Internal runtime format must optimize editor use, especially fast line lookup.
- Optional advanced feature: preserve usable coverage mapping even after file edits.
- That advanced feature must be off by default and controlled by a setting.

Related docs:

- [COVERAGE_FEATURES.md](COVERAGE_FEATURES.md) — What the coverage system does (editor, formats, config, MCP).
- [COVERAGE_ARCHITECTURE.md](COVERAGE_ARCHITECTURE.md) — Technical structure (resolver, adapters, flow).
- [MCP_SERVER_FEATURES.md](MCP_SERVER_FEATURES.md) — MCP tools and behavior.

## Scope

### In scope

- Keep line highlighting fast and simple.
- Add an optional setting for edit-tolerant coverage tracking (off by default).

### Out of scope for this phase

- Broad multi-language coverage support.
- Full support for many PHPUnit HTML versions.
- Fancy UI beyond existing status/decorations.
- Heavy indexing infrastructure unless profiling proves it necessary.
- Edit-tolerant remapping enabled by default.

## Core Runtime Flow

Target flow when an editor opens a file:

1. Normalize the opened file path.
2. Ask the coverage resolver for matching coverage candidates.
3. For each supported adapter, attempt to locate coverage for the file.
4. Reject any candidate whose coverage artifact is stale relative to the source file.
5. Read the winning coverage artifact.
6. Convert it into the internal runtime format.
7. Cache the normalized internal coverage record.
8. Apply editor decorations from the internal format.

This flow should be asynchronous but avoid unnecessary work on repeated opens of the same file.

Architecture details live in:

- [COVERAGE_ARCHITECTURE.md](COVERAGE_ARCHITECTURE.md)

## Internal format and line highlighting

### Line highlight colors

Line decorations (gutter and/or background) should follow PHPUnit report semantics. The php-code-coverage default theme uses these CSS custom properties (light / dark). The extension may use these hex values for highlighting; see [PHPUNIT_12_HTML_FORMAT.md](PHPUNIT_12_HTML_FORMAT.md) and php-code-coverage `style.css` / `Colors::default()`.

| Semantic              | Light (hex) | Dark (hex) | Use |
| --------------------- | ----------- | ---------- | --- |
| Covered (small tests) | `#99cb84`   | `#3d5c4e`  | Best coverage: covered by small (fast) tests. |
| Covered (medium)      | `#c3e3b5`   | `#3c6051`  | Covered by medium or larger. |
| Covered (large)       | `#dff0d8`   | `#2d4431`  | Covered only by large tests. |
| Warning               | `#fcf8e3`   | `#3e3408`  | Ignored / dead code, etc. |
| Uncovered / danger    | `#f2dede`   | `#42221e`  | Executable, not covered. |

Users can override PHPUnit report colors via config; extension defaults should match the report defaults above. Respect editor light/dark theme when choosing which column to use.

### Covered-line test size (small / medium / large)

PHPUnit HTML distinguishes **covered-by-small-tests**, **covered-by-medium-tests**, and **covered-by-large-tests** (smallest test size that hit the line). The internal format must **append S/M/L to the covered line numbers when available** so the editor can optionally shade covered lines by test size (e.g. green gradient: small = strongest, large = weakest).

**Requirement:** When the adapter supplies test size (e.g. PHPUnit HTML), the internal format encodes both line number and test size (for color) in a compact way — **no separate map**. The exact shape is left open: the current `coveredLines` / `lineStatuses` layout may be kept, or replaced by a different format, as long as it has **small footprint** and **fast lookup** for line number and test size (S/M/L or equivalent). All coverage states (covered-by-large, covered-by-medium, covered-by-small, uncovered, uncoverable, warning) must be representable in that single structure. Adapters that cannot produce size (e.g. LCOV) use a single “covered” value and the UI treats all covered lines as one shade (medium) if so.

### Path/project aggregates (coverage_path)

For `coverage_path` (and `coverage_project`), **worstFiles** is most useful when it shows the lowest-coverage files among those that have *some* coverage. When many files have zero coverage, a single "worst files" list is mostly useless. Therefore:

- **worstFiles** — Files with coverage above the cutoff (see below), ordered by lowest coverage first. These are the "worst" among meaningfully covered files.
- **zeroCoverageFiles** (or equivalent) — Files with zero coverage *or* covered lines ≤ cutoff: treated as "effectively uncovered" so callers see both "worst covered" and "completely / nearly uncovered" in one response.

**Cutoff:** A configurable threshold (default 0): files with **≤ X covered lines** go into **zeroCoverageFiles**; only files with **> X covered lines** go into **worstFiles**. So with default 0, only truly zero-coverage files are in zeroCoverageFiles; with e.g. 2, files with 0, 1, or 2 covered lines are in zeroCoverageFiles and worstFiles shows only files with at least 3 covered lines. This keeps very-low-coverage files (e.g. one stray hit) out of worstFiles.

The size of both arrays (e.g. default 10 each) must be **configurable** (e.g. via MCP tool parameters and/or extension/covflux config), not hard-coded. The cutoff (covered-line threshold) should also be configurable.

## Settings (not yet implemented)

- `covflux.coverageSource` — values: `auto`, `phpunit-v12-html`, `fixture-json`
- `covflux.phpunitHtmlPath` — root path to PHPUnit HTML (currently via config file instead)
- `covflux.trackCoverageThroughEdits` — boolean, default: `false`

Optional later: staleness strategy override; see feature plans for feature-specific settings.

## Configuration file

Implemented in `src/covflux-config.ts`: `.covflux.json` / `covflux.json` with `formats` array (type + path); phpunit-html entries can include `sourceSegment` (`app` | `src` | `lib` | `auto`). Defaults when absent. Extension and MCP use `loadCovfluxConfig` and `createAdaptersFromConfig`.

## Delivery Phases

1. Add optional edit tracking.
2. Use the extracted feature plans for covering tests and MCP after the core runtime is stable.

## Testing

The core runtime redesign needs:

- unit tests for parsing, freshness, and normalization
- resolver tests for adapter selection and stale coverage rejection
- integration tests for file-open highlighting behavior

Detailed test strategy belongs in implementation and feature plans.

## Performance Rules

- No full-workspace scans on every file open.
- No heavy parsing before a candidate is known and freshness is confirmed.
- No per-line object graphs in the hot render path.
- Prefer direct path resolution, simple caches, and fail-fast behavior.
- Prefer fast execution, but not at the expense of bloated memory use.

## Adding more coverage formats

PHPUnit HTML, LCOV, and fixture live in `src/coverage-formats/{phpunit-html,lcov,fixture}/`. To add a new format (Cobertura, Clover, JaCoCo): add a folder under `coverage-formats/` with parser, adapter, and tests; register in `createAdaptersFromConfig` and config types in `covflux-config.ts` (unless test-only like fixture).

## Shortlist for Future Coverage Formats

Do not implement in this phase, but keep the adapter model friendly to them:

- Cobertura XML
- (LCOV is already supported.)
- Clover XML
- JaCoCo XML

Pursue additional formats when needed; use the same folder pattern as existing adapters.

## Acceptance Criteria

The redesign is successful when:

- Opening a file triggers coverage lookup through a single runtime path.
- Fresh coverage is highlighted.
- Stale coverage is ignored.
- Coverage data is normalized into one internal format before highlighting.
- Supported formats include PHPUnit v12 HTML and LCOV; coverage is auto-discovered. Optionally, a config file specifies which formats, in which order, and paths to each.
- Edit-tracking support is optional and off by default.
- The implementation remains small, readable, and fast.
- Line highlighting uses colors that match PHPUnit report semantics (see [Internal format and line highlighting](#internal-format-and-line-highlighting)); the internal format represents covered-line test size (small/medium/large) in a compact way where the adapter supplies it.

## Suggested Next Tasks

1. Add optional edit tracking only after the core path is stable.

**Postponed:** Verify PHPUnit HTML coverage implementation against a large codebase with coverage (path resolution, parsing, highlighting, MCP tools). Mostly relevant for the covering-tests feature; do when focusing on that. Includes: version detection, compatibility of v12 and earlier, and handling lines with very large numbers of covering tests.

## Guardrails

- Prefer deletion over compatibility shims if existing code fights the new design.
- Keep adapters isolated and version-specific.
- Keep the internal format minimal.
- Do not over-engineer edit tracking.
- Measure before optimizing beyond simple sets and caches.
- Favor deterministic fixtures over hard-to-maintain end-to-end test inputs.
