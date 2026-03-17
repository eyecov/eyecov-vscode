# Coverage Roadmap

Forward-looking roadmap: done, in progress, planned, and maybe. For the canonical shared model see [COVERAGE_MODEL.md](COVERAGE_MODEL.md), for technical structure see [COVERAGE_ARCHITECTURE.md](COVERAGE_ARCHITECTURE.md), and for user-visible behavior see [COVERAGE_FEATURES.md](COVERAGE_FEATURES.md).

## Done

- PHPUnit HTML adapter
- LCOV adapter
- editor highlighting
- edit-tolerant coverage tracking (setting `covflux.trackCoverageThroughEdits`, toggle command)
- MCP server
- coverage_file
- coverage_path
- coverage_project
- coverage_line_tests (covering tests)
- coverage_test_priority (where to add tests first)

## In progress

- _(none)_

## Planned

- additional adapters
- coverage diff
- test recommendation improvements
- gutter redesign: plain colored vertical lines (green/red) instead of circle icons — see `media/gutter-design.png`

## Maybe

- semantic coverage analysis
- stale coverage detection (`staleCoverageFiles` field exists in MCP responses and cache schema but is always `0`; implement or remove as a breaking API change)
