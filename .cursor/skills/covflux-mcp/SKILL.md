---
name: covflux-mcp
description: Use the Covflux MCP server to answer file-level coverage, path/project aggregates, "where to add tests first", and covering-tests questions. Use when the user asks about coverage for a file, uncovered lines, which tests cover a line, coverage for a folder/project, or where to add tests.
---

# Covflux MCP — Coverage Queries

When the user asks about **code coverage for a file**, **path or project coverage**, **where to add tests first**, or **which tests cover a line**, use the Covflux MCP tools. The server uses the same coverage runtime as the editor (PHPUnit HTML and LCOV).

## Tools

- **`coverage_file`** — Resolve coverage for one file. Input: `query` (file path or basename, e.g. `GetEmployeeAction.php` or `app/Domain/Foo.php`).
- **`coverage_path`** — Aggregate coverage for one or more path/folder prefixes. Input: `path` (string) or `paths` (array). Returns aggregate %, counts, worst files, `cacheState`.
- **`coverage_project`** — Workspace-wide coverage. No input. Returns aggregate %, counts, detected format, `cacheState`.
- **`coverage_test_priority`** — Where to add tests first (heuristic: no coverage, low %, many uncovered lines). Input: optional `includeNoCoverage` (default true), `limit` (default 20). Returns `items` with filePath, priorityScore, reasons.
- **`coverage_line_tests`** — Covering tests for a file and line(s). Input: `query` or `file_path`, and either `line` or `line_start` + `line_end` (range end exclusive).

## Example intents → tool use

Use these to recognize what the user wants and pick the right tool and parameters.

**File coverage (use `coverage_file`):**

- What is the coverage of `Foo.php`? → `coverage_file` with `query: "Foo.php"`
- Find coverage for `app/Domain/Workspace/Actions/GetEmployeeAction.php` → `coverage_file` with that path
- Is there any coverage for `@Something.php`? → `coverage_file` with `query: "Something.php"` or the alias
- Which lines are uncovered in `Foo.php`? → `coverage_file`; response includes `uncoveredLineNumbers`
- Which lines are uncoverable in `Foo.php`? → `coverage_file`; response may include `uncoverableLines` when the source provides it (non-executable lines, e.g. comments or dead code)
- Which format provided coverage for `Foo.php`? → `coverage_file`; infer from `coverageHtmlPath` (present = PHPUnit HTML, omitted = LCOV)

**Covering tests (use `coverage_line_tests`):**

- Which tests cover line `45` in `Foo.php`? → `coverage_line_tests` with `query: "Foo.php"` (or path), `line: 45`
- What tests cover line 123 in this file? → resolve the current file path and use `coverage_line_tests` with that path and `line: 123`
- Covering tests for lines 10–20 in `Bar.php` → `coverage_line_tests` with `query: "Bar.php"`, `line_start: 10`, `line_end: 21` (end exclusive)

**Path/project coverage (use `coverage_path` or `coverage_project`):**

- What is the coverage for `app/Domain/Automation`? → `coverage_path` with `path: "app/Domain/Automation"`
- Aggregate coverage for `app/Domain` and `app/Http` → `coverage_path` with `paths: ["app/Domain", "app/Http"]`
- Overall project coverage? / How much of the project is covered? → `coverage_project` (no input)

**Where to add tests first (use `coverage_test_priority`):**

- Where should I add tests first? → `coverage_test_priority` (optional `limit` if they want more/fewer items)
- Which files need tests most? → `coverage_test_priority`
- Where to add tests except files with zero coverage? → `coverage_test_priority` with `includeNoCoverage: false`

**Response details:** `coverage_file` returns `coveredLineNumbers`, `uncoveredLineNumbers`, and when the source provides it, `uncoverableLines` (lines not considered executable). `coverageHtmlPath` is omitted for LCOV. `coverage_line_tests` may include `lineTestsNotSupported` (e.g. for LCOV) when the format does not provide per-line test data. `coverage_path` and `coverage_project` return `cacheState` (`"full"` when from prewarm cache, `"on-demand"` otherwise). `coverage_test_priority` returns `items` with `filePath`, `priorityScore`, `reasons` (e.g. "no coverage", "low coverage", "many uncovered lines").

**Query format:** `query` can be a full path, a workspace-relative path, a basename, or an alias. Prefer the path the user gave or the resolved path for the current file.

## Self-improvement and maintenance

- **When the capability changes:** If the MCP server tools or response shapes change (e.g. after editing `src/mcp/server.ts` or `docs/MCP_SERVER.md`), update this skill and the features doc so tool names, inputs, response shapes, and example intents stay accurate.
- **From usage:** If coverage queries are missed or the wrong tool/params are used, refine the description or example intents and re-test.
