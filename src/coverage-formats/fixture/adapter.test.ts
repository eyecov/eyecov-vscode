import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { FixtureAdapter } from "./adapter";

describe("FixtureAdapter", () => {
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "covflux-fixture-"));
    workspaceRoot = path.join(tmpDir, "workspace");
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "coverage"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a coverage record when fixture has matching sourcePath", async () => {
    const fixturePath = path.join(workspaceRoot, "coverage", "fixture.json");
    fs.writeFileSync(
      fixturePath,
      JSON.stringify({
        sourcePath: "src/bar.ts",
        coveredLines: [1],
        uncoveredLines: [2],
      }),
    );
    const sourcePath = path.join(workspaceRoot, "src", "bar.ts");
    fs.writeFileSync(sourcePath, "x\n");

    const adapter = new FixtureAdapter({ path: "coverage/fixture.json" });
    const result = await adapter.getCoverage(sourcePath, [workspaceRoot]);
    const record = result.record;

    expect(record).not.toBeNull();
    expect(record!.sourcePath).toBe(sourcePath);
    expect(record!.coveredLines.has(1)).toBe(true);
    expect(record!.uncoveredLines.has(2)).toBe(true);
    expect(record!.uncoverableLines.size).toBe(0);
    expect(record!.lineCoveragePercent).toBe(50);
  });

  it("returns null when file is not in fixture", async () => {
    const fixturePath = path.join(workspaceRoot, "coverage", "fixture.json");
    fs.writeFileSync(
      fixturePath,
      JSON.stringify({
        sourcePath: "src/other.ts",
        coveredLines: [1],
        uncoveredLines: [],
      }),
    );
    const sourcePath = path.join(workspaceRoot, "src", "bar.ts");

    const adapter = new FixtureAdapter({ path: "coverage/fixture.json" });
    const result = await adapter.getCoverage(sourcePath, [workspaceRoot]);

    expect(result.record).toBeNull();
  });

  it("resolves both sources from multi-file fixture", async () => {
    const fixturePath = path.join(workspaceRoot, "coverage", "fixture.json");
    fs.writeFileSync(
      fixturePath,
      JSON.stringify({
        files: [
          { sourcePath: "src/a.ts", coveredLines: [1], uncoveredLines: [] },
          { sourcePath: "src/b.ts", coveredLines: [], uncoveredLines: [1, 2] },
        ],
      }),
    );
    fs.writeFileSync(path.join(workspaceRoot, "src", "a.ts"), "");
    fs.writeFileSync(path.join(workspaceRoot, "src", "b.ts"), "");

    const adapter = new FixtureAdapter({ path: "coverage/fixture.json" });
    const resultA = await adapter.getCoverage(
      path.join(workspaceRoot, "src", "a.ts"),
      [workspaceRoot],
    );
    const resultB = await adapter.getCoverage(
      path.join(workspaceRoot, "src", "b.ts"),
      [workspaceRoot],
    );
    const recordA = resultA.record;
    const recordB = resultB.record;

    expect(recordA).not.toBeNull();
    expect(recordA!.lineCoveragePercent).toBe(100);
    expect(recordB).not.toBeNull();
    expect(recordB!.uncoveredLines.has(1)).toBe(true);
    expect(recordB!.uncoveredLines.has(2)).toBe(true);
  });

  it("includes uncoverableLines from fixture in record", async () => {
    const fixturePath = path.join(workspaceRoot, "coverage", "fixture.json");
    fs.writeFileSync(
      fixturePath,
      JSON.stringify({
        sourcePath: "src/foo.ts",
        coveredLines: [1],
        uncoveredLines: [2],
        uncoverableLines: [3, 4],
      }),
    );
    const sourcePath = path.join(workspaceRoot, "src", "foo.ts");
    fs.writeFileSync(sourcePath, "");

    const adapter = new FixtureAdapter({ path: "coverage/fixture.json" });
    const result = await adapter.getCoverage(sourcePath, [workspaceRoot]);
    const record = result.record;

    expect(record).not.toBeNull();
    expect(record!.uncoverableLines.has(3)).toBe(true);
    expect(record!.uncoverableLines.has(4)).toBe(true);
  });
});
