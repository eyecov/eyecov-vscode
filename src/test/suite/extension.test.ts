import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

async function typeAndCaptureNextChange(text: string) {
  return await new Promise<vscode.TextDocumentChangeEvent>((resolve) => {
    const disposable = vscode.workspace.onDidChangeTextDocument((event) => {
      disposable.dispose();
      resolve(event);
    });

    void vscode.commands.executeCommand("type", { text });
  });
}

async function executeCommandAndCaptureNextChange(command: string) {
  return await new Promise<vscode.TextDocumentChangeEvent>((resolve) => {
    const disposable = vscode.workspace.onDidChangeTextDocument((event) => {
      disposable.dispose();
      resolve(event);
    });

    void vscode.commands.executeCommand(command);
  });
}

function findCoveredIndentedLine(
  tracked: Record<
    string,
    {
      coveredLines: number[];
      uncoveredLines: number[];
      uncoverableLines: number[];
    }
  >,
  uriString: string,
  doc: vscode.TextDocument,
): number {
  const coveredLines = tracked[uriString]?.coveredLines ?? [];
  const indentedCoveredLine = coveredLines.find((line) =>
    /^\s+/.test(doc.lineAt(line - 1).text),
  );

  assert.ok(
    indentedCoveredLine,
    "there should be at least one covered indented line",
  );

  return indentedCoveredLine;
}

async function resetDemoEditorState(editor: vscode.TextEditor) {
  await vscode.window.showTextDocument(editor.document);
  await vscode.commands.executeCommand("workbench.action.files.revert");
  await new Promise((r) => setTimeout(r, 300));
  await vscode.commands.executeCommand("eyecov.rereadCoverage");
  await new Promise((r) => setTimeout(r, 500));
}

