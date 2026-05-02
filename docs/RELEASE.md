# Release

Use Node 22+.

Run the gate before publishing:

```bash
npm run compile
npm test
npm run test:mcp
npm run package
npx vsce ls
```

`vsce ls` should stay boring. It should contain compiled output, package metadata, README, license, logo, and runtime media.

It should not contain source, private agent files, coverage samples, local editor settings, generated caches, workspace fixtures, `.eyecov/`, or `.covflux/`.

Publish to VS Code Marketplace:

```bash
npx vsce publish
```

Publish the same VSIX to Open VSX so Cursor and VSCodium users can install it:

```bash
npx ovsx publish eyecov-vscode-<version>.vsix
```

Verify both listings before calling the release done.

## Marketplace PAT

`vsce publish` asks for a Personal Access Token for publisher `eyecov`.

Create it in Azure DevOps, not the Azure Portal:

```text
https://dev.azure.com/_usersSettings/tokens
```

If that 401s, create or open an Azure DevOps organization first, then use:

```text
https://dev.azure.com/{org}/_usersSettings/tokens
```

Use these settings:

- Organization: `All accessible organizations`, if available
- Scope: `Marketplace > Manage`
- If the Marketplace scope is missing or publish still fails: use `Full access`, publish once, then revoke the token

If `vsce` says token verification succeeded but publishing fails with `401`, the package is probably fine. The token is under-scoped for the publish call.

Revoke any PAT that was pasted into chat or logs. Treat it as burned.
