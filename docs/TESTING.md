# Testing

## Vitest (unit tests)

- **Scope:** Pure Node code that does not import `vscode`: coverage-formats, coverage-runtime, coverage-resolver, coverage-aggregate, coverage-cache, coverage-prewarm, coverage-staleness, coverage-config, mcp/settings, and the report CLI modules.
- **Run:** `npm test` (or `npx vitest run --coverage`). Coverage is always generated (V8 provider; report in terminal and `coverage/index.html`). For a quick run without coverage: `npm run test:no-coverage`.
- **What’s tested:**
  - **coverage-formats/phpunit-html** — Parser (`parseCoverageHtml`, minimal HTML fixture), `parseTestName` (Pest/PHPUnit-style strings); adapter path resolution and `getCoverage`.
  - **coverage-formats/lcov** — Parser and adapter; `getCoverage` with lcov.info fixture.
  - **coverage-formats/fixture** — Parser and adapter; test-only format for deterministic coverage inputs.
  - **coverage-runtime** — `toFileSystemPath`, `resolveFilePath`, `getCandidatePathsForQuery`, `stripTestsByLine` using temp-dir fixtures.
  - **coverage-resolver** — Adapter order, stale rejection, multi-root; uses fixture adapter in tests.
  - **coverage-aggregate** — `aggregateCoverage`, `listCoveredPaths`, `getPathAggregateResponse`, `getProjectAggregateResponse`, `projectAggregateFromCache`, `pathAggregateFromCache`.
  - **coverage-cache** — `writeCoverageCache`, `readCoverageCache`, `buildCoverageCachePayload`, `deleteCoverageCache`.
  - **coverage-prewarm** — `prewarmCoverageForRoot` (writes cache in batches, respects abort signal).
  - **coverage-staleness** — `isCoverageStale(sourcePath, artifactPath)`.
  - **coverage-config** — `loadCoverageConfig`, defaults, format paths.
  - **mcp/settings** — `isMcpServerEnabled`, `isPrewarmCoverageCacheEnabled`.
  - **report CLI** — format detection, artifact loading, aggregation, verification, root-summary parsing, renderer output, and the CLI entrypoint.

**Why some code isn’t unit-tested here:**

- **CoverageHtmlReader** — Uses only `import type` from `coverage-types` and the shared runtime; it could be unit-tested with a temp dir and fake workspace roots. Not added yet; the behaviour it adds (HTML → `CoverageData`) is mostly covered by coverage-formats/phpunit-html + coverage-runtime tests.
- **extension.ts** — Depends on the `vscode` API and runs in the extension host. Not runnable in Vitest; it’s covered by extension host tests (extension loads, commands registered).
- **MCP server transport** — Provided by the SDK (stdio, request routing). The tool logic delegates to coverage-aggregate and coverage-cache, which are unit-tested. The full path is exercised by `scripts/verify-mcp-server.mjs` (stdio smoke test).

## Extension host tests (@vscode/test-electron + test-cli)

- **Scope:** Tests that run inside the Extension Development Host with full VS Code API (e.g. extension is present, commands registered).
- **Run:** `npm run test:extension` (compiles extension + tests, downloads VS Code into `.vscode-test/` on first run, then runs Mocha).
- **Config:** `.vscode-test.mjs` (files glob, Mocha options). Test files live in `src/test/suite/*.test.ts` and are compiled to `out/test/suite/*.test.js` via `npm run compile:tests` (tsconfig.test.json).
- **Debug:** Use the **Extension Tests** launch config in VS Code (uses `testConfiguration` pointing at `.vscode-test.mjs`).

Current suite: `src/test/suite/extension.test.ts` — asserts the EyeCov extension is loaded and `eyecov.showCoverage` is registered. Add more tests there or new `*.test.ts` files under `src/test/suite/`.

## Manual testing (gutter icons and UI)

To verify the extension UI (gutter icons, line highlighting, status bar) without a real coverage run:

1. **Run Extension** (F5 or **Run > Start Debugging**; use the **Run Extension** launch config).
2. In the Extension Development Host window: **File > Open Folder…** and open the **`test-workspace`** folder (in this repo).
3. Open `src/demo.ts`. Coverage is loaded from `test-workspace/coverage/lcov.info`.
4. **Gutter icons:** If needed, **Cmd+Shift+P** → **EyeCov: Toggle Gutter Coverage**. You should see green dots on covered lines (1, 3, 5) and red on uncovered (2, 4).
5. Use **EyeCov: Toggle Line Coverage** and the status bar to confirm line highlighting and file coverage.

See `test-workspace/README.md` for more detail.

## Manual CLI smoke tests

Run after `npm run compile`:

```bash
node out/report.js --path test-workspace/coverage/lcov.info --workspace-root test-workspace
node out/report.js --path test-workspace/coverage/lcov.info --workspace-root test-workspace --json
```

See [docs/COVERAGE_REPORT_CLI.md](COVERAGE_REPORT_CLI.md) for the full CLI
usage and verification rules.

For local real-report validation, also run the CLI against one Cobertura XML,
one Clover XML, one PHPUnit HTML directory with a root `index.html`, and one
small LCOV artifact. Use `--verify-report-totals` to confirm report-vs-EyeCov
comparisons, and `--no-color` to smoke-test plain output.

## CI

On every push and pull request, CI runs `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm test`.
