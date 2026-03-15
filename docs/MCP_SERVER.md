# MCP Server — Features

The Covflux extension runs an MCP server in supported VS Code/Cursor versions. The server uses the same coverage runtime and adapters as the editor; there is no separate coverage pipeline. When `covflux.prewarmCoverageCache` is true, the extension builds a coverage cache in the background (`.covflux/coverage-cache.json` per workspace root); the MCP server uses that cache for `coverage_path`, `coverage_project`, and `coverage_test_priority` when valid, avoiding re-aggregation.

## Workspace roots

- From the host (e.g. `listRoots`).
- Plus `COVFLUX_WORKSPACE_ROOTS` environment variable (path-delimited).

## Tools

### `coverage_file`

Resolves coverage for one file by path or basename.

**Input:** `query` — file path or basename (e.g. `GetEmployeeAction.php` or `app/Domain/Workspace/Actions/GetEmployeeAction.php`).

**Behavior:** Resolves like the extension: PHPUnit HTML (coverage-html) first, then LCOV. Same resolver and adapters as the editor. `coverageHtmlPath` is omitted when the source is LCOV.

**Response:**

```json
{
  "query": "GetEmployeeAction.php",
  "resolved": true,
  "workspaceRoots": ["/path/to/workspace"],
  "message": "Resolved one file match from coverage-html.",
  "matchCount": 1,
  "matches": [
    {
      "filePath": "app/Domain/Workspace/Actions/GetEmployeeAction.php",
      "coverageHtmlPath": "/path/to/coverage-html/...",
      "lineCoveragePercent": 85.2,
      "coveredLines": 52,
      "uncoveredLines": 9,
      "coveredLineNumbers": [1, 2, 5, 6, 7],
      "uncoveredLineNumbers": [44, 45, 48, 51, 62, 70, 71, 72, 89],
      "uncoverableLines": [3, 4]
    }
  ]
}
```

- `lineCoveragePercent` may be `null` when not available.
- `coverageHtmlPath` is omitted when the source is LCOV (no HTML path).
- `uncoverableLines` is included only when the source provides it (e.g. some adapters); omitted otherwise.

---

### `coverage_path`

Aggregates coverage for one or more path/folder prefixes.

**Input:** Either `path` (string) or `paths` (array of strings). At least one is required. Optional:

- **path** — Single path or folder prefix (e.g. `"app/Domain/Automation"`).
- **paths** — Multiple path/folder prefixes; coverage is aggregated over the **union** of files under any prefix (e.g. `["app/Domain/Automation", "app/Domain/Workspace"]`).
- **worstFilesLimit** — Max number of worst-coverage files to return (default 10).
- **zeroCoverageFilesLimit** — When set with **coveredLinesCutoff**, include up to this many files with covered lines ≤ cutoff in **zeroCoverageFiles**.
- **coveredLinesCutoff** — Used with zeroCoverageFilesLimit: files with covered lines ≤ this go into zeroCoverageFiles (default 0 = only truly zero-coverage).

**Behavior:** When a valid prewarm cache exists, filters the cache by path prefix(es) and returns aggregate stats and worst files (zeroCoverageFiles not from cache). Otherwise discovers all covered files under the given prefix(es) via configured formats (PHPUnit HTML, LCOV), resolves coverage for each, and returns aggregate stats, worst files, and (when options are set) zeroCoverageFiles.

**Response:**

```json
{
  "paths": ["app/Domain/Automation"],
  "aggregateCoveragePercent": 76.8,
  "totalFiles": 42,
  "coveredFiles": 39,
  "missingCoverageFiles": 2,
  "staleCoverageFiles": 0,
  "worstFiles": [
    {
      "filePath": "/workspace/app/Domain/Automation/Foo.php",
      "lineCoveragePercent": 33.3
    }
  ],
  "cacheState": "full",
  "zeroCoverageFiles": [
    {
      "filePath": "/workspace/app/Domain/New/Bar.php",
      "lineCoveragePercent": 0,
      "coveredLines": 0
    }
  ]
}
```

- **paths** — The prefix(es) requested (single path is returned as a one-element array).
- **worstFiles** — Files with coverage above the cutoff, lowest line coverage first (up to worstFilesLimit).
- **zeroCoverageFiles** — Present when zeroCoverageFilesLimit (and optionally coveredLinesCutoff) were passed; files with covered lines ≤ cutoff, up to the limit.
- **cacheState** — `"full"` when the response was served from the prewarm cache; `"on-demand"` when aggregated on demand (no cache or cache invalid).

---

### `coverage_project`

Aggregates workspace-wide coverage (no path filter).

**Input:** Optional.

- **worstFilesLimit** — Max number of worst-coverage files to return (default 0).
- **zeroCoverageFilesLimit** — When set with **coveredLinesCutoff**, include up to this many files with covered lines ≤ cutoff in **zeroCoverageFiles**.
- **coveredLinesCutoff** — Used with zeroCoverageFilesLimit: files with covered lines ≤ this go into zeroCoverageFiles.

**Behavior:** When a valid prewarm cache exists at `{workspaceRoot}/.covflux/coverage-cache.json`, returns the pre-aggregated project totals from the cache (no resolver calls; zeroCoverageFiles not from cache). Otherwise uses the first configured coverage format that has data: discovers paths, resolves coverage for each, and returns aggregate stats plus that format as detectedFormat and cache state; when options are set, response can include zeroCoverageFiles.

