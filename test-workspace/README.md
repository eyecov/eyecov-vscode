# Test workspace for manual extension testing

Minimal workspace with pre-generated coverage so you can try the Eyecov extension (gutter icons, line highlighting, status bar) without running PHPUnit or another coverage tool.

- **`src/demo.ts`** + **`coverage/lcov.info`** — Tiny LCOV example kept for simple fallback testing.
- **`src/checkout-summary.ts`** + **`coverage-html/checkout-summary.ts.html`** — 39-line realistic checkout helper with mixed covered/uncovered lines and one yellow warning line.
- **`src/sync-health.ts`** + **`coverage-html/sync-health.ts.html`** — 30-line realistic status helper with a mostly-green coverage pattern.

## How to test gutter icons

1. **Run the extension**  
   In the main Cursor/VS Code window (the eyecov-vscode repo): **Run > Start Debugging** (F5) or use the **Run Extension** launch config.

2. **Open this folder in the Extension Development Host**  
   In the new window: **File > Open Folder…** and select this `test-workspace` directory (from inside the eyecov-vscode repo).

3. **Open one of the covered files**  
   Open `src/checkout-summary.ts` for a mixed green/red/yellow example, or `src/sync-health.ts` for a mostly-covered file. `src/demo.ts` remains as the minimal LCOV sample.

4. **Enable gutter icons**  
   If you don’t see colored markers in the gutter: **Cmd+Shift+P** (Mac) or **Ctrl+Shift+P** (Windows/Linux) → run **Eyecov: Toggle Gutter Coverage**.

5. **Optional**  
   Toggle line highlighting with **Eyecov: Toggle Line Coverage**. Check the status bar for file coverage. `checkout-summary.ts` should land around `73.68% (14/19)` and `sync-health.ts` around `83.33% (15/18)`.
