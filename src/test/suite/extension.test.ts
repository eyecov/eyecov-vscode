import * as assert from "node:assert";
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
});