**Response:**

```json
{
  "aggregateCoveragePercent": 81.1,
  "totalFiles": 320,
  "coveredFiles": 280,
  "missingCoverageFiles": 22,
  "staleCoverageFiles": 0,
  "detectedFormat": "phpunit-html",
  "cacheState": "full",
  "zeroCoverageFiles": []
}
```

- **cacheState:** `"full"` when the response was served from the prewarm cache; `"on-demand"` when aggregated on demand (no cache or cache invalid).
- **detectedFormat:** The format that was used (from cache or first in config order that had coverage data).
- **zeroCoverageFiles:** Present when zeroCoverageFilesLimit (and optionally coveredLinesCutoff) were passed; files with covered lines ≤ cutoff, up to the limit.

---

### `coverage_test_priority`

Recommends **where to add tests first** using coverage data only: files with no coverage (highest priority), then low line coverage % and high uncovered line count. Heuristic and explainable; no code analysis.

**Input:** Optional.

- **includeNoCoverage** (boolean, default `true`) — When true, files with no coverage are included as top priority. Set to `false` for "where to add tests except where coverage is zero" (same data, no extra I/O).
- **limit** (number, default `20`) — Maximum number of items returned.

**Behavior:** When a valid prewarm cache exists, scores over `cache.files` and (if `includeNoCoverage`) `cache.missingPaths`. Otherwise discovers paths via the first configured format, resolves coverage for each, builds file list and missing list, then scores. Returns items sorted by priority (missing-coverage first, then by composite score), capped by `limit`.

**Response:**

```json
{
  "scope": "project",
  "cacheState": "full",
  "items": [
    {
      "filePath": "app/Domain/SomeNewFile.php",
      "priorityScore": 100,
      "lineCoveragePercent": null,
      "uncoveredLines": 0,
      "reasons": ["no coverage", "fresh coverage available"]
    },
    {
      "filePath": "app/Domain/Automation/Foo.php",
      "priorityScore": 92,
      "lineCoveragePercent": 33.3,
      "uncoveredLines": 48,
      "reasons": [
        "low coverage",
        "many uncovered lines",
        "fresh coverage available"
      ]
    }
  ]
}
```

- **scope:** `"project"` (workspace-wide in initial scope).
- **cacheState:** `"full"` when from cache; `"on-demand"` when aggregated on the fly.
- **items:** Sorted by priority (highest first). Files with no coverage have `priorityScore` 100, `lineCoveragePercent: null`, `uncoveredLines: 0`, and reason `"no coverage"`. Files with coverage have composite score (0–99), `lineCoveragePercent`, `uncoveredLines`, and explainable **reasons** (e.g. `"low coverage"` when &lt; 50%, `"many uncovered lines"` when ≥ 10 uncovered, `"fresh coverage available"` when from cache). When there is no coverage data, `items` is `[]`.

---

### `coverage_line_tests`

Returns covering tests for a file and line(s).

**Input:** `query` or `file_path` (required), and either `line` or `line_start` + `line_end` (range exclusive of end).

**Behavior:** Same resolution as `coverage_file`. PHPUnit HTML supplies per-line test data; LCOV does not (match includes `lineTestsNotSupported` and empty `tests`).

**Response:**

```json
{
  "query": "GetEmployeeAction.php",
  "line": 45,
  "resolved": true,
  "workspaceRoots": ["/path/to/workspace"],
  "message": "Resolved one file match for the requested line.",
  "matchCount": 1,
  "matches": [
    {
      "filePath": "app/Domain/Workspace/Actions/GetEmployeeAction.php",
      "coverageHtmlPath": "/path/to/coverage-html/...",
      "lineState": "covered",
      "tests": [
        {
          "raw": "P\\Tests\\Feature\\Domain\\GetEmployeeActionTest::__pest_evaluable_it_stores_employee",
          "className": "P\\Tests\\Feature\\Domain\\GetEmployeeActionTest",
          "decodedPath": "tests/Feature/Domain/GetEmployeeActionTest.php",
          "description": "it stores employee",
          "testFilePath": "/path/to/workspace/tests/Feature/Domain/GetEmployeeActionTest.php"
        }
      ]
    }
  ]
}
```

- **Line range:** When a range is requested, `line` is omitted; `line_start`, `line_end`, and `lines` are present.
- **lineState:** `"covered"` | `"uncovered"` | `"not-executable"`.
- **Unsupported format:** When the format does not provide per-line test data (e.g. LCOV), each match includes `lineTestsNotSupported` (e.g. `"Covering tests not supported for the LCOV coverage format."`) and `tests` is `[]`.
- **coverageHtmlPath:** Omitted when the source is LCOV.

## Verification

1. Run `npm run compile`.
2. Start the extension in Extension Development Host (VS Code 1.101+).
3. Open **MCP: List Servers** and confirm the covflux server appears.
4. Call `coverage_file`, `coverage_path`, `coverage_project`, `coverage_test_priority`, or `coverage_line_tests` from chat/agent and confirm responses match workspace coverage.