suite("EyeCov Extension Test Suite", () => {
  test("Extension should be present", () => {
    const ext = vscode.extensions.getExtension("eyecov.eyecov-vscode");
    assert.ok(ext, "EyeCov extension should be loaded");
  });

  test("EyeCov commands should be registered", async () => {
    const commands = await vscode.commands.getCommands();
    const showCoverage = commands.includes("eyecov.showCoverage");
    const rereadCoverage = commands.includes("eyecov.rereadCoverage");
    assert.strictEqual(
      showCoverage,
      true,
      "eyecov.showCoverage command should be registered",
    );
    assert.strictEqual(
      rereadCoverage,
      true,
      "eyecov.rereadCoverage command should be registered",
    );
  });

  test("eyecov.toggleGutterCoverage runs and showGutterCoverage is readable", async () => {
    await vscode.commands.executeCommand("eyecov.toggleGutterCoverage");
    const config = vscode.workspace.getConfiguration("eyecov");
    const value = config.get<boolean>("showGutterCoverage", true);
    assert.strictEqual(
      typeof value,
      "boolean",
      "showGutterCoverage should be a boolean",
    );
  });

  test("opening covered file with gutter enabled applies coverage without error", async () => {
    const config = vscode.workspace.getConfiguration("eyecov");
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
    await vscode.commands.executeCommand("eyecov.showCoverage");
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
    await vscode.commands.executeCommand("eyecov.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const trackedUris = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedState",
    )) as unknown;

    assert.ok(
      Array.isArray(trackedUris),
      "eyecov._debugGetTrackedState should return an array",
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
    await resetDemoEditorState(editor);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("eyecov.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const uriString = doc.uri.toString();
    const before = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedStateDetails",
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

    try {
      await editor.edit((editBuilder) => {
        editBuilder.insert(
          new vscode.Position(beforeCovered[0] - 1, 0),
          "// edit\n",
        );
      });

      await new Promise((r) => setTimeout(r, 500));

      const after = (await vscode.commands.executeCommand(
        "eyecov._debugGetTrackedStateDetails",
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
    } finally {
      await vscode.commands.executeCommand("undo");
      await new Promise((r) => setTimeout(r, 300));
    }
  });

  test("overlapping edit drops the edited covered line from tracked coverage state", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");

    const doc = await vscode.workspace.openTextDocument(demoPath);
    const editor = await vscode.window.showTextDocument(doc);
    await resetDemoEditorState(editor);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("eyecov.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const uriString = doc.uri.toString();
    const before = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedStateDetails",
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
    try {
      await editor.edit((editBuilder) => {
        editBuilder.replace(lineToReplace.range, "// edited by test");
      });

      await new Promise((r) => setTimeout(r, 500));

      const after = (await vscode.commands.executeCommand(
        "eyecov._debugGetTrackedStateDetails",
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
        "tracked state details should still exist after an overlapping edit",
      );
      assert.ok(
        !after[uriString].coveredLines.includes(firstCoveredLine1Based),
        "the edited covered line should be removed from tracked coverage after overlap",
      );
    } finally {
      await vscode.commands.executeCommand("undo");
      await new Promise((r) => setTimeout(r, 300));
    }
  });

  test("pressing Enter at column 0 of a covered line preserves that line and shifts it down", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");

    const doc = await vscode.workspace.openTextDocument(demoPath);
    const editor = await vscode.window.showTextDocument(doc);
    await resetDemoEditorState(editor);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("eyecov.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const uriString = doc.uri.toString();
    const before = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedStateDetails",
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
      "tracked state details should exist for the opened document URI before pressing Enter at column 0",
    );

    const firstCoveredLine1Based = findCoveredIndentedLine(
      before,
      uriString,
      doc,
    );

    try {
      editor.selection = new vscode.Selection(
        firstCoveredLine1Based - 1,
        0,
        firstCoveredLine1Based - 1,
        0,
      );
      await typeAndCaptureNextChange("\n");

      await new Promise((r) => setTimeout(r, 500));

      const after = (await vscode.commands.executeCommand(
        "eyecov._debugGetTrackedStateDetails",
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
        "tracked state details should still exist after pressing Enter at column 0",
      );
      assert.ok(
        after[uriString].coveredLines.includes(firstCoveredLine1Based + 1),
        "the covered line should be preserved and shift down by one after inserting a blank line above it",
      );
    } finally {
      await vscode.commands.executeCommand("undo");
      await new Promise((r) => setTimeout(r, 300));
    }
  });

  test("pressing Enter at EOL of a covered line preserves that line", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");

    const doc = await vscode.workspace.openTextDocument(demoPath);
    const editor = await vscode.window.showTextDocument(doc);
    await resetDemoEditorState(editor);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("eyecov.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const uriString = doc.uri.toString();
    const before = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedStateDetails",
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
      "tracked state details should exist before pressing Enter at EOL",
    );

    const firstCoveredLine1Based = findCoveredIndentedLine(
      before,
      uriString,
      doc,
    );
    const lineText = doc.lineAt(firstCoveredLine1Based - 1).text;

    try {
      editor.selection = new vscode.Selection(
        firstCoveredLine1Based - 1,
        lineText.length,
        firstCoveredLine1Based - 1,
        lineText.length,
      );
      await typeAndCaptureNextChange("\n");

      await new Promise((r) => setTimeout(r, 500));

      const after = (await vscode.commands.executeCommand(
        "eyecov._debugGetTrackedStateDetails",
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
        "tracked state details should still exist after pressing Enter at EOL",
      );
      assert.ok(
        after[uriString].coveredLines.includes(firstCoveredLine1Based),
        "the covered line should stay on the same line after pressing Enter at EOL",
      );
    } finally {
      await vscode.commands.executeCommand("undo");
      await new Promise((r) => setTimeout(r, 300));
    }
  });

  test("backspace after Enter at column 0 restores the shifted covered line", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");

    const doc = await vscode.workspace.openTextDocument(demoPath);
    const editor = await vscode.window.showTextDocument(doc);
    await resetDemoEditorState(editor);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("eyecov.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const uriString = doc.uri.toString();
    const before = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedStateDetails",
    )) as unknown as Record<
      string,
      {
        coveredLines: number[];
        uncoveredLines: number[];
        uncoverableLines: number[];
      }
    >;

    const coveredLine1Based = findCoveredIndentedLine(before, uriString, doc);

    try {
      editor.selection = new vscode.Selection(
        coveredLine1Based - 1,
        0,
        coveredLine1Based - 1,
        0,
      );
      await typeAndCaptureNextChange("\n");
      await new Promise((r) => setTimeout(r, 300));

      editor.selection = new vscode.Selection(
        coveredLine1Based,
        0,
        coveredLine1Based,
        0,
      );
      await executeCommandAndCaptureNextChange("deleteLeft");

      await new Promise((r) => setTimeout(r, 500));

      const after = (await vscode.commands.executeCommand(
        "eyecov._debugGetTrackedStateDetails",
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
        "tracked state details should still exist after backspace joins the shifted covered line",
      );
      assert.ok(
        after[uriString].coveredLines.includes(coveredLine1Based),
        "the covered line should return to its original line after backspace removes the blank line",
      );
    } finally {
      await vscode.commands.executeCommand("undo");
      await new Promise((r) => setTimeout(r, 300));
      await vscode.commands.executeCommand("undo");
      await new Promise((r) => setTimeout(r, 300));
    }
  });

  test("undo restores a covered line removed by a typed edit", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");

    const doc = await vscode.workspace.openTextDocument(demoPath);
    const editor = await vscode.window.showTextDocument(doc);
    await resetDemoEditorState(editor);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("eyecov.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const uriString = doc.uri.toString();
    const before = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedStateDetails",
    )) as unknown as Record<
      string,
      {
        coveredLines: number[];
        uncoveredLines: number[];
        uncoverableLines: number[];
      }
    >;

    const coveredLine1Based = findCoveredIndentedLine(before, uriString, doc);
    const coveredLineText = doc.lineAt(coveredLine1Based - 1).text;

    try {
      editor.selection = new vscode.Selection(
        coveredLine1Based - 1,
        coveredLineText.length,
        coveredLine1Based - 1,
        coveredLineText.length,
      );
      await typeAndCaptureNextChange("x");
      await new Promise((r) => setTimeout(r, 500));

      const afterEdit = (await vscode.commands.executeCommand(
        "eyecov._debugGetTrackedStateDetails",
      )) as unknown as Record<
        string,
        {
          coveredLines: number[];
          uncoveredLines: number[];
          uncoverableLines: number[];
        }
      >;

      assert.ok(
        afterEdit[uriString],
        "tracked state should still exist after typing on a covered line",
      );
      assert.ok(
        !afterEdit[uriString].coveredLines.includes(coveredLine1Based),
        "the edited covered line should be removed from tracked coverage after typing",
      );

      await executeCommandAndCaptureNextChange("undo");
      await new Promise((r) => setTimeout(r, 500));

      const afterUndo = (await vscode.commands.executeCommand(
        "eyecov._debugGetTrackedStateDetails",
      )) as unknown as Record<
        string,
        {
          coveredLines: number[];
          uncoveredLines: number[];
          uncoverableLines: number[];
        }
      >;

      assert.deepStrictEqual(
        afterUndo[uriString],
        before[uriString],
        "tracked coverage should be restored after undo returns the document to its previous content",
      );
    } finally {
      if (doc.isDirty) {
        await vscode.commands.executeCommand("undo");
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  });

  test("undo restores a covered line after typing two spaces quickly", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");

    const doc = await vscode.workspace.openTextDocument(demoPath);
    const editor = await vscode.window.showTextDocument(doc);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("eyecov.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const uriString = doc.uri.toString();
    const before = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedStateDetails",
    )) as unknown as Record<
      string,
      {
        coveredLines: number[];
        uncoveredLines: number[];
        uncoverableLines: number[];
      }
    >;

    const coveredLine1Based = findCoveredIndentedLine(before, uriString, doc);
    const coveredLineText = doc.lineAt(coveredLine1Based - 1).text;

    try {
      editor.selection = new vscode.Selection(
        coveredLine1Based - 1,
        coveredLineText.length,
        coveredLine1Based - 1,
        coveredLineText.length,
      );
      await typeAndCaptureNextChange(" ");
      await typeAndCaptureNextChange(" ");
      await new Promise((r) => setTimeout(r, 500));

      const afterEdit = (await vscode.commands.executeCommand(
        "eyecov._debugGetTrackedStateDetails",
      )) as unknown as Record<
        string,
        {
          coveredLines: number[];
          uncoveredLines: number[];
          uncoverableLines: number[];
        }
      >;

      assert.ok(
        afterEdit[uriString],
        "tracked state should still exist after typing two spaces on a covered line",
      );
      assert.ok(
        !afterEdit[uriString].coveredLines.includes(coveredLine1Based),
        "the edited covered line should be removed from tracked coverage after typing two spaces",
      );

      await executeCommandAndCaptureNextChange("undo");
      await new Promise((r) => setTimeout(r, 500));

      const afterUndo = (await vscode.commands.executeCommand(
        "eyecov._debugGetTrackedStateDetails",
      )) as unknown as Record<
        string,
        {
          coveredLines: number[];
          uncoveredLines: number[];
          uncoverableLines: number[];
        }
      >;

      assert.deepStrictEqual(
        afterUndo[uriString],
        before[uriString],
        "tracked coverage should be restored after undo removes both typed spaces",
      );
    } finally {
      if (doc.isDirty) {
        await vscode.commands.executeCommand("undo");
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  });

  test("undo after overlapping edit restores tracked coverage state", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");

    const doc = await vscode.workspace.openTextDocument(demoPath);
    const editor = await vscode.window.showTextDocument(doc);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("eyecov.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const uriString = doc.uri.toString();
    const before = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedStateDetails",
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
      "tracked state details should exist before overlapping edit",
    );

    const firstCoveredLine1Based = before[uriString].coveredLines[0];
    const lineToReplace = doc.lineAt(firstCoveredLine1Based - 1);
    await editor.edit((editBuilder) => {
      editBuilder.replace(lineToReplace.range, "// edited by test");
    });
    await new Promise((r) => setTimeout(r, 500));

    const afterEdit = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedStateDetails",
    )) as unknown as Record<
      string,
      {
        coveredLines: number[];
        uncoveredLines: number[];
        uncoverableLines: number[];
      }
    >;
    assert.ok(
      afterEdit[uriString],
      "tracked state should still exist after overlapping edit before undo",
    );
    assert.ok(
      !afterEdit[uriString].coveredLines.includes(firstCoveredLine1Based),
      "the edited covered line should be removed before undo",
    );

    await vscode.commands.executeCommand("undo");
    await new Promise((r) => setTimeout(r, 500));

    const afterUndo = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedStateDetails",
    )) as unknown as Record<
      string,
      {
        coveredLines: number[];
        uncoveredLines: number[];
        uncoverableLines: number[];
      }
    >;
    assert.deepStrictEqual(
      afterUndo[uriString],
      before[uriString],
      "tracked state should be restored after undo returns the file to its previous content",
    );
  });

  test("typing a covered line away from and back to its original content restores its highlight", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");

    const doc = await vscode.workspace.openTextDocument(demoPath);
    const editor = await vscode.window.showTextDocument(doc);
    await resetDemoEditorState(editor);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("eyecov.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const uriString = doc.uri.toString();
    const before = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedStateDetails",
    )) as unknown as Record<
      string,
      {
        coveredLines: number[];
        uncoveredLines: number[];
        uncoverableLines: number[];
      }
    >;

    const ternaryLine1Based = 2;
    const ternaryLineText = doc.lineAt(ternaryLine1Based - 1).text;
    const originalToken = "1";
    const editedToken = "true";
    const originalStart = ternaryLineText.indexOf("? 1");

    assert.ok(
      before[uriString]?.coveredLines.includes(ternaryLine1Based),
      "the ternary line should start covered",
    );
    assert.ok(
      originalStart >= 0,
      "the ternary line should contain the covered token to edit",
    );

    try {
      const originalTokenStart = originalStart + 2;
      editor.selection = new vscode.Selection(
        ternaryLine1Based - 1,
        originalTokenStart,
        ternaryLine1Based - 1,
        originalTokenStart + originalToken.length,
      );
      await typeAndCaptureNextChange(editedToken);
      await new Promise((r) => setTimeout(r, 250));

      const afterEdit = (await vscode.commands.executeCommand(
        "eyecov._debugGetTrackedStateDetails",
      )) as unknown as Record<
        string,
        {
          coveredLines: number[];
          uncoveredLines: number[];
          uncoverableLines: number[];
        }
      >;

      assert.ok(
        !afterEdit[uriString].coveredLines.includes(ternaryLine1Based),
        "the edited ternary line should lose its highlight after changing 1 to true",
      );

      const editedLineText = doc.lineAt(ternaryLine1Based - 1).text;
      const editedTokenStart = editedLineText.indexOf(`? ${editedToken}`);
      assert.ok(
        editedTokenStart >= 0,
        "the ternary line should contain the edited token before restoring it",
      );

      editor.selection = new vscode.Selection(
        ternaryLine1Based - 1,
        editedTokenStart + 2,
        ternaryLine1Based - 1,
        editedTokenStart + 2 + editedToken.length,
      );
      await typeAndCaptureNextChange(originalToken);
      await new Promise((r) => setTimeout(r, 250));

      const afterRestore = (await vscode.commands.executeCommand(
        "eyecov._debugGetTrackedStateDetails",
      )) as unknown as Record<
        string,
        {
          coveredLines: number[];
          uncoveredLines: number[];
          uncoverableLines: number[];
        }
      >;

      assert.ok(
        afterRestore[uriString].coveredLines.includes(ternaryLine1Based),
        "the ternary line should regain its highlight after returning to its original text",
      );
    } finally {
      if (doc.isDirty) {
        await vscode.commands.executeCommand("workbench.action.files.revert");
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  });

  test("clearing tracked state for a document URI removes it (used on document close)", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");

    const doc = await vscode.workspace.openTextDocument(demoPath);
    await vscode.window.showTextDocument(doc);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("eyecov.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const uriString = doc.uri.toString();
    const trackedBefore = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedState",
    )) as unknown as string[];

    assert.ok(
      (trackedBefore as string[]).includes(uriString),
      "tracked state should exist for the opened document before clear",
    );

    await vscode.commands.executeCommand(
      "eyecov._debugClearTrackedStateForUri",
      uriString,
    );

    const trackedAfter = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedState",
    )) as unknown as string[];

    assert.ok(
      !(trackedAfter as string[]).includes(uriString),
      "tracked state should be removed after clear (same path used on document close)",
    );
  });

  test("when trackCoverageThroughEdits is false, no tracked state is created on load", async () => {
    const config = vscode.workspace.getConfiguration("eyecov");
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
      await vscode.commands.executeCommand("eyecov.showCoverage");
      await new Promise((r) => setTimeout(r, 500));

      const trackedUris = (await vscode.commands.executeCommand(
        "eyecov._debugGetTrackedState",
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
    await vscode.commands.executeCommand("eyecov.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const trackedBeforeReload = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedState",
    )) as unknown as string[];

    assert.ok(
      trackedBeforeReload.length >= 1,
      "tracked state should exist before reload",
    );

    await vscode.commands.executeCommand("eyecov._debugReloadCoverage");

    const trackedAfterReload = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedState",
    )) as unknown as string[];

    assert.strictEqual(
      trackedAfterReload.length,
      0,
      "tracked state should be empty after coverage reload",
    );
  });

  test("eyecov.rereadCoverage re-reads coverage for visible editors on demand", async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(workspaceRoot, "test-workspace should be open");
    const demoPath = path.join(workspaceRoot, "src", "demo.ts");

    const doc = await vscode.workspace.openTextDocument(demoPath);
    await vscode.window.showTextDocument(doc);

    await new Promise((r) => setTimeout(r, 300));
    await vscode.commands.executeCommand("eyecov.showCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const trackedBeforeReload = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedState",
    )) as unknown as string[];
    assert.ok(
      trackedBeforeReload.includes(doc.uri.toString()),
      "tracked state should exist before coverage is reloaded",
    );

    await vscode.commands.executeCommand("eyecov._debugReloadCoverage");

    const trackedAfterReload = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedState",
    )) as unknown as string[];
    assert.ok(
      !trackedAfterReload.includes(doc.uri.toString()),
      "tracked state should be cleared by reload before re-read",
    );

    await vscode.commands.executeCommand("eyecov.rereadCoverage");
    await new Promise((r) => setTimeout(r, 500));

    const trackedAfterReread = (await vscode.commands.executeCommand(
      "eyecov._debugGetTrackedState",
    )) as unknown as string[];
    assert.ok(
      trackedAfterReread.includes(doc.uri.toString()),
      "tracked state should be recreated after manual re-read",
    );
  });
});
