# Security

## Supported Versions

Security reports are handled for the latest published release.

## Reporting

Do not open a public issue for a vulnerability.

Use GitHub Security Advisories:

```text
https://github.com/eyecov/eyecov-vscode/security/advisories/new
```

Include:

- what is affected
- how to reproduce it
- what data or local files are exposed, modified, or executed
- the affected EyeCov version
- the editor and operating system used

## Scope

EyeCov reads local coverage artifacts and source files inside the workspace. Useful reports include unsafe file access, command execution, path traversal, leaking workspace data through MCP responses, or behavior that lets one workspace affect another.
