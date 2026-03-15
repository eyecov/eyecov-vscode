import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  CoverageResolver,
  CoverageAdapter,
  PhpUnitHtmlAdapter,
  LcovAdapter,
  FixtureAdapter,
  createAdaptersFromConfig,
} from "./coverage-resolver";
import { DEFAULT_CONFIG } from "./covflux-config";

describe("CoverageResolver", () => {
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "covflux-resolver-"));
    workspaceRoot = path.join(tmpDir, "workspace");
    fs.mkdirSync(path.join(workspaceRoot, "app", "Domain", "Foo"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(workspaceRoot, "coverage-html", "Domain", "Foo"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspaceRoot, "app", "Domain", "Foo", "Action.php"),
      "<?php\n",
    );
    const minimalHtml = `
<table id="code"><tr class="success d-flex"><td><a id="1" href="#1">1</a></td></tr></table>
`;
    fs.writeFileSync(
      path.join(
        workspaceRoot,
        "coverage-html",
        "Domain",
        "Foo",
        "Action.php.html",
      ),
      minimalHtml,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a coverage record when the first adapter finds coverage for the file", async () => {
    const adapter = new PhpUnitHtmlAdapter();
    const resolver = new CoverageResolver({
      workspaceRoots: [workspaceRoot],
      adapters: [adapter],
    });
    const sourcePath = path.join(
      workspaceRoot,
      "app",
      "Domain",
      "Foo",
      "Action.php",
    );

    const record = await resolver.getCoverage(sourcePath);

    expect(record).not.toBeNull();
    expect(record!.sourcePath).toBe(sourcePath);
    expect(record!.coveredLines.has(1)).toBe(true);
    expect(record!.uncoveredLines.size).toBe(0);
    expect(record!.lineCoveragePercent).toBe(100);
  });

  it("returns null when no adapter has coverage for the file", async () => {
    const adapter = new PhpUnitHtmlAdapter();
    const resolver = new CoverageResolver({
      workspaceRoots: [workspaceRoot],
      adapters: [adapter],
    });
    const sourcePath = path.join(
      workspaceRoot,
      "app",
      "Domain",
      "Foo",
      "Nonexistent.php",
    );

    const record = await resolver.getCoverage(sourcePath);

    expect(record).toBeNull();
  });

  it("uses adapter order: second adapter is tried when first returns null", async () => {
    const alwaysNull: CoverageAdapter = {
      getCoverage: async () => null,
    };
    const phpUnitAdapter = new PhpUnitHtmlAdapter();
    const resolver = new CoverageResolver({
      workspaceRoots: [workspaceRoot],
      adapters: [alwaysNull, phpUnitAdapter],
    });
    const sourcePath = path.join(
      workspaceRoot,
      "app",
      "Domain",
      "Foo",
      "Action.php",
    );

    const record = await resolver.getCoverage(sourcePath);

    expect(record).not.toBeNull();
    expect(record!.sourcePath).toBe(sourcePath);
    expect(record!.lineCoveragePercent).toBe(100);
  });

  it("returns LCOV coverage when LcovAdapter is second and finds the file", async () => {
    fs.mkdirSync(path.join(workspaceRoot, "coverage"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
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
    const sourcePath = path.join(workspaceRoot, "src", "bar.ts");
    fs.writeFileSync(sourcePath, "x\n");
    const t = Date.now() / 1000;
    fs.utimesSync(sourcePath, t - 1, t - 1);
    fs.utimesSync(lcovPath, t, t);

    const phpUnitAdapter = new PhpUnitHtmlAdapter();
    const lcovAdapter = new LcovAdapter();
    const resolver = new CoverageResolver({
      workspaceRoots: [workspaceRoot],
      adapters: [phpUnitAdapter, lcovAdapter],
    });

    const record = await resolver.getCoverage(sourcePath);

    expect(record).not.toBeNull();
    expect(record!.sourcePath).toBe(sourcePath);
    expect(record!.coveredLines.has(1)).toBe(true);
    expect(record!.uncoveredLines.has(2)).toBe(true);
    expect(record!.lineCoveragePercent).toBe(50);
  });

  it("createAdaptersFromConfig returns adapters in config order", () => {
    const adapters = createAdaptersFromConfig(DEFAULT_CONFIG);
    expect(adapters).toHaveLength(2);
    expect(adapters[0]).toBeInstanceOf(PhpUnitHtmlAdapter);
    expect(adapters[1]).toBeInstanceOf(LcovAdapter);
  });

  it("createAdaptersFromConfig with only lcov returns single adapter", () => {
    const adapters = createAdaptersFromConfig({
      formats: [{ type: "lcov", path: "coverage/lcov.info" }],
    });
    expect(adapters).toHaveLength(1);
    expect(adapters[0]).toBeInstanceOf(LcovAdapter);
  });

  it("createAdaptersFromConfig passes sourceSegment so resolver finds files under src/", async () => {
    fs.mkdirSync(path.join(workspaceRoot, "src", "Service"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(workspaceRoot, "coverage-html", "Service"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspaceRoot, "src", "Service", "Foo.php"),
      "<?php\n",
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "coverage-html", "Service", "Foo.php.html"),
      '<table id="code"><tr class="success d-flex"><td><a id="1" href="#1">1</a></td></tr></table>',
    );
    const config = {
      formats: [
        {
          type: "phpunit-html",
          path: "coverage-html",
          sourceSegment: "src" as const,
        },
      ],
    };
    const adapters = createAdaptersFromConfig(config);
    const resolver = new CoverageResolver({
      workspaceRoots: [workspaceRoot],
      adapters,
    });
    const sourcePath = path.join(workspaceRoot, "src", "Service", "Foo.php");

    const record = await resolver.getCoverage(sourcePath);

    expect(record).not.toBeNull();
    expect(record!.sourcePath).toBe(sourcePath);
    expect(record!.lineCoveragePercent).toBe(100);
  });

  it("returns coverage from FixtureAdapter when fixture matches file", async () => {
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "coverage"), { recursive: true });
    const fixturePath = path.join(workspaceRoot, "coverage", "fixture.json");
    fs.writeFileSync(
      fixturePath,
      JSON.stringify({
        sourcePath: "src/example.ts",
        coveredLines: [1, 2],
        uncoveredLines: [3],
        uncoverableLines: [4],
      }),
    );
    const sourcePath = path.join(workspaceRoot, "src", "example.ts");
    fs.writeFileSync(sourcePath, "");

    const fixtureAdapter = new FixtureAdapter({
      path: "coverage/fixture.json",
    });
    const resolver = new CoverageResolver({
      workspaceRoots: [workspaceRoot],
      adapters: [fixtureAdapter],
    });

    const record = await resolver.getCoverage(sourcePath);

    expect(record).not.toBeNull();
    expect(record!.sourcePath).toBe(sourcePath);
    expect(record!.coveredLines.has(1)).toBe(true);
    expect(record!.coveredLines.has(2)).toBe(true);
    expect(record!.uncoveredLines.has(3)).toBe(true);
    expect(record!.uncoverableLines.has(4)).toBe(true);
    expect(record!.lineCoveragePercent).toBe(66.67);
  });
});
