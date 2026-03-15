# Covflux

**Coverage in your editor. Coverage for your AI tools.**

Covflux reads coverage artifacts (PHPUnit HTML, LCOV, etc.) and turns them into a runtime coverage model used by:

- the editor
- developer tooling
- AI assistants via MCP

Works in **VS Code**, [**Cursor**](https://cursor.com), and [**Antigravity**](https://antigravity.google/).

---

## Coverage in the editor

### Line highlighting (default)

Coverage appears directly in the editor.

- covered lines (when the format supplies it, shaded by test size: small / medium / large)
- uncovered lines
- uncoverable and warning lines

*(Add a screenshot at `images/coverage-lines.png` for best discoverability.)*

### Gutter markers

Enable gutter icons for fast scanning:

- **Cmd+Shift+P** → **Covflux: Toggle Gutter Coverage**, or set `covflux.showGutterCoverage` to `true`

*(Add a screenshot at `images/coverage-gutter.png` to show gutter + line highlight.)*

### Status bar

The current file coverage is shown in the editor status bar (e.g. `49.0% (25/51)`). Click to toggle coverage display.

*(Add a screenshot at `images/coverage-statusbar.png` to show the status bar.)*

---

## Supported coverage formats

Currently supported (resolved in order):

- **PHPUnit HTML** — default path `coverage-html/`
- **LCOV** — default path `coverage/lcov.info`

Example generators:

```bash
phpunit --coverage-html coverage-html
```

```bash
vitest run --coverage
```

Use an optional [config file](#configuration-file-optional) to set formats and paths.

---

## AI coverage via MCP

Covflux exposes coverage through a built-in **MCP server**. Available tools:

- **coverage_file** — file-level coverage, uncovered lines
- **coverage_line_tests** — which tests cover given line(s) (PHPUnit HTML)
- **coverage_path** — aggregate coverage for a path (optional worstFilesLimit, zeroCoverageFilesLimit, coveredLinesCutoff; can return zeroCoverageFiles)
- **coverage_project** — project-level coverage (optional same limits; can return zeroCoverageFiles)
- **coverage_test_priority** — where to add tests first

This lets AI tools answer: *Which files need tests most? Which tests cover this line? What has the lowest coverage?*

When the extension is installed, **Covflux Built-in MCP Server** appears in your editor’s MCP list—enable it there.

To configure the server manually (e.g. in `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "covflux": {
      "command": "node",
      "args": ["/path/to/extension/out/mcp/server.js"],
      "env": { "COVFLUX_WORKSPACE_ROOTS": "/path/to/your/workspace" }
    }
  }
}
```

The extension supplies workspace roots when it runs the server; `COVFLUX_WORKSPACE_ROOTS` is only needed for standalone runs.

---

## Configuration file (optional)

Put `.covflux.json` or `covflux.json` in your workspace root:

```json
{
  "formats": [
    { "type": "phpunit-html", "path": "coverage-html" },
    { "type": "lcov", "path": "coverage/lcov.info" }
  ]
}
```

Formats are tried in order; the first with coverage for the file is used. Paths are relative to the workspace root.

---

## Extension settings

- `covflux.debug` — When `true`, write debug logs to **View → Output → Covflux** (including which adapters were detected and which resolved each file). Default: `false`
- `covflux.showCoverageOnOpen` — Show coverage when files are opened. Default: `true`
- `covflux.showUncovered` — Highlight uncovered lines. Default: `true`
- `covflux.showCovered` — Highlight covered lines. Default: `true`
- `covflux.showLineCoverage` — Background color on lines. Default: `true`
- `covflux.showGutterCoverage` — Gutter icons. Default: `true`

---

## Commands

- **Covflux: Show Coverage** — Enable coverage display
- **Covflux: Hide Coverage** — Disable coverage display
- **Covflux: Toggle Coverage** — Toggle coverage on/off
- **Covflux: Show Coverage Info** — Coverage details for the current file
- **Covflux: Toggle Gutter Coverage** — Toggle gutter icons (Cmd+Shift+P)
- **Covflux: Toggle Line Coverage** — Toggle line highlighting (Cmd+Shift+P)

---

## Requirements

- **VS Code 1.105.0+** or a compatible editor (Cursor, Antigravity)
- Coverage from at least one supported format in the workspace (PHPUnit HTML folder or LCOV file)

---

## Debugging

1. Set `covflux.debug` to `true`.
2. Open **View → Output → Covflux**.
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

Press **F5** to launch the Extension Development Host.

---

## License

MIT
