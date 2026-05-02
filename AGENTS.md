# AGENTS.md

This repo is a VS Code extension, not a web app and not a library package.

EyeCov reads coverage artifacts, normalizes them into one runtime model, and uses that model in two places:

- editor coverage UI
- MCP tools for AI/editor integrations

Keep those two paths aligned. If coverage behavior changes in one path, check the other.

## Commands

Use Node 22+.

```bash
npm install
npm run compile
npm test
npm run test:mcp
npm run package
```

`npm run compile` is the normal pre-commit gate. It runs lint, Prettier check, TypeScript, and the esbuild bundle.

Useful narrower commands:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:no-coverage
npx vitest run src/coverage-resolver.test.ts
npm run test:extension
```

## Shape

- `src/extension.ts` owns VS Code activation, commands, watchers, decorations, status bar state, prewarm startup, and MCP registration.
- `src/coverage-resolver.ts` owns adapter selection. Format order matters.
- `src/coverage-formats/*` owns format-specific parsing and adapter behavior.
- `src/coverage-runtime.ts` owns path normalization and candidate matching.
- `src/coverage-aggregate.ts` owns project/path aggregation for MCP tools.
- `src/coverage-cache.ts` and `src/coverage-prewarm.ts` own persistent cache behavior.
- `src/mcp/server.ts` owns the standalone MCP server.
- `src/report/*` owns the dev/report CLI.

## Rules

- Keep adapter output normalized as `CoverageRecord`.
- Do not special-case one format in shared aggregation or MCP code unless the runtime model cannot express the behavior.
- Preserve stale-artifact handling. Coverage that looks current but is not current is worse than no coverage.
- Keep cache behavior honest. If a cache is partial, surface it as partial.
- Keep VSIX contents tight. Use `.vscodeignore` so local tooling, test fixtures, generated caches, and workspace junk stay out of the published extension.
- Do not commit generated `.eyecov/` or `.covflux/` cache files.
- Prefer focused tests near the behavior being changed.

## Release

The release package is `eyecov-vscode-<version>.vsix`.

Before publishing:

```bash
npm run compile
npm test
npm run test:mcp
npm run package
npx vsce ls
```

Inspect the VSIX contents. It should contain compiled output, package metadata, README, license, logo, and runtime media. It should not contain source, private agent files, coverage samples, local editor settings, generated caches, or workspace fixtures.

Marketplace publishing uses publisher `eyecov`. Publish the same VSIX to Open VSX too, then verify both listings.
