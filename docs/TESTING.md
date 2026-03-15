# Testing

## Vitest (unit tests)

- **Scope:** Pure Node code that does not import `vscode`: coverage-formats, coverage-runtime, coverage-resolver, coverage-aggregate, coverage-cache, coverage-prewarm, coverage-staleness, covflux-config, mcp/settings.
- **Run:** `npm test` (or `npx vitest`). **Coverage:** `npm run test:coverage` (V8 provider; report in terminal and `coverage/index.html`).
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
  - **covflux-config** — `loadCovfluxConfig`, defaults, format paths.
  - **mcp/settings** — `isMcpServerEnabled`, `isPrewarmCoverageCacheEnabled`.

**Why some code isn’t unit-tested here:**

- **CoverageHtmlReader** — Uses only `import type` from `coverage-types` and the shared runtime; it could be unit-tested with a temp dir and fake workspace roots. Not added yet; the behaviour it adds (HTML → `CoverageData`) is mostly covered by coverage-formats/phpunit-html + coverage-runtime tests.
- **extension.ts** — Depends on the `vscode` API and runs in the extension host. Not runnable in Vitest; it’s covered by extension host tests (extension loads, commands registered).
- **MCP server transport** — Provided by the SDK (stdio, request routing). The tool logic delegates to coverage-aggregate and coverage-cache, which are unit-tested. The full path is exercised by `scripts/verify-mcp-server.mjs` (stdio smoke test).

## Extension host tests (@vscode/test-electron + test-cli)

- **Scope:** Tests that run inside the Extension Development Host with full VS Code API (e.g. extension is present, commands registered).
- **Run:** `npm run test:extension` (compiles extension + tests, downloads VS Code into `.vscode-test/` on first run, then runs Mocha).
- **Config:** `.vscode-test.mjs` (files glob, Mocha options). Test files live in `src/test/suite/*.test.ts` and are compiled to `out/test/suite/*.test.js` via `npm run compile:tests` (tsconfig.test.json).
- **Debug:** Use the **Extension Tests** launch config in VS Code (uses `testConfiguration` pointing at `.vscode-test.mjs`).

Current suite: `src/test/suite/extension.test.ts` — asserts the Covflux extension is loaded and `covflux.showCoverage` is registered. Add more tests there or new `*.test.ts` files under `src/test/suite/`.
