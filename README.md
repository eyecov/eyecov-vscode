# EyeCov

<img width="464" height="144" alt="eyecov-logo-w-margin" src="https://github.com/user-attachments/assets/afc5683b-ed3b-4a15-a17b-cadf2853dc3a" />

**Coverage in your editor. Coverage for your AI tools.**

EyeCov is built around a shared runtime coverage model. External coverage
artifacts are parsed into normalized per-file records that power both the
editor and MCP tools.

EyeCov reads coverage artifacts (PHPUnit HTML, Cobertura, Clover, LCOV, etc.) and turns them into a runtime coverage model used by:

- the editor
- developer tooling
- AI assistants via MCP

Works in **VS Code**, [**Cursor**](https://cursor.com), and [**Antigravity**](https://antigravity.google/).

## Coverage report CLI

For parser smoke tests and report verification during development:

```bash
npm run compile
npm run report -- --path coverage/lcov.info
```

This CLI is dev-only in v1 and reuses the same parser stack as the extension.
See [docs/COVERAGE_REPORT_CLI.md](docs/COVERAGE_REPORT_CLI.md) for usage,
flags, exit codes, and verification behavior.

## Documentation map

- [Coverage Model](docs/COVERAGE_MODEL.md) — the canonical data flow and shared runtime model
- [Coverage Architecture](docs/COVERAGE_ARCHITECTURE.md) — resolver, adapters, runtime, cache, freshness
- [Coverage Features](docs/COVERAGE_FEATURES.md) — user-visible behavior and supported features
- [Coverage Report CLI](docs/COVERAGE_REPORT_CLI.md) — how to run and verify coverage artifacts
- [MCP Server](docs/MCP_SERVER.md) — tool behavior and response shapes
- [Coverage Roadmap](docs/COVERAGE_ROADMAP.md) — done, planned, and possible future work
- [Testing](docs/TESTING.md) — unit tests, extension-host tests, and CI
- [PHPUnit HTML Format](docs/PHPUNIT_HTML_FORMAT.md)
- [PHPUnit 12 HTML Format](docs/PHPUNIT_12_HTML_FORMAT.md)

---

## Coverage pipeline

EyeCov turns external coverage artifacts into a normalized runtime model:

```text
coverage artifact
    ↓ parse
adapter
    ↓ normalize
coverage record
    ↓ aggregate / cache
editor + MCP consumers
```

See [docs/COVERAGE_MODEL.md](docs/COVERAGE_MODEL.md) for the canonical model.

## Coverage in the editor

### Line highlighting (default)

Coverage appears directly in the editor.

- covered lines (when the format supplies it, shaded by test size: small / medium / large)
- uncovered lines
- uncoverable and warning lines

_(Add a screenshot at `images/coverage-lines.png` for best discoverability.)_

### Gutter markers

Enable gutter icons for fast scanning:

- **Cmd+Shift+P** → **EyeCov: Toggle Gutter Coverage**, or set `eyecov.showGutterCoverage` to `true`

_(Add a screenshot at `images/coverage-gutter.png` to show gutter + line highlight.)_

### Track coverage through edits (default on)

When you insert or delete lines, coverage highlighting stays aligned. Turn off with **EyeCov: Toggle Track Coverage Through Edits** or set `eyecov.trackCoverageThroughEdits` to `false`. See [docs/COVERAGE_FEATURES.md](docs/COVERAGE_FEATURES.md#edit-tolerant-tracking).

### Status bar

The current file coverage is shown in the editor status bar (e.g. `49.0% (25/51)`). Click to toggle coverage display.

_(Add a screenshot at `images/coverage-statusbar.png` to show the status bar.)_

---

## Supported coverage formats

Currently supported (resolved in order):

- **PHPUnit HTML** — default path `coverage-html/`
- **Cobertura XML** — default path `coverage/cobertura-coverage.xml`
- **Clover XML** — default path `coverage/clover.xml`
- **LCOV** — default path `coverage/lcov.info`

Example generators:

```bash
phpunit --coverage-html coverage-html
```

```bash
phpunit --coverage-cobertura coverage/cobertura-coverage.xml
```

```bash
phpunit --coverage-clover coverage/clover.xml
```

```bash
vitest run --coverage
```

Use an optional [config file](#configuration-file-optional) to set formats and paths.

---

## AI coverage via MCP

EyeCov exposes coverage through a built-in **MCP server**. Available tools:

- **coverage_file** — file-level coverage, uncovered lines
- **coverage_line_tests** — which tests cover given line(s) (PHPUnit HTML)
- **coverage_path** — aggregate coverage for a path (optional worstFilesLimit, zeroCoverageFilesLimit, coveredLinesCutoff; can return zeroCoverageFiles)
- **coverage_project** — project-level coverage (optional same limits; can return zeroCoverageFiles)
- **coverage_test_priority** — where to add tests first

This lets AI tools answer: _Which files need tests most? Which tests cover this line? What has the lowest coverage?_

When the extension is installed, **EyeCov Built-in MCP Server** appears in your editor’s MCP list. Enable it there.

To configure the server manually (e.g. in `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "eyecov": {
      "command": "node",
      "args": ["/path/to/extension/out/mcp/server.js"]
    }
  }
}
```

The extension supplies workspace roots when it runs the server. Optional: add `"env": { "EYECOV_WORKSPACE_ROOTS": "/path/to/workspace" }` for standalone runs only.

Terminal-style `eyecov` branding uses this ANSI text logo:

```text
"\033[48;2;0;0;0m\033[38;2;90;12;163m ▮\033[38;2;124;58;237m▮\033[38;2;159;103;255m▮\033[38;2;255;255;255meyecov \033[0m\n"
```

---

## Configuration file (optional)

Put `.eyecov.json` or `eyecov.json` in your workspace root:

```json
{
  "formats": [
    { "type": "phpunit-html", "path": "coverage-html" },
    { "type": "cobertura", "path": "coverage/cobertura-coverage.xml" },
    { "type": "clover", "path": "coverage/clover.xml" },
    { "type": "lcov", "path": "coverage/lcov.info" }
  ]
}
```

Formats are tried in order; the first with coverage for the file is used. Paths are relative to the workspace root.

---

## Extension settings

- `eyecov.debug` — When `true`, write debug logs to **View → Output → EyeCov** (including which adapters were detected and which resolved each file). Default: `false`
- `eyecov.showCoverageOnOpen` — Show coverage when files are opened. Default: `true`
- `eyecov.showUncovered` — Highlight uncovered lines. Default: `true`
- `eyecov.showCovered` — Highlight covered lines. Default: `true`
- `eyecov.showLineCoverage` — Background color on lines. Default: `true`
- `eyecov.showGutterCoverage` — Gutter icons. Default: `true`

---

## Commands

- **EyeCov: Show Coverage** — Enable coverage display
- **EyeCov: Hide Coverage** — Disable coverage display
- **EyeCov: Toggle Coverage** — Toggle coverage on/off
- **EyeCov: Re-read Coverage** — Rebuild coverage state and re-apply it to visible editors
- **EyeCov: Show Coverage Info** — Coverage details for the current file
- **EyeCov: Toggle Gutter Coverage** — Toggle gutter icons (Cmd+Shift+P)
- **EyeCov: Toggle Line Coverage** — Toggle line highlighting (Cmd+Shift+P)

---

## Requirements

- **VS Code 1.105.0+** or a compatible editor (Cursor, Antigravity)
- Coverage from at least one supported format in the workspace (PHPUnit HTML folder, Cobertura XML, Clover XML, or LCOV file)
- **Node.js 22+** for building and development (see [.nvmrc](.nvmrc))

---

## Debugging

1. Set `eyecov.debug` to `true`.
2. Open **View → Output → EyeCov**.
3. Open a file that has coverage; logs will show adapters detected at startup and, per file, which adapter was tried and which resolved (with artifact path when available).

---

## Installation

### From VSIX

```bash
npm install
npm run compile
npm run package
# Install the generated .vsix via Extensions → ... → Install from VSIX...
```

### Development

```bash
npm install
npm run compile
```

`npm run compile` runs ESLint, Prettier check, TypeScript, and the build. Press **F5** to launch the Extension Development Host.

Other commands: `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run format:check`, `npm test`, `npm run test:coverage`, `npm run test:extension`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

---

## License

MIT
