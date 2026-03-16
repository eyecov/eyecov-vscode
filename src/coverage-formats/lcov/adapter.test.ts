import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { LcovAdapter, listLcovSourcePaths } from "./adapter";

describe("LcovAdapter", () => {
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "covflux-lcov-"));
    workspaceRoot = path.join(tmpDir, "workspace");
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "coverage"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a coverage record when the file is present in coverage/lcov.info", async () => {
    const lcovContent = [
      "TN:",
      "SF:src/bar.ts",
      "DA:1,1",
      "DA:2,0",
      "LF:2",
      "LH:1",
      "end_of_record",
    ].join("\n");
    const lcovPath = path.join(workspaceRoot, "coverage", "lcov.info");
    fs.writeFileSync(lcovPath, lcovContent);
    const filePath = path.join(workspaceRoot, "src", "bar.ts");
    fs.writeFileSync(filePath, 'console.log("hi");\n');
    const t = Date.now() / 1000;
    fs.utimesSync(filePath, t - 1, t - 1);
    fs.utimesSync(lcovPath, t, t);

    const adapter = new LcovAdapter();
    const result = await adapter.getCoverage(filePath, [workspaceRoot]);
    const record = result.record;

    expect(record).not.toBeNull();
    expect(record!.sourcePath).toBe(filePath);
    expect(record!.coveredLines.has(1)).toBe(true);
    expect(record!.uncoveredLines.has(2)).toBe(true);
    expect(record!.lineCoveragePercent).toBe(50);
  });

  it("returns null when the file is not in lcov.info", async () => {
    const lcovContent = [
      "TN:",
      "SF:src/other.ts",
      "DA:1,1",
      "LF:1",
      "LH:1",
      "end_of_record",
    ].join("\n");
    fs.writeFileSync(
      path.join(workspaceRoot, "coverage", "lcov.info"),
      lcovContent,
    );
    const adapter = new LcovAdapter();
    const filePath = path.join(workspaceRoot, "src", "bar.ts");

    const result = await adapter.getCoverage(filePath, [workspaceRoot]);

    expect(result.record).toBeNull();
  });

  it("returns null when coverage/lcov.info does not exist", async () => {
    const adapter = new LcovAdapter();
    const filePath = path.join(workspaceRoot, "src", "bar.ts");

    const result = await adapter.getCoverage(filePath, [workspaceRoot]);

    expect(result.record).toBeNull();
  });

  it("finds coverage when lcov.info is under the second workspace root", async () => {
    const otherRoot = path.join(tmpDir, "other");
    fs.mkdirSync(path.join(otherRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(otherRoot, "coverage"), { recursive: true });
    const lcovContent = [
      "TN:",
      "SF:src/bar.ts",
      "DA:1,1",
      "LF:1",
      "LH:1",
      "end_of_record",
    ].join("\n");
    const lcovPath = path.join(otherRoot, "coverage", "lcov.info");
    fs.writeFileSync(lcovPath, lcovContent);
    const filePath = path.join(otherRoot, "src", "bar.ts");
    fs.writeFileSync(filePath, "x\n");
    const t = Date.now() / 1000;
    fs.utimesSync(filePath, t - 1, t - 1);
    fs.utimesSync(lcovPath, t, t);

    const adapter = new LcovAdapter();

    const result = await adapter.getCoverage(filePath, [
      workspaceRoot,
      otherRoot,
    ]);
    const record = result.record;

    expect(record).not.toBeNull();
    expect(record!.sourcePath).toBe(filePath);
    expect(record!.lineCoveragePercent).toBe(100);
  });

  it("uses custom path when provided", async () => {
    const customDir = path.join(workspaceRoot, "out");
    fs.mkdirSync(customDir, { recursive: true });
    const lcovContent = [
      "TN:",
      "SF:src/bar.ts",
      "DA:1,1",
      "LF:1",
      "LH:1",
      "end_of_record",
    ].join("\n");
    const lcovPath = path.join(customDir, "lcov.info");
    fs.writeFileSync(lcovPath, lcovContent);
    const filePath = path.join(workspaceRoot, "src", "bar.ts");
    fs.writeFileSync(filePath, "x\n");
    const t = Date.now() / 1000;
    fs.utimesSync(filePath, t - 1, t - 1);
    fs.utimesSync(lcovPath, t, t);

    const adapter = new LcovAdapter({ path: "out/lcov.info" });

    const result = await adapter.getCoverage(filePath, [workspaceRoot]);
    const record = result.record;

    expect(record).not.toBeNull();
    expect(record!.sourcePath).toBe(filePath);
    expect(record!.lineCoveragePercent).toBe(100);
  });

  describe("listLcovSourcePaths", () => {
    it("returns all source paths from lcov.info under the given roots", () => {
      const lcovContent = [
        "TN:",
        "SF:src/bar.ts",
        "DA:1,1",
        "LF:1",
        "LH:1",
        "end_of_record",
        "TN:",
        "SF:src/foo.ts",
        "DA:1,1",
        "LF:1",
        "LH:1",
        "end_of_record",
      ].join("\n");
      fs.writeFileSync(
        path.join(workspaceRoot, "coverage", "lcov.info"),
        lcovContent,
      );

      const paths = listLcovSourcePaths([workspaceRoot]);
      expect(paths).toHaveLength(2);
      expect(paths).toContain(path.resolve(workspaceRoot, "src", "bar.ts"));
      expect(paths).toContain(path.resolve(workspaceRoot, "src", "foo.ts"));
    });

    it("returns empty when lcov.info does not exist", () => {
      expect(listLcovSourcePaths([workspaceRoot])).toEqual([]);
    });
  });

  it("returns null when source file is newer than lcov.info (stale)", async () => {
    const lcovContent = [
      "TN:",
      "SF:src/bar.ts",
      "DA:1,1",
      "LF:1",
      "LH:1",
      "end_of_record",
    ].join("\n");
    const lcovPath = path.join(workspaceRoot, "coverage", "lcov.info");
    fs.writeFileSync(lcovPath, lcovContent);
    const filePath = path.join(workspaceRoot, "src", "bar.ts");
    fs.writeFileSync(filePath, 'console.log("hi");\n');

    const nowSec = Date.now() / 1000;
    const fiveSecondsAgo = nowSec - 5;
    fs.utimesSync(lcovPath, fiveSecondsAgo, fiveSecondsAgo);
    fs.utimesSync(filePath, nowSec, nowSec);

    const adapter = new LcovAdapter();
    const result = await adapter.getCoverage(filePath, [workspaceRoot]);

    expect(result.record).toBeNull();
    expect(result.rejectReason).toBe("stale");
  });
});
