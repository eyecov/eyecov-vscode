# Contributing

## Prerequisites

- Node.js 22+ (see [.nvmrc](.nvmrc); use `nvm use` or set Node 22 as default)
- npm

## Setup

1. **Fork** the repo on GitHub, then clone your fork (or clone the repo directly if you have push access).
2. Install and build:

```bash
cd covflux-vscode
npm install
npm run compile
```

Press **F5** in VS Code to launch the Extension Development Host.

## Code style and checks

Before committing, run:

- `npm run lint` — ESLint (TypeScript + recommended rules)
- `npm run format:check` — Prettier (no changes, just check)
- `npm run lint:fix` and `npm run format` — fix lint and formatting

`npm run compile` runs lint, format check, typecheck, and build; it must pass before you push.

**Editor**

Recommended:
- Install [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) and [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode).
- Turn on **Format on Save** and set the default formatter to Prettier.
- Optional: **ESLint: Fix on Save** for consistent style.

## Tests

- **Unit tests:** `npm test` (Vitest)
- **Coverage:** `npm run test:coverage` (report in terminal and `coverage/index.html`)
- **Extension host tests:** `npm run test:extension` (runs in Extension Development Host)

See [docs/TESTING.md](docs/TESTING.md) for scope and details.

## Submitting changes

1. Create a branch from `main` (on your fork or the repo), make your changes.
2. Run `npm run compile` and `npm test` locally (same as CI).
3. Push your branch and open a **pull request** against `main`. CI will run typecheck, lint, format check, and tests.

## Project structure

See the [docs/](docs/) folder for architecture and format docs (e.g. [COVERAGE_ARCHITECTURE.md](docs/COVERAGE_ARCHITECTURE.md), [PHPUNIT_HTML_FORMAT.md](docs/PHPUNIT_HTML_FORMAT.md)).
