# Coverage Diff Spec

`coverage diff` turns EyeCov from a whole-project coverage viewer into a change-aware review tool.

The core question is simple:

> Did this change add or modify code that is still not exercised by tests?

This document defines the v1 shape, expected behavior, and follow-on phases.

## Default decisions for v1

- use git as the only diff source
- default to `merge-base` comparison
- default `head` to `HEAD`
- omit fully covered files unless explicitly requested
- reuse EyeCov config and resolver discovery instead of requiring an explicit artifact path
- support renamed files only when git provides clean target-side hunks

## Goal

Show coverage only for code touched by a diff, with enough detail to drive code review, local testing, and AI-assisted test generation.

## Why

Whole-project coverage is useful, but often too blunt for actual decisions. A reviewer or developer usually wants to know:

- which changed files have uncovered lines
- which changed lines are uncovered
- whether coverage data is stale or missing
- where tests should be added first

EyeCov already has the hard parts:

- normalized per-file coverage records
- freshness checks
- MCP integration
- a dev CLI for report inspection

`coverage diff` should reuse those pieces instead of inventing a second coverage pipeline.

## Non-goals for v1

- branch or condition coverage
- semantic code analysis
- merge multiple coverage artifacts for one file
- a rich VS Code panel or custom tree view
- PR provider integrations
- blaming regressions on a specific commit history

This is intentionally narrower: changed files, changed lines, current coverage state.

## Primary use cases

### Code review

Given a diff against a base ref, return the changed files and highlight which changed lines are uncovered, missing coverage, or stale.

### Local development

After editing a feature, show whether the new or modified lines are covered before the developer pushes or opens a PR.

### AI-assisted test generation

Give an AI tool a clean list of uncovered changed regions so it can generate tests for the right places instead of wandering around the file.

## V1 scope

V1 should ship in two surfaces:

- MCP tool: `coverage_diff`
- report CLI flag/mode: `node out/report.js --diff <base>`

The VS Code command can wait until the shape is proven.

## Inputs

### Diff source

V1 uses git as the only diff source.

Supported forms:

- base ref such as `main`, `origin/main`, or `HEAD~1`
- merge-base comparison against a base ref
- optional explicit `head` override for non-default comparisons

Default behavior should prefer merge-base semantics when a base ref is given, because that better matches review workflows.

## Output model

The response should be change-focused, not file-coverage-in-general.

### Per changed file

Each changed file should be classified into one of these states:

- `covered`
  - All changed executable lines are covered or uncoverable.
- `uncovered`
  - At least one changed executable line is uncovered.
- `missing`
  - The file is in the diff, but EyeCov cannot resolve any coverage for it from the configured formats.
- `stale`
  - Coverage exists in the artifact pipeline, but is rejected because the source file is newer than the coverage artifact.
- `unsupported`
  - The file type or diff shape cannot be evaluated in v1.

### Changed line classification

For files with resolved coverage, changed lines should be grouped into:

- `coveredLines`
- `uncoveredLines`
- `uncoverableLines`
- `nonExecutableChangedLines`

`nonExecutableChangedLines` is for changed lines that do not appear in covered, uncovered, or uncoverable sets. In v1 this is informational only and should not count against the file.

### Summary fields

The top-level response should include:

- `baseRef`
- `headRef` when explicitly provided or resolved
- `comparisonMode`
  - `merge-base` or `direct`
- `filesChanged`
- `filesResolved`
- `filesUncovered`
- `filesMissingCoverage`
- `filesStale`
- `changedExecutableLines`
- `changedCoveredLines`
- `changedUncoveredLines`
- `changedUncoverableLines`

## MCP tool design

### Tool name

`coverage_diff`

### Input

```json
{
  "base": "main",
  "head": "HEAD",
  "comparison": "merge-base",
  "includeCoveredFiles": false,
  "contextLines": 2,
  "limit": 200
}
```

### Input notes

- `base`
  - Required in v1.
- `head`
  - Optional. Default: `HEAD`.
- `comparison`
  - Optional: `merge-base` or `direct`.
  - Default: `merge-base`.
- `includeCoveredFiles`
  - Optional. When `false`, omit files whose changed executable lines are fully covered.
- `contextLines`
  - Optional. Number of surrounding lines to include around uncovered changed ranges for AI/review consumers.
- `limit`
  - Optional. Max changed files returned after classification.

### Response

```json
{
  "baseRef": "main",
  "headRef": "HEAD",
  "comparisonMode": "merge-base",
  "filesChanged": 7,
  "filesResolved": 5,
  "filesUncovered": 2,
  "filesMissingCoverage": 1,
  "filesStale": 1,
  "changedExecutableLines": 24,
  "changedCoveredLines": 17,
  "changedUncoveredLines": 5,
  "changedUncoverableLines": 2,
  "items": [
    {
      "filePath": "src/foo.ts",
      "status": "uncovered",
      "changedLineRanges": [[41, 48]],
      "coveredLines": [41, 42, 43],
      "uncoveredLines": [44, 45],
      "uncoverableLines": [46],
      "nonExecutableChangedLines": [47],
      "uncoveredRegions": [
        {
          "startLine": 44,
          "endLine": 45,
          "contextStartLine": 42,
          "contextEndLine": 47
        }
      ],
      "lineCoveragePercent": 71.4
    },
    {
      "filePath": "src/bar.ts",
      "status": "missing",
      "reason": "No configured coverage source resolved this file."
    },
    {
      "filePath": "src/baz.ts",
      "status": "stale",
      "reason": "Coverage artifact is older than the source file."
    }
  ]
}
```

