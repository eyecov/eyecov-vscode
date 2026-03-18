# Coverage Report CLI

`out/report.js` is a dev-only CLI for validating EyeCov against real coverage
artifacts outside the editor.

Use it to:

- smoke-test supported formats on real reports
- catch parser crashes and format drift early
- compare EyeCov-derived totals with report-declared totals where supported
- inspect sample file coverage quickly

## Run It

Build first:

```bash
npm run compile
```

Then run the CLI:

```bash
node out/report.js --path <artifact>
```

Examples:

```bash
node out/report.js --path coverage/lcov.info
node out/report.js --path coverage/cobertura-coverage.xml --verify-report-totals
node out/report.js --path coverage/clover.xml --json
node out/report.js --path coverage-html --verify-report-totals
node out/report.js --path coverage/coverage-final.json --format istanbul-json
node out/report.js --path target/site/jacoco/jacoco.xml --verify-report-totals
```

You can also use the package scripts:

```bash
npm run report -- --path coverage/lcov.info
npm run report:json -- --path coverage/lcov.info
npm run report:verify -- --path coverage/lcov.info
```

## Flags

- `--path <artifact>`
  - Required.
  - Path to one coverage artifact file or one PHPUnit HTML directory.
- `--format <auto|phpunit-html|cobertura|clover|lcov|istanbul-json|jacoco|go-coverprofile|coveragepy-json|opencover>`
  - Optional.
  - Default: `auto`.
  - `auto` detects the format from the path and file contents.
- `--workspace-root <path>`
  - Optional.
  - Default: current working directory.
  - Used when resolving report source paths to real files.
- `--json`
  - Emit JSON instead of human-readable output.
- `--verify-report-totals`
  - Compare EyeCov-derived totals with artifact-declared totals when supported.
- `--sample-files <n>`
  - Default: `10`.
  - Number of sample files to include in the output.
- `--theme <auto|dark|light>`
  - Human output only.
  - Default: `auto`.
- `--no-color`
  - Disable ANSI colors in human output.

## Supported Formats

- `phpunit-html`
- `cobertura`
- `clover`
- `lcov`
- `istanbul-json`
- `jacoco`
- `go-coverprofile`
- `coveragepy-json`
- `opencover`

## Verification Behavior

Verification is only attempted when `--verify-report-totals` is set.

If verification is not possible for a given run, the CLI reports it as
unsupported instead of failing.

### `phpunit-html`

- Verifies against the root `coverage-html/index.html` `Total` row when present.
- Checks:
  - covered lines
  - executable lines
  - aggregate coverage percent
- If the root summary page is missing or unparsable, verification is unsupported
  for that run.

### `cobertura`

- Verifies against the top-level coverage attributes:
  - `lines-covered`
  - `lines-valid`
  - `line-rate`
- If the report’s top-level executable-line total disagrees with the normalized
  unique per-line entries, the CLI treats that as an artifact inconsistency
  warning rather than a hard verification failure.

### `clover`

- Verification is limited to metrics we can justify from Clover semantics.
- Today that means aggregate coverage percent, not raw line totals.

### `lcov`

- Verification uses totals derived from parsed `DA:` records.

### `istanbul-json`

- Loads `coverage-final.json` style artifacts into normalized per-file line coverage.
- Verification is currently unsupported because the JSON artifact does not expose stable aggregate report totals in the same way as the summary-oriented formats.

### `jacoco`

- Verification uses the report-level `LINE` counter (`missed`, `covered`).

### `go-coverprofile`

- Verification uses totals derived from parsed coverprofile line ranges.

### `coveragepy-json`

- Verification uses top-level JSON totals when present.

### `opencover`

- Verification uses report summary sequence-point totals when present.

### Unresolved Paths

For shared-file report formats, verification is marked unsupported if some
report paths cannot be resolved locally. That avoids false mismatches caused by
local workspace state instead of parser correctness.

## Output

Human output is the default and includes:

- a summary
- verification results
- sample files
- warnings

Use `--json` for structured output. The current JSON shape includes:

- format
- artifact path
- workspace root
- parsed
- files discovered
- totals
- verification
- samples
- warnings

## Exit Codes

- `0`
  - parse succeeded
  - verification succeeded, was not requested, or was unsupported
- `1`
  - artifact missing
  - unsupported format
  - parse/load/runtime failure
- `2`
  - verification mismatch
- `3`
  - invalid CLI arguments
