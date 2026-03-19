# Coverage Roadmap

Forward-looking roadmap: done, in progress, planned, and maybe. For the canonical shared model see [COVERAGE_MODEL.md](COVERAGE_MODEL.md), for technical structure see [COVERAGE_ARCHITECTURE.md](COVERAGE_ARCHITECTURE.md), and for user-visible behavior see [COVERAGE_FEATURES.md](COVERAGE_FEATURES.md).

## Done

- PHPUnit HTML adapter
- Cobertura XML adapter
- Clover XML adapter
- LCOV adapter
- Istanbul/NYC JSON adapter
- JaCoCo XML adapter
- Go coverprofile adapter
- Python coverage.py JSON adapter
- .NET OpenCover XML adapter
- editor highlighting
- status bar coverage summary
- gutter markers
- edit-tolerant coverage tracking (setting `eyecov.trackCoverageThroughEdits`, toggle command)
- MCP server
- coverage_file
- coverage_path
- coverage_project
- coverage_line_tests (covering tests)
- coverage_test_priority (where to add tests first)
- coverage cache prewarm and on-disk cache
- coverage report CLI for parser verification and report checks

## In progress

- _(none)_

## Planned

### Next up

- coverage diff
  - Focus on changed files and changed lines first.
  - Goal: answer "what in this change is uncovered or regressed?" without making users mentally diff whole-project coverage.
  - Spec: [COVERAGE_DIFF_SPEC.md](COVERAGE_DIFF_SPEC.md)
- coverage diagnostics
  - Explain why coverage is missing or hidden for the current file: stale artifact, path mismatch, artifact missing, unsupported structure, or ambiguous match.
  - Goal: make EyeCov fail loudly and usefully instead of silently and mysteriously.
- MCP uncovered-region extraction
  - Add a tool for uncovered blocks with a little surrounding context, not just raw line numbers.
  - Goal: give AI tools cleaner input for targeted test generation and review flows.

### High leverage

- coverage-aware test generation workflow
  - Editor action built on top of existing MCP/runtime data: find uncovered regions, hand them to an AI tool, then re-check coverage after tests are generated.
  - Goal: turn EyeCov from passive viewer into active test-writing scaffolding.
- explorer and folder coverage summaries
  - Surface bad coverage before a file is opened.
  - Goal: make coverage navigable at repo scale, not just file scale.
- test recommendation improvements
  - Evolve `coverage_test_priority` beyond low coverage plus uncovered-line counts.
  - Goal: rank useful next test targets with better heuristics and clearer reasoning.
- PHPUnit coverage XML support on top of the shared machine-readable XML foundation
- gutter redesign: plain colored vertical lines (green/red) instead of circle icons — see `media/gutter-design.png`

### Longer bets

- branch and condition coverage support
  - Line coverage is useful, but branch coverage is where the awkward truths live.
  - Goal: expose missed branches and partial branch execution where source formats support it.
- coverage snapshots and compare mode
  - Compare current artifact to a saved snapshot or baseline.
  - Goal: show coverage drops and newly uncovered files without building a dashboard empire.
- multi-source coverage composition
  - Go beyond first-match-wins where mixed artifacts make sense.
  - Goal: allow richer combinations such as HTML for line tests and XML/LCOV for totals.
- review-focused summaries
  - A report or MCP tool that summarizes risky changed files, zero-coverage files, stale coverage, and obvious test targets.
  - Goal: make EyeCov directly useful in PR review, not only while editing.

## Maybe

- Python coverage.py XML as an explicit adapter: lower priority because coverage.py XML may already be usable through the Cobertura XML adapter. Users can try `coverage xml -o coverage/cobertura-coverage.xml` and configure `{ "type": "cobertura", "path": "coverage/cobertura-coverage.xml" }`.
- stale coverage detection (`staleCoverageFiles` field exists in MCP responses and cache schema but is always `0`; implement or remove as a breaking API change)
- semantic coverage analysis
- PHPUnit PHP coverage report support via optional thin PHP converter
  - Plausible because projects using it already have `php`, but lower priority and riskier than XML formats because the PHP report appears intended for PHP-side processing rather than as a stable external interchange format.