### Response notes

- `items` should be sorted by severity first:
  - `uncovered`
  - `missing`
  - `stale`
  - `unsupported`
  - `covered`
- `uncoveredRegions` should collapse adjacent uncovered changed lines into ranges.
- `lineCoveragePercent` is file-level coverage, included as useful context, not the main point.

## CLI design

The report CLI should gain a diff mode instead of spawning a separate command.

### Proposed usage

```bash
node out/report.js --diff main
node out/report.js --diff origin/main --comparison merge-base
node out/report.js --diff main --head HEAD --json
```

### Proposed flags

- `--diff <base>`
  - Enables diff mode using the given base ref.
- `--head <ref>`
  - Optional. Default: `HEAD`.
- `--comparison <merge-base|direct>`
  - Optional. Default: `merge-base`.
- `--include-covered-files`
  - Optional. Include files with no uncovered changed executable lines.
- `--context-lines <n>`
  - Optional. Default: `2`.

CLI diff mode should keep using the normal EyeCov config and resolver path.
It should not require `--path`, because that would split diff coverage into a separate, inconsistent workflow.

### Human output

Human output should read like a review summary, not a parser dump.

Example:

```text
Coverage diff against merge-base(main..HEAD)

7 changed files
2 files with uncovered changed lines
1 file missing coverage
1 file stale

src/foo.ts
  changed executable lines: 41-46
  uncovered changed lines: 44, 45

src/bar.ts
  missing coverage

src/baz.ts
  stale coverage
```

### JSON output

JSON should reuse the MCP response shape as much as practical.

That keeps the model small and avoids two almost-identical result contracts slowly mutating in opposite directions.

## Git behavior

V1 should shell out to `git diff` rather than reimplement diff parsing from scratch.

Expected behavior:

1. Resolve the comparison target using either direct diff or merge-base.
2. Ask git for changed files and hunk line ranges.
3. Keep only file statuses relevant to coverage evaluation.
4. For each changed file, resolve EyeCov coverage and classify the changed lines.

### File status handling

V1 should support:

- added
- modified
- renamed, when git can provide usable new-path hunk data

V1 should skip or mark unsupported:

- deleted files
- pure mode changes
- binary files
- files without added/modified hunk ranges on the target side

### Path shape

Diff results should use repository-relative paths where possible.

That keeps MCP responses, CLI output, and future review tooling readable and stable across machines.

## Coverage evaluation rules

### Covered vs uncovered

Only changed lines on the target side of the diff count.

For each changed target-side line:

- if it is in `record.coveredLines`, count as covered
- if it is in `record.uncoveredLines`, count as uncovered
- if it is in `record.uncoverableLines`, count as uncoverable
- otherwise classify as non-executable

### Missing coverage

`missing` means EyeCov could not resolve a coverage record for the file at all using the configured format order.

This includes:

- file absent from all configured coverage sources
- path resolution mismatch between report and workspace
- no valid configured artifact for that file

### Stale coverage

`stale` means coverage should exist conceptually, but the source file is newer than the artifact and EyeCov refuses to trust it.

V1 implementation note:

The current resolver mostly returns `null` for stale coverage. To report `stale` distinctly in `coverage diff`, the resolver path will likely need a richer result than plain record-or-null.

That is worth doing. Silent nulls are fine for decorations; they are not good enough for diagnostics.

## Architecture notes

V1 should add a small shared diff layer rather than embedding git logic separately in MCP and CLI.

Suggested modules:

- `src/coverage-diff/git-diff.ts`
  - resolve refs and parse changed hunk ranges from git
- `src/coverage-diff/types.ts`
  - shared diff result types
- `src/coverage-diff/evaluator.ts`
  - map changed lines onto EyeCov coverage records
- `src/coverage-diff/formatters.ts`
  - shared human/JSON helpers where useful

The important bit is not the exact filenames. The important bit is avoiding a second mini-architecture hidden inside CLI code.

## Acceptance criteria for v1

- Given a base ref and current `HEAD`, return changed files and changed target-side line ranges.
- Correctly classify changed executable lines as covered, uncovered, or uncoverable.
- Distinguish `missing` from `stale`.
- Expose the result through one MCP tool and one CLI diff mode.
- Produce concise human output and stable JSON output.
- Work with the same config and format-resolution order as the rest of EyeCov.

## Out of scope but next

### V2

- distinguish newly uncovered lines from pre-existing uncovered lines when practical
- expose uncovered changed regions with richer source context
- add a VS Code command such as `EyeCov: Show Coverage Diff`
- add review-oriented summaries such as worst changed files first

### V3

- branch and condition coverage for diffs
- saved baselines or snapshot comparisons
- PR-focused summaries and agent-oriented workflows

## Risks

### Stale vs missing is not currently first-class enough

The current resolver path may need to return diagnostics instead of only `record | null`.

### Git diff parsing can get annoying fast

Keep v1 scoped to target-side line ranges and supported file statuses. Ignore heroic diff edge cases.

### Multi-root workspaces can be weird

The diff layer should classify files against the correct workspace root and avoid pretending that one repo-shaped answer fits everything.

## Open questions

- Should `coverage diff` eventually distinguish "newly uncovered in this diff" from "already uncovered nearby" once branch coverage and baselines exist?
- Should `coverage_diff` grow a path filter in v2 for large monorepos and partial review workflows?
