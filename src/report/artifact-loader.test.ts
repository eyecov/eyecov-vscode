import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCoverageArtifact } from "./artifact-loader";

const tempDirs: string[] = [];

function createWorkspace(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eyecov-report-load-"));
  tempDirs.push(tmpDir);
  const workspaceRoot = path.join(tmpDir, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  return workspaceRoot;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("loadCoverageArtifact", () => {
  it("loads LCOV records from one artifact into normalized report records", async () => {
    const workspaceRoot = createWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src", "foo.ts"), "export {};\n");
    fs.writeFileSync(
      path.join(workspaceRoot, "coverage.info"),
      ["TN:", "SF:src/foo.ts", "DA:1,1", "DA:2,0", "end_of_record"].join("\n"),
    );

    const result = await loadCoverageArtifact({
      artifactPath: path.join(workspaceRoot, "coverage.info"),
      format: "lcov",
      workspaceRoot,
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.sourcePath).toBe(
      path.join(workspaceRoot, "src", "foo.ts"),
    );
    expect(result.reportTotals).toEqual({
      coveredLines: 1,
      executableLines: 2,
      aggregateCoveragePercent: 50,
    });
    expect(result.derivedTotals).toEqual({
      coveredLines: 1,
      executableLines: 2,
      aggregateCoveragePercent: 50,
    });
    expect(result.hasUnresolvedEntries).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("loads Cobertura records and exposes top-level totals for verification", async () => {
    const workspaceRoot = createWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src", "foo.ts"), "export {};\n");
    fs.writeFileSync(
      path.join(workspaceRoot, "cobertura.xml"),
      [
        '<?xml version="1.0"?>',
        '<coverage lines-covered="1" lines-valid="2" line-rate="0.5">',
        "<sources><source>.</source></sources>",
        '<packages><package><classes><class filename="src/foo.ts">',
        '<lines><line number="1" hits="1"/><line number="2" hits="0"/></lines>',
        "</class></classes></package></packages>",
        "</coverage>",
      ].join(""),
    );

    const result = await loadCoverageArtifact({
      artifactPath: path.join(workspaceRoot, "cobertura.xml"),
      format: "cobertura",
      workspaceRoot,
    });

    expect(result.records).toHaveLength(1);
    expect(result.reportTotals).toEqual({
      coveredLines: 1,
      executableLines: 2,
      aggregateCoveragePercent: 50,
    });
    expect(result.derivedTotals).toEqual({
      coveredLines: 1,
      executableLines: 2,
      aggregateCoveragePercent: 50,
    });
    expect(result.hasUnresolvedEntries).toBe(false);
  });

  it("loads Clover records and ignores method totals in verification metadata", async () => {
    const workspaceRoot = createWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src", "foo.ts"), "export {};\n");
    fs.writeFileSync(
      path.join(workspaceRoot, "clover.xml"),
      [
        '<?xml version="1.0"?>',
        '<coverage generated="1">',
        '<project timestamp="1">',
        '<metrics statements="2" coveredstatements="1" methods="4" coveredmethods="4"/>',
        '<file name="foo.ts" path="src/foo.ts">',
        '<line num="1" type="stmt" count="1"/>',
        '<line num="2" type="stmt" count="0"/>',
        '<line num="9" type="method" count="1"/>',
        "</file>",
        "</project>",
        "</coverage>",
      ].join(""),
    );

    const result = await loadCoverageArtifact({
      artifactPath: path.join(workspaceRoot, "clover.xml"),
      format: "clover",
      workspaceRoot,
    });

    expect(result.records).toHaveLength(1);
    expect(result.reportTotals).toEqual({
      coveredLines: 1,
      executableLines: 2,
      aggregateCoveragePercent: 50,
    });
    expect(result.derivedTotals).toEqual({
      coveredLines: 1,
      executableLines: 2,
      aggregateCoveragePercent: 50,
    });
    expect(result.hasUnresolvedEntries).toBe(false);
  });

  it("loads PHPUnit HTML records from a coverage directory", async () => {
    const workspaceRoot = createWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "app", "Domain"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "coverage-html", "Domain"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspaceRoot, "app", "Domain", "Action.php"),
      "<?php\n",
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "coverage-html", "Domain", "Action.php.html"),
      '<table id="code"><tr class="success d-flex"><td><a id="1" href="#1">1</a></td></tr></table>',
    );

    const result = await loadCoverageArtifact({
      artifactPath: path.join(workspaceRoot, "coverage-html"),
      format: "phpunit-html",
      workspaceRoot,
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.sourceFormat).toBe("phpunit-html");
    expect(result.reportTotals).toBeNull();
    expect(result.derivedTotals).toBeNull();
    expect(result.hasUnresolvedEntries).toBe(false);
  });

  it("emits warnings for stale and unresolved files without dropping stale records", async () => {
    const workspaceRoot = createWorkspace();
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    const staleFile = path.join(workspaceRoot, "src", "stale.ts");
    fs.writeFileSync(staleFile, "export {};\n");
    const artifactPath = path.join(workspaceRoot, "coverage.info");
    fs.writeFileSync(
      artifactPath,
      [
        "TN:",
        "SF:src/stale.ts",
        "DA:1,1",
        "end_of_record",
        "TN:",
        "SF:src/missing.ts",
        "DA:1,1",
        "end_of_record",
      ].join("\n"),
    );
    const newer = new Date(Date.now() + 5_000);
    fs.utimesSync(staleFile, newer, newer);

    const result = await loadCoverageArtifact({
      artifactPath,
      format: "lcov",
      workspaceRoot,
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.sourcePath).toBe(staleFile);
    expect(result.derivedTotals).toEqual({
      coveredLines: 2,
      executableLines: 2,
      aggregateCoveragePercent: 100,
    });
    expect(result.hasUnresolvedEntries).toBe(true);
    expect(result.warnings).toEqual([
      expect.stringContaining("stale"),
      expect.stringContaining("missing.ts"),
    ]);
  });
});
