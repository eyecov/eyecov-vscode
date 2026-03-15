import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

suite("Covflux Extension Test Suite", () => {
  test("Extension should be present", () => {
    const ext = vscode.extensions.getExtension("covflux.covflux-vscode");
    assert.ok(ext, "Covflux extension should be loaded");
  });

  test("Covflux commands should be registered", async () => {
    const showCoverage = await vscode.commands
      .getCommands()
      .then((cmds) => cmds.includes("covflux.showCoverage"));
    assert.strictEqual(
      showCoverage,
      true,
      "covflux.showCoverage command should be registered",
    );
  });

  test("covflux.toggleGutterCoverage runs and showGutterCoverage is readable", async () => {
    await vscode.commands.executeCommand("covflux.toggleGutterCoverage");
    const config = vscode.workspace.getConfiguration("covflux");
    const value = config.get<boolean>("showGutterCoverage", true);
    assert.strictEqual(
      typeof value,
      "boolean",
      "showGutterCoverage should be a boolean",
    );
  });

  test("opening covered file with gutter enabled applies coverage without error", async () => {
    const config = vscode.workspace.getConfiguration("covflux");
    await config.update(
      "showGutterCoverage",
      true,
      vscode.ConfigurationTarget.Workspace,
    );
    await new Promise((r) => setTimeout(r, 300));
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const lcovPath = path.join(workspaceRoot, "coverage", "lcov.info");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");
    const now = Date.now() / 1000;
    if (fs.existsSync(lcovPath)) {
      fs.utimesSync(lcovPath, now, now);
    }
    if (fs.existsSync(demoPath)) {
      fs.utimesSync(demoPath, now - 2, now - 2);
    }
    const doc = await vscode.workspace.openTextDocument(demoPath);
    await vscode.window.showTextDocument(doc);
    await new Promise((r) => setTimeout(r, 1500));
    await vscode.commands.executeCommand("covflux.showCoverage");
    await new Promise((r) => setTimeout(r, 10_000));
    assert.strictEqual(doc.fileName, demoPath, "demo.ts should be open");
  });
});
