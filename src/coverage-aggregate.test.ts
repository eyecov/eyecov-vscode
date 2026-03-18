import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  aggregateCoverage,
  getPathAggregateResponse,
  getProjectAggregateResponse,
  listCoveredPaths,
  listCoveredPathsFromFirstFormat,
  projectAggregateFromCache,
  pathAggregateFromCache,
} from "./coverage-aggregate";
import type { CoverageRecord } from "./coverage-resolver";
import type { CoverageConfig } from "./coverage-config";

describe("coverage-aggregate", () => {
  describe("aggregateCoverage", () => {
    it("returns totalFiles, coveredFiles, aggregate percent and worstFiles for one path with coverage", async () => {
      const path = "/workspace/app/Domain/Foo/Action.php";
      const record: CoverageRecord = {
        sourcePath: path,
        coveredLines: new Set([1, 2, 3]),
        uncoveredLines: new Set([]),
        uncoverableLines: new Set([]),
        lineCoveragePercent: 100,
      };
      const getCoverage = async (p: string) => (p === path ? record : null);

      const result = await aggregateCoverage({
        paths: [path],
        getCoverage,
      });

      expect(result.totalFiles).toBe(1);
      expect(result.coveredFiles).toBe(1);
      expect(result.missingCoverageFiles).toBe(0);
      expect(result.aggregateCoveragePercent).toBe(100);
      expect(result.worstFiles).toHaveLength(1);
      expect(result.worstFiles[0]).toEqual({
        filePath: path,
        lineCoveragePercent: 100,
      });
    });

    it("returns zeros and null percent when paths is empty", async () => {
      const getCoverage = async () => null;
      const result = await aggregateCoverage({ paths: [], getCoverage });
      expect(result.totalFiles).toBe(0);
      expect(result.coveredFiles).toBe(0);
      expect(result.missingCoverageFiles).toBe(0);
      expect(result.aggregateCoveragePercent).toBeNull();
      expect(result.worstFiles).toEqual([]);
    });

    it("counts missing coverage and orders worstFiles by lowest line coverage first", async () => {
      const pathA = "/workspace/app/Domain/A.php";
      const pathB = "/workspace/app/Domain/B.php";
      const recordA: CoverageRecord = {
        sourcePath: pathA,
        coveredLines: new Set([1]),
        uncoveredLines: new Set([2, 3]),
        uncoverableLines: new Set([]),
        lineCoveragePercent: 33.33,
      };
      const recordB: CoverageRecord = {
        sourcePath: pathB,
        coveredLines: new Set([1, 2, 3]),
        uncoveredLines: new Set([4]),
        uncoverableLines: new Set([]),
        lineCoveragePercent: 75,
      };
      const getCoverage = async (p: string) => {
        if (p === pathA) return recordA;
        if (p === pathB) return recordB;
        return null;
      };

      const result = await aggregateCoverage({
        paths: [pathA, pathB, "/workspace/app/Domain/Missing.php"],
        getCoverage,
      });

      expect(result.totalFiles).toBe(3);
      expect(result.coveredFiles).toBe(2);
      expect(result.missingCoverageFiles).toBe(1);
      expect(result.worstFiles).toHaveLength(2);
      expect(result.worstFiles[0].lineCoveragePercent).toBe(33.33);
      expect(result.worstFiles[1].lineCoveragePercent).toBe(75);
    });

    it("returns zeroCoverageFiles for files with coveredLines <= cutoff when options specify zeroCoverageFilesLimit and coveredLinesCutoff", async () => {
      const pathZero = "/workspace/app/Zero.php";
      const pathSome = "/workspace/app/Some.php";
      const recordZero: CoverageRecord = {
        sourcePath: pathZero,
        coveredLines: new Set([]),
        uncoveredLines: new Set([1, 2]),
        uncoverableLines: new Set([]),
        lineCoveragePercent: 0,
      };
      const recordSome: CoverageRecord = {
        sourcePath: pathSome,
        coveredLines: new Set([1, 2, 3]),
        uncoveredLines: new Set([4]),
        uncoverableLines: new Set([]),
        lineCoveragePercent: 75,
      };
      const getCoverage = async (p: string) => {
        if (p === pathZero) return recordZero;
        if (p === pathSome) return recordSome;
        return null;
      };

      const result = await aggregateCoverage({
        paths: [pathZero, pathSome],
        getCoverage,
        coveredLinesCutoff: 0,
        zeroCoverageFilesLimit: 10,
      });

      expect(result.zeroCoverageFiles).toBeDefined();
      expect(result.zeroCoverageFiles).toHaveLength(1);
      expect(result.zeroCoverageFiles![0].filePath).toBe(pathZero);
      expect(result.zeroCoverageFiles![0].lineCoveragePercent).toBe(0);
      expect(result.zeroCoverageFiles![0].coveredLines).toBe(0);
    });
  });

  describe("listCoveredPaths", () => {
    let tmpDir: string;
    let workspaceRoot: string;
    const config: CoverageConfig = {
      formats: [
        { type: "phpunit-html", path: "coverage-html" },
        { type: "lcov", path: "coverage/lcov.info" },
      ],
    };

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eyecov-aggregate-"));
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

    it("returns all source paths from configured formats (PHPUnit HTML)", () => {
      const paths = listCoveredPaths({
        workspaceRoots: [workspaceRoot],
        config,
      });
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe(
        path.resolve(workspaceRoot, "app", "Domain", "Foo", "Action.php"),
      );
    });

    it("filters by pathPrefix when provided", () => {
      const paths = listCoveredPaths({
        workspaceRoots: [workspaceRoot],
        config,
        pathPrefix: "app/Domain",
      });
      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain("Domain" + path.sep + "Foo");

      const empty = listCoveredPaths({
        workspaceRoots: [workspaceRoot],
        config,
        pathPrefix: "app/Other",
      });
      expect(empty).toHaveLength(0);
    });

    it("filters by pathPrefixes (array): union of files under any prefix", () => {
      fs.mkdirSync(path.join(workspaceRoot, "app", "Domain", "Bar"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(workspaceRoot, "coverage-html", "Domain", "Bar"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(workspaceRoot, "app", "Domain", "Bar", "Other.php"),
        "<?php\n",
      );
      fs.writeFileSync(
        path.join(
          workspaceRoot,
          "coverage-html",
          "Domain",
          "Bar",
          "Other.php.html",
        ),
        '<table id="code"></table>',
      );

      const paths = listCoveredPaths({
        workspaceRoots: [workspaceRoot],
        config,
        pathPrefixes: ["app/Domain/Foo", "app/Domain/Bar"],
      });
      expect(paths).toHaveLength(2);
      expect(
        paths.some((p) => p.endsWith("Foo" + path.sep + "Action.php")),
      ).toBe(true);
      expect(
        paths.some((p) => p.endsWith("Bar" + path.sep + "Other.php")),
      ).toBe(true);
    });

    it("discovers files from the newly supported configured formats", () => {
      fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceRoot, "src", "foo.ts"),
        "export {};\n",
      );
      fs.writeFileSync(
        path.join(workspaceRoot, "src", "foo.go"),
        "package foo\n",
      );
      fs.writeFileSync(path.join(workspaceRoot, "src", "foo.py"), "pass\n");
      fs.writeFileSync(
        path.join(workspaceRoot, "src", "Foo.java"),
        "class Foo {}\n",
      );
      fs.writeFileSync(
        path.join(workspaceRoot, "src", "Foo.cs"),
        "class Foo {}\n",
      );
      fs.mkdirSync(path.join(workspaceRoot, "coverage"), { recursive: true });
      fs.mkdirSync(path.join(workspaceRoot, "target", "site", "jacoco"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(workspaceRoot, "TestResults"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(workspaceRoot, "coverage", "coverage-final.json"),
        JSON.stringify({
          "src/foo.ts": {
            path: "src/foo.ts",
            statementMap: { "0": { start: { line: 1 } } },
            s: { "0": 1 },
          },
        }),
      );
      fs.writeFileSync(
        path.join(workspaceRoot, "coverage.out"),
        "mode: set\nsrc/foo.go:1.1,1.2 1 1\n",
      );
      fs.writeFileSync(
        path.join(workspaceRoot, "coverage.json"),
        JSON.stringify({
          meta: { version: "7.0" },
          files: { "src/foo.py": { executed_lines: [1], missing_lines: [] } },
        }),
      );
      fs.writeFileSync(
        path.join(workspaceRoot, "target", "site", "jacoco", "jacoco.xml"),
        '<report><package name="src"><sourcefile name="Foo.java"><line nr="1" mi="0" ci="1"/></sourcefile></package></report>',
      );
      fs.writeFileSync(
        path.join(workspaceRoot, "TestResults", "coverage.xml"),
        [
          "<CoverageSession>",
          '<Modules><Module><Files><File uid="1" fullPath="src/Foo.cs"/></Files>',
          "<Classes><Class><Methods><Method><SequencePoints>",
          '<SequencePoint vc="1" sl="1" fileid="1"/>',
          "</SequencePoints></Method></Methods></Class></Classes>",
          "</Module></Modules>",
          "</CoverageSession>",
        ].join(""),
      );
      const paths = listCoveredPaths({
        workspaceRoots: [workspaceRoot],
        config: {
          formats: [
            { type: "istanbul-json", path: "coverage/coverage-final.json" },
            { type: "go-coverprofile", path: "coverage.out" },
            { type: "coveragepy-json", path: "coverage.json" },
            { type: "jacoco", path: "target/site/jacoco/jacoco.xml" },
            { type: "opencover", path: "TestResults/coverage.xml" },
          ],
        },
      });

      expect(paths).toEqual([
        path.resolve(workspaceRoot, "src", "Foo.cs"),
        path.resolve(workspaceRoot, "src", "Foo.java"),
        path.resolve(workspaceRoot, "src", "foo.go"),
        path.resolve(workspaceRoot, "src", "foo.py"),
        path.resolve(workspaceRoot, "src", "foo.ts"),
      ]);
    });

    it("getPathAggregateResponse returns path-aggregate shape for single path prefix", async () => {
      const { CoverageResolver, createAdaptersFromConfig } =
        await import("./coverage-resolver");
      const resolver = new CoverageResolver({
        workspaceRoots: [workspaceRoot],
        adapters: createAdaptersFromConfig(config),
      });
      const response = await getPathAggregateResponse({
        workspaceRoots: [workspaceRoot],
        config,
        path: "app/Domain",
        getCoverage: (p) => resolver.getCoverage(p).then((r) => r.record),
      });
      expect(response.paths).toEqual(["app/Domain"]);
      expect(response.totalFiles).toBe(1);
      expect(response.coveredFiles).toBe(1);
      expect(response.aggregateCoveragePercent).toBe(100);
      expect(response.worstFiles).toHaveLength(1);
      expect(response.worstFiles[0].filePath).toContain("Action.php");
    });

    it("getPathAggregateResponse accepts paths array and aggregates over union", async () => {
      fs.mkdirSync(path.join(workspaceRoot, "app", "Domain", "Bar"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(workspaceRoot, "coverage-html", "Domain", "Bar"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(workspaceRoot, "app", "Domain", "Bar", "Other.php"),
        "<?php\n",
      );
      fs.writeFileSync(
        path.join(
          workspaceRoot,
          "coverage-html",
          "Domain",
          "Bar",
          "Other.php.html",
        ),
        '<table id="code"></table>',
      );
      const { CoverageResolver, createAdaptersFromConfig } =
        await import("./coverage-resolver");
      const resolver = new CoverageResolver({
        workspaceRoots: [workspaceRoot],
        adapters: createAdaptersFromConfig(config),
      });
      const response = await getPathAggregateResponse({
        workspaceRoots: [workspaceRoot],
        config,
        paths: ["app/Domain/Foo", "app/Domain/Bar"],
        getCoverage: (p) => resolver.getCoverage(p).then((r) => r.record),
      });
      expect(response.paths).toEqual(["app/Domain/Foo", "app/Domain/Bar"]);
      expect(response.totalFiles).toBe(2);
      expect(response.coveredFiles).toBe(2);
      expect(response.aggregateCoveragePercent).toBe(100);
      expect(response.worstFiles).toHaveLength(2);
    });

    it("getPathAggregateResponse returns zeroCoverageFiles when zeroCoverageFilesLimit and coveredLinesCutoff are passed", async () => {
      fs.mkdirSync(path.join(workspaceRoot, "app", "Domain", "Bar"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(workspaceRoot, "coverage-html", "Domain", "Bar"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(workspaceRoot, "app", "Domain", "Bar", "Other.php"),
        "<?php\n",
      );
      fs.writeFileSync(
        path.join(
          workspaceRoot,
          "coverage-html",
          "Domain",
          "Bar",
          "Other.php.html",
        ),
        '<table id="code"></table>',
      );
      const { CoverageResolver, createAdaptersFromConfig } =
        await import("./coverage-resolver");
      const resolver = new CoverageResolver({
        workspaceRoots: [workspaceRoot],
        adapters: createAdaptersFromConfig(config),
      });
      const response = await getPathAggregateResponse({
        workspaceRoots: [workspaceRoot],
        config,
        paths: ["app/Domain/Foo", "app/Domain/Bar"],
        getCoverage: (p) => resolver.getCoverage(p).then((r) => r.record),
        zeroCoverageFilesLimit: 10,
        coveredLinesCutoff: 0,
      });
      expect(response.zeroCoverageFiles).toBeDefined();
      expect(response.zeroCoverageFiles!.length).toBeGreaterThanOrEqual(1);
      const zeroFile = response.zeroCoverageFiles!.find(
        (f) => f.coveredLines === 0 || f.lineCoveragePercent === 0,
      );
      expect(zeroFile).toBeDefined();
      expect(zeroFile!.filePath).toContain("Bar");
    });

    it("getProjectAggregateResponse returns project shape with detectedFormat and cacheState on-demand", async () => {
      const { CoverageResolver, createAdaptersFromConfig } =
        await import("./coverage-resolver");
      const resolver = new CoverageResolver({
        workspaceRoots: [workspaceRoot],
        adapters: createAdaptersFromConfig(config),
      });
      const response = await getProjectAggregateResponse({
        workspaceRoots: [workspaceRoot],
        config,
        getCoverage: (p) => resolver.getCoverage(p).then((r) => r.record),
      });
      expect(response.aggregateCoveragePercent).toBe(100);
      expect(response.totalFiles).toBe(1);
      expect(response.coveredFiles).toBe(1);
      expect(response.missingCoverageFiles).toBe(0);
      expect(response.staleCoverageFiles).toBe(0);
      expect(response.cacheState).toBe("on-demand");
      expect(response.detectedFormat).toBe("phpunit-html");
    });

    it("getProjectAggregateResponse uses first format with data (LCOV when no PHPUnit HTML)", async () => {
      const lcovRoot = path.join(tmpDir, "lcov-only");
      fs.mkdirSync(path.join(lcovRoot, "src"), { recursive: true });
      fs.mkdirSync(path.join(lcovRoot, "coverage"), { recursive: true });
      const lcovContent = [
        "TN:",
        "SF:src/bar.ts",
        "DA:1,1",
        "LF:1",
        "LH:1",
        "end_of_record",
      ].join("\n");
      fs.writeFileSync(
        path.join(lcovRoot, "coverage", "lcov.info"),
        lcovContent,
      );
      fs.writeFileSync(path.join(lcovRoot, "src", "bar.ts"), "x\n");
      const t = Date.now() / 1000;
      fs.utimesSync(path.join(lcovRoot, "src", "bar.ts"), t - 1, t - 1);
      fs.utimesSync(path.join(lcovRoot, "coverage", "lcov.info"), t, t);

      const { CoverageResolver, createAdaptersFromConfig } =
        await import("./coverage-resolver");
      const resolver = new CoverageResolver({
        workspaceRoots: [lcovRoot],
        adapters: createAdaptersFromConfig(config),
      });
      const response = await getProjectAggregateResponse({
        workspaceRoots: [lcovRoot],
        config,
        getCoverage: (p) => resolver.getCoverage(p).then((r) => r.record),
      });
      expect(response.totalFiles).toBe(1);
      expect(response.coveredFiles).toBe(1);
      expect(response.detectedFormat).toBe("lcov");
    });

    it("listCoveredPathsFromFirstFormat respects configured XML-before-LCOV order", () => {
      const xmlRoot = path.join(tmpDir, "xml-priority");
      fs.mkdirSync(path.join(xmlRoot, "src"), { recursive: true });
      fs.mkdirSync(path.join(xmlRoot, "coverage"), { recursive: true });
      fs.writeFileSync(path.join(xmlRoot, "src", "priority.ts"), "x\n");
      fs.writeFileSync(
        path.join(xmlRoot, "coverage", "cobertura-coverage.xml"),
        `<?xml version="1.0"?>
<coverage>
  <sources>
    <source>${xmlRoot}</source>
  </sources>
  <packages>
    <package>
      <classes>
        <class name="Priority" filename="src/priority.ts">
          <lines>
            <line number="1" hits="1"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`,
      );
      fs.writeFileSync(
        path.join(xmlRoot, "coverage", "lcov.info"),
        [
          "TN:",
          "SF:src/priority.ts",
          "DA:1,1",
          "LF:1",
          "LH:1",
          "end_of_record",
        ].join("\n"),
      );

      const result = listCoveredPathsFromFirstFormat([xmlRoot], {
        formats: [
          { type: "cobertura", path: "coverage/cobertura-coverage.xml" },
          { type: "clover", path: "coverage/clover.xml" },
          { type: "lcov", path: "coverage/lcov.info" },
        ],
      });

      expect(result.formatType).toBe("cobertura");
      expect(result.paths).toEqual([
        path.resolve(xmlRoot, "src", "priority.ts"),
      ]);
    });

    it("integrates with CoverageResolver: listCoveredPaths then aggregateCoverage", async () => {
      const { CoverageResolver, createAdaptersFromConfig } =
        await import("./coverage-resolver");
      const paths = listCoveredPaths({
        workspaceRoots: [workspaceRoot],
        config,
      });
      const resolver = new CoverageResolver({
        workspaceRoots: [workspaceRoot],
        adapters: createAdaptersFromConfig(config),
      });
      const result = await aggregateCoverage({
        paths,
        getCoverage: (p) => resolver.getCoverage(p).then((r) => r.record),
      });
      expect(result.totalFiles).toBe(1);
      expect(result.coveredFiles).toBe(1);
      expect(result.aggregateCoveragePercent).toBe(100);
      expect(result.worstFiles[0].filePath).toContain("Action.php");
    });
  });

  describe("projectAggregateFromCache", () => {
    it("returns project response with cacheState full from cache top-level fields", () => {
      const cache = {
        version: 1,
        generatedAt: "2025-03-14T12:00:00.000Z",
        workspaceRoot: "/project",
        detectedFormat: "phpunit-html",
        aggregateCoveragePercent: 85,
        totalFiles: 100,
        coveredFiles: 80,
        missingCoverageFiles: 15,
        staleCoverageFiles: 5,
        files: [],
      };
      const response = projectAggregateFromCache(cache);
      expect(response.aggregateCoveragePercent).toBe(85);
      expect(response.totalFiles).toBe(100);
      expect(response.coveredFiles).toBe(80);
      expect(response.missingCoverageFiles).toBe(15);
      expect(response.staleCoverageFiles).toBe(5);
      expect(response.detectedFormat).toBe("phpunit-html");
      expect(response.cacheState).toBe("full");
    });
  });

  describe("pathAggregateFromCache", () => {
    it("filters cache files by path prefix and returns path aggregate with cacheState full", () => {
      const workspaceRoot = path.join(os.tmpdir(), "eyecov-path-cache-test");
      const cache = {
        version: 1,
        generatedAt: "2025-03-14T12:00:00.000Z",
        workspaceRoot,
        detectedFormat: "phpunit-html",
        aggregateCoveragePercent: 70,
        totalFiles: 10,
        coveredFiles: 7,
        missingCoverageFiles: 3,
        staleCoverageFiles: 0,
        files: [
          {
            filePath: path.join(workspaceRoot, "app/Domain/Foo.php"),
            lineCoveragePercent: 100,
            coveredLines: 5,
            uncoveredLines: 0,
            uncoverableLines: 0,
          },
          {
            filePath: path.join(workspaceRoot, "app/Domain/Bar.php"),
            lineCoveragePercent: 50,
            coveredLines: 2,
            uncoveredLines: 2,
            uncoverableLines: 0,
          },
          {
            filePath: path.join(workspaceRoot, "other/NotInPrefix.php"),
            lineCoveragePercent: 80,
            coveredLines: 4,
            uncoveredLines: 1,
            uncoverableLines: 0,
          },
        ],
      };
      const response = pathAggregateFromCache(
        cache,
        workspaceRoot,
        ["app/Domain"],
        10,
      );
      expect(response.paths).toEqual(["app/Domain"]);
      expect(response.cacheState).toBe("full");
      expect(response.totalFiles).toBe(2);
      expect(response.coveredFiles).toBe(2);
      expect(response.missingCoverageFiles).toBe(0);
      expect(response.aggregateCoveragePercent).toBe(77.78); // 7 covered / 9 executable
      expect(response.worstFiles).toHaveLength(2);
      expect(response.worstFiles[0].lineCoveragePercent).toBe(50);
      expect(response.worstFiles[1].lineCoveragePercent).toBe(100);
    });
  });
});
