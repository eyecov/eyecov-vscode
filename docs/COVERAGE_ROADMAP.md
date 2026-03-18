# Coverage Roadmap

Forward-looking roadmap: done, in progress, planned, and maybe. For the canonical shared model see [COVERAGE_MODEL.md](COVERAGE_MODEL.md), for technical structure see [COVERAGE_ARCHITECTURE.md](COVERAGE_ARCHITECTURE.md), and for user-visible behavior see [COVERAGE_FEATURES.md](COVERAGE_FEATURES.md).

## Done

- PHPUnit HTML adapter
- Cobertura XML adapter
- Clover XML adapter
- LCOV adapter
- editor highlighting
- edit-tolerant coverage tracking (setting `eyecov.trackCoverageThroughEdits`, toggle command)
- MCP server
- coverage_file
- coverage_path
- coverage_project
- coverage_line_tests (covering tests)
- coverage_test_priority (where to add tests first)

## In progress

- _(none)_

## Planned

Rough priority order, highest first:

- Istanbul/NYC JSON adapter
- JaCoCo XML adapter
- Go coverprofile adapter
- Python coverage.py JSON adapter
- .NET OpenCover XML adapter
- PHPUnit coverage XML support on top of the shared machine-readable XML foundation
- PHPUnit PHP coverage report support via optional thin PHP converter — deferred; plausible because projects using it already have `php`, but lower priority and riskier than XML formats because the PHP report appears intended for PHP-side processing rather than as a stable external interchange format
- coverage diff
- test recommendation improvements
- gutter redesign: plain colored vertical lines (green/red) instead of circle icons — see `media/gutter-design.png`

## Maybe

- Python coverage.py XML as an explicit adapter: lower priority because coverage.py XML may already be usable through the Cobertura XML adapter. Users can try `coverage xml -o coverage/cobertura-coverage.xml` and configure `{ "type": "cobertura", "path": "coverage/cobertura-coverage.xml" }`.
- semantic coverage analysis
- stale coverage detection (`staleCoverageFiles` field exists in MCP responses and cache schema but is always `0`; implement or remove as a breaking API change)
