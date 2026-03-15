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
    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("covflux.showCoverage");
    await new Promise((r) => setTimeout(r, 500));
    assert.strictEqual(doc.fileName, demoPath, "demo.ts should be open");
  });

  test("tracked coverage state is created for opened covered file", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");
    const doc = await vscode.workspace.openTextDocument(demoPath);
    await vscode.window.showTextDocument(doc);
    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("covflux.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const trackedUris = (await vscode.commands.executeCommand(
      "covflux._debugGetTrackedState",
    )) as unknown;

    assert.ok(
      Array.isArray(trackedUris),
      "covflux._debugGetTrackedState should return an array",
    );

    const uriString = doc.uri.toString();
    assert.ok(
      (trackedUris as string[]).includes(uriString),
      "tracked state should exist for the opened document URI",
    );
  });

  test("edit before covered line shifts tracked coverage lines", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");

    const doc = await vscode.workspace.openTextDocument(demoPath);
    const editor = await vscode.window.showTextDocument(doc);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("covflux.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const uriString = doc.uri.toString();
    const before = (await vscode.commands.executeCommand(
      "covflux._debugGetTrackedStateDetails",
    )) as unknown as Record<
      string,
      {
        coveredLines: number[];
        uncoveredLines: number[];
        uncoverableLines: number[];
      }
    >;

    assert.ok(
      before[uriString],
      "tracked state details should exist for the opened document URI",
    );

    const beforeCovered = before[uriString].coveredLines;
    assert.ok(
      beforeCovered.length > 0,
      "there should be at least one covered line",
    );

    await editor.edit((editBuilder) => {
      editBuilder.insert(
        new vscode.Position(beforeCovered[0] - 1, 0),
        "// edit\n",
      );
    });

    await new Promise((r) => setTimeout(r, 500));

    const after = (await vscode.commands.executeCommand(
      "covflux._debugGetTrackedStateDetails",
    )) as unknown as Record<
      string,
      {
        coveredLines: number[];
        uncoveredLines: number[];
        uncoverableLines: number[];
      }
    >;

    assert.ok(
      after[uriString],
      "tracked state details should still exist after a simple edit",
    );

    const afterCovered = after[uriString].coveredLines;
    assert.strictEqual(
      afterCovered.length,
      beforeCovered.length,
      "number of covered lines should remain the same after inserting a line before them",
    );
    assert.ok(
      afterCovered[0] > beforeCovered[0],
      "first covered line should shift down after inserting a line before it",
    );
  });

  test("overlapping edit invalidates tracked coverage state", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");

    const doc = await vscode.workspace.openTextDocument(demoPath);
    const editor = await vscode.window.showTextDocument(doc);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("covflux.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const uriString = doc.uri.toString();
    const before = (await vscode.commands.executeCommand(
      "covflux._debugGetTrackedStateDetails",
    )) as unknown as Record<
      string,
      {
        coveredLines: number[];
        uncoveredLines: number[];
        uncoverableLines: number[];
      }
    >;

    assert.ok(
      before[uriString],
      "tracked state details should exist for the opened document URI before overlapping edit",
    );

    const firstCoveredLine1Based = before[uriString].coveredLines[0];
    assert.ok(
      firstCoveredLine1Based,
      "there should be at least one covered line to edit",
    );
    const lineIndex0Based = firstCoveredLine1Based - 1;
    const lineToReplace = doc.lineAt(lineIndex0Based);
    await editor.edit((editBuilder) => {
      editBuilder.replace(lineToReplace.range, "// edited by test");
    });

    await new Promise((r) => setTimeout(r, 500));

    const after = (await vscode.commands.executeCommand(
      "covflux._debugGetTrackedStateDetails",
    )) as unknown as Record<string, unknown>;

    assert.ok(
      !after[uriString],
      "tracked state details should be cleared after an overlapping edit",
    );
  });

  test("clearing tracked state for a document URI removes it (used on document close)", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");

    const doc = await vscode.workspace.openTextDocument(demoPath);
    await vscode.window.showTextDocument(doc);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("covflux.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const uriString = doc.uri.toString();
    const trackedBefore = (await vscode.commands.executeCommand(
      "covflux._debugGetTrackedState",
    )) as unknown as string[];

    assert.ok(
      (trackedBefore as string[]).includes(uriString),
      "tracked state should exist for the opened document before clear",
    );

    await vscode.commands.executeCommand(
      "covflux._debugClearTrackedStateForUri",
      uriString,
    );

    const trackedAfter = (await vscode.commands.executeCommand(
      "covflux._debugGetTrackedState",
    )) as unknown as string[];

    assert.ok(
      !(trackedAfter as string[]).includes(uriString),
      "tracked state should be removed after clear (same path used on document close)",
    );
  });

  test("when trackCoverageThroughEdits is false, no tracked state is created on load", async () => {
    const config = vscode.workspace.getConfiguration("covflux");
    await config.update(
      "trackCoverageThroughEdits",
      false,
      vscode.ConfigurationTarget.Workspace,
    );
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      assert.ok(workspaceRoot, "test-workspace should be open");
      const demoPath = path.join(workspaceRoot, "src", "demo.ts");

      const doc = await vscode.workspace.openTextDocument(demoPath);
      await vscode.window.showTextDocument(doc);

      await new Promise((r) => setTimeout(r, 300));
      await vscode.commands.executeCommand("covflux.showCoverage");
      await new Promise((r) => setTimeout(r, 500));

      const trackedUris = (await vscode.commands.executeCommand(
        "covflux._debugGetTrackedState",
      )) as unknown as string[];

      const uriString = doc.uri.toString();
      assert.ok(
        !trackedUris.includes(uriString),
        "tracked state should not exist when trackCoverageThroughEdits is false",
      );
    } finally {
      await config.update(
        "trackCoverageThroughEdits",
        true,
        vscode.ConfigurationTarget.Workspace,
      );
    }
  });

  test("reloading coverage clears all tracked state", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");

    const doc = await vscode.workspace.openTextDocument(demoPath);
    await vscode.window.showTextDocument(doc);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("covflux.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const trackedBeforeReload = (await vscode.commands.executeCommand(
      "covflux._debugGetTrackedState",
    )) as unknown as string[];

    assert.ok(
      trackedBeforeReload.length >= 1,
      "tracked state should exist before reload",
    );

    await vscode.commands.executeCommand("covflux._debugReloadCoverage");

    const trackedAfterReload = (await vscode.commands.executeCommand(
      "covflux._debugGetTrackedState",
    )) as unknown as string[];

    assert.strictEqual(
      trackedAfterReload.length,
      0,
      "tracked state should be empty after coverage reload",
    );
  });
});
