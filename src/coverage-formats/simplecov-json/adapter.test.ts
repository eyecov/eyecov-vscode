import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SimpleCovJsonAdapter, listSimpleCovJsonSourcePaths } from "./adapter";

describe("SimpleCovJsonAdapter", () => {
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eyecov-simplecov-"));
    workspaceRoot = path.join(tmpDir, "workspace");
    fs.mkdirSync(path.join(workspaceRoot, "app"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "coverage"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeResultset(sourcePath: string): string {
    const artifactPath = path.join(
      workspaceRoot,
      "coverage",
      ".resultset.json",
    );
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        RSpec: {
          coverage: {
            [sourcePath]: { lines: [null, 1, 0] },
          },
        },
      }),
    );
    return artifactPath;
  }

  it("resolves relative file paths from the workspace root", async () => {
    const filePath = path.join(workspaceRoot, "app", "user.rb");
    fs.writeFileSync(filePath, "class User\nend\n");
    const artifactPath = writeResultset("app/user.rb");
    const now = Date.now() / 1000;
    fs.utimesSync(filePath, now - 1, now - 1);
    fs.utimesSync(artifactPath, now, now);

    const result = await new SimpleCovJsonAdapter().getCoverage(filePath, [
      workspaceRoot,
    ]);

    expect(result.record).not.toBeNull();
    expect(result.record!.sourcePath).toBe(filePath);
    expect(result.record!.coveredLines).toEqual(new Set([2]));
    expect(result.record!.uncoveredLines).toEqual(new Set([3]));
    expect(result.record!.lineCoveragePercent).toBe(50);
    expect(result.record!.sourceFormat).toBe("simplecov-json");
  });

  it("resolves absolute file paths from the resultset", async () => {
    const filePath = path.join(workspaceRoot, "app", "account.rb");
    fs.writeFileSync(filePath, "class Account\nend\n");
    const artifactPath = writeResultset(filePath);
    const now = Date.now() / 1000;
    fs.utimesSync(filePath, now - 1, now - 1);
    fs.utimesSync(artifactPath, now, now);

    const result = await new SimpleCovJsonAdapter().getCoverage(filePath, [
      workspaceRoot,
    ]);

    expect(result.record).not.toBeNull();
    expect(result.record!.sourcePath).toBe(filePath);
  });

  it("returns stale when the source is newer than the resultset", async () => {
    const filePath = path.join(workspaceRoot, "app", "user.rb");
    fs.writeFileSync(filePath, "class User\nend\n");
    const artifactPath = writeResultset("app/user.rb");
    const now = Date.now() / 1000;
    fs.utimesSync(artifactPath, now - 5, now - 5);
    fs.utimesSync(filePath, now, now);

    const result = await new SimpleCovJsonAdapter().getCoverage(filePath, [
      workspaceRoot,
    ]);

    expect(result.record).toBeNull();
    expect(result.rejectReason).toBe("stale");
  });

  it("lists covered source paths for aggregation", () => {
    const filePath = path.join(workspaceRoot, "app", "user.rb");
    fs.writeFileSync(filePath, "class User\nend\n");
    writeResultset("app/user.rb");

    expect(listSimpleCovJsonSourcePaths([workspaceRoot])).toEqual([filePath]);
  });
});
