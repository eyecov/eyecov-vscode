# Changelog

## 0.2.32 - 2026-06-04

### Added

- Add SimpleCov JSON support for Ruby `.resultset.json` coverage artifacts.
- Add a repository map image for project orientation.

### Changed

- Keep the release package focused by excluding the repository map image from the VSIX.

## 0.2.29 - 2026-04-30

First public GitHub release.

### Added

- Add editor coverage highlighting and gutter markers.
- Add coverage adapters for PHPUnit HTML, Cobertura, Clover, LCOV, Istanbul JSON, JaCoCo, Go coverprofile, coverage.py JSON, and OpenCover.
- Add built-in MCP tools for file coverage, line test lookup, path/project aggregates, diff coverage, and test priority.
- Add coverage cache prewarm support with visible progress and partial-cache reporting.
- Add a packaged VSIX release for manual install while Marketplace publishing waits on publisher auth.

### Changed

- Tighten VSIX packaging so development files and local junk stay out of the extension artifact.

## Security

For security fixes, see [SECURITY.md](SECURITY.md).
