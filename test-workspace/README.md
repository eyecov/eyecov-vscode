# Test workspace for manual extension testing

Minimal workspace with pre-generated coverage so you can try the Covflux extension (gutter icons, line highlighting, status bar) without running PHPUnit or another coverage tool.

- **`coverage/lcov.info`** — LCOV report for `src/demo.ts` (lines 1, 3, 5 covered; 2, 4 uncovered).
- **`src/demo.ts`** — Sample file that matches the report.

## How to test gutter icons

1. **Run the extension**  
   In the main Cursor/VS Code window (the covflux-vscode repo): **Run > Start Debugging** (F5) or use the **Run Extension** launch config.

2. **Open this folder in the Extension Development Host**  
   In the new window: **File > Open Folder…** and select this `test-workspace` directory (from inside the covflux-vscode repo).

3. **Open the covered file**  
   Open `src/demo.ts`.

4. **Enable gutter icons**  
   If you don’t see colored dots in the gutter: **Cmd+Shift+P** (Mac) or **Ctrl+Shift+P** (Windows/Linux) → run **Covflux: Toggle Gutter Coverage**. You should see **green** on covered lines (1, 3, 5) and **red** on uncovered (2, 4).

5. **Optional**  
   Toggle line highlighting with **Covflux: Toggle Line Coverage**. Check the status bar for file coverage (e.g. `60.0% (3/5)`).
