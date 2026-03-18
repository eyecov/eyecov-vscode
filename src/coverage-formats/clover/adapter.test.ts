import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CloverAdapter, listCloverSourcePaths } from "./adapter";

describe("CloverAdapter", () => {
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eyecov-clover-"));
    workspaceRoot = path.join(tmpDir, "workspace");
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "coverage"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns coverage for a file that appears in clover.xml", async () => {
    const cloverPath = path.join(workspaceRoot, "coverage", "clover.xml");
    const filePath = path.join(workspaceRoot, "src", "Foo.ts");
    fs.writeFileSync(
      cloverPath,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<coverage generated="1" clover="1.0">',
        '<project timestamp="1">',
        `<file name="Foo.ts" path="${filePath}">`,
        '<line num="1" type="stmt" count="1"/>',
        '<line num="2" type="stmt" count="0"/>',
        "</file>",
        "</project>",
        "</coverage>",
      ].join("\n"),
    );
    fs.writeFileSync(filePath, "console.log('hi');\n");
    const now = Date.now() / 1000;
    fs.utimesSync(filePath, now - 1, now - 1);
    fs.utimesSync(cloverPath, now, now);

    const result = await new CloverAdapter().getCoverage(filePath, [
      workspaceRoot,
    ]);

    expect(result.record?.sourcePath).toBe(filePath);
    expect(result.record?.coveredLines.has(1)).toBe(true);
    expect(result.record?.uncoveredLines.has(2)).toBe(true);
    expect(result.record?.lineCoveragePercent).toBe(50);
  });

  it("returns no-artifact for malformed Clover XML", async () => {
    const cloverPath = path.join(workspaceRoot, "coverage", "clover.xml");
    fs.writeFileSync(cloverPath, '<coverage><file path="src/Foo.ts">');
    const filePath = path.join(workspaceRoot, "src", "Foo.ts");
    fs.writeFileSync(filePath, "x\n");

    const result = await new CloverAdapter().getCoverage(filePath, [
      workspaceRoot,
    ]);

    expect(result.record).toBeNull();
    expect(result.rejectReason).toBe("no-artifact");
  });

  it("returns stale when the source file is newer than the Clover artifact", async () => {
    const cloverPath = path.join(workspaceRoot, "coverage", "clover.xml");
    const filePath = path.join(workspaceRoot, "src", "Foo.ts");
    fs.writeFileSync(
      cloverPath,
      [
        '<coverage generated="1" clover="1.0">',
        '<project timestamp="1">',
        `<file name="Foo.ts" path="${filePath}">`,
        '<line num="1" type="stmt" count="1"/>',
        "</file>",
        "</project>",
        "</coverage>",
      ].join("\n"),
    );
    fs.writeFileSync(filePath, "console.log('hi');\n");
    const now = Date.now() / 1000;
    fs.utimesSync(cloverPath, now - 5, now - 5);
    fs.utimesSync(filePath, now, now);

    const result = await new CloverAdapter().getCoverage(filePath, [
      workspaceRoot,
    ]);

    expect(result.record).toBeNull();
    expect(result.rejectReason).toBe("stale");
  });

  it("uses a custom artifact path when provided", async () => {
    const reportsDir = path.join(workspaceRoot, "reports");
    fs.mkdirSync(reportsDir, { recursive: true });
    const cloverPath = path.join(reportsDir, "coverage.xml");
    const filePath = path.join(workspaceRoot, "src", "Foo.ts");
    fs.writeFileSync(
      cloverPath,
      [
        '<coverage generated="1" clover="1.0">',
        '<project timestamp="1">',
        `<file name="Foo.ts" path="${filePath}">`,
        '<line num="1" type="stmt" count="1"/>',
        "</file>",
        "</project>",
        "</coverage>",
      ].join("\n"),
    );
    fs.writeFileSync(filePath, "console.log('hi');\n");
    const now = Date.now() / 1000;
    fs.utimesSync(filePath, now - 1, now - 1);
    fs.utimesSync(cloverPath, now, now);

    const result = await new CloverAdapter({
      path: "reports/coverage.xml",
    }).getCoverage(filePath, [workspaceRoot]);

    expect(result.record?.sourcePath).toBe(filePath);
    expect(result.record?.lineCoveragePercent).toBe(100);
  });

  it("lists source paths from Clover XML", () => {
    const cloverPath = path.join(workspaceRoot, "coverage", "clover.xml");
    fs.writeFileSync(
      cloverPath,
      [
        '<coverage generated="1" clover="1.0">',
        '<project timestamp="1">',
        '<file name="Foo.ts" path="src/Foo.ts">',
        '<line num="1" type="stmt" count="1"/>',
        "</file>",
        '<file name="Bar.ts" path="src/Bar.ts">',
        '<line num="1" type="stmt" count="0"/>',
        "</file>",
        "</project>",
        "</coverage>",
      ].join("\n"),
    );

    expect(listCloverSourcePaths([workspaceRoot])).toEqual([
      path.resolve(workspaceRoot, "src", "Bar.ts"),
      path.resolve(workspaceRoot, "src", "Foo.ts"),
    ]);
  });
});
