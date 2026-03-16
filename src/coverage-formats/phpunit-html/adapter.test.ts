import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { LINE_STATUS } from "../../coverage-types";
import {
  resolveCoverageHtmlPath,
  buildCoverageFileResult,
  findCoverageHtmlBasenameMatches,
  listCoverageHtmlSourcePaths,
  stripTestsByLine,
  PhpUnitHtmlAdapter,
} from "./index";

describe("phpunit-html adapter", () => {
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "covflux-test-"));
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

  describe("resolveCoverageHtmlPath", () => {
    it("resolves when source file is under app/ and coverage-html exists", () => {
      const sourcePath = path.join(
        workspaceRoot,
        "app",
        "Domain",
        "Foo",
        "Action.php",
      );
      const expected = path.join(
        workspaceRoot,
        "coverage-html",
        "Domain",
        "Foo",
        "Action.php.html",
      );
      expect(resolveCoverageHtmlPath(sourcePath, [workspaceRoot])).toBe(
        path.resolve(expected),
      );
    });

    it("returns null when coverage-html file does not exist", () => {
      const sourcePath = path.join(
        workspaceRoot,
        "app",
        "Domain",
        "Foo",
        "Other.php",
      );
      expect(resolveCoverageHtmlPath(sourcePath, [workspaceRoot])).toBeNull();
    });

    it("returns null when source is not under app/", () => {
      expect(
        resolveCoverageHtmlPath("/tmp/other/file.php", [workspaceRoot]),
      ).toBeNull();
    });

    it('resolves when sourceSegment is "src" and source file is under src/', () => {
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
        '<table id="code"><tr class="success d-flex"><td></td></tr></table>',
      );
      const sourcePath = path.join(workspaceRoot, "src", "Service", "Foo.php");
      const expected = path.join(
        workspaceRoot,
        "coverage-html",
        "Service",
        "Foo.php.html",
      );
      expect(
        resolveCoverageHtmlPath(sourcePath, [workspaceRoot], {
          sourceSegment: "src",
        }),
      ).toBe(path.resolve(expected));
    });

    it('with sourceSegment "auto", resolves using src/ when file exists under src but not app', () => {
      fs.mkdirSync(path.join(workspaceRoot, "src", "Lib"), { recursive: true });
      fs.mkdirSync(path.join(workspaceRoot, "coverage-html", "Lib"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(workspaceRoot, "src", "Lib", "Helper.php"),
        "<?php\n",
      );
      fs.writeFileSync(
        path.join(workspaceRoot, "coverage-html", "Lib", "Helper.php.html"),
        '<table id="code"><tr class="success d-flex"><td></td></tr></table>',
      );
      const sourcePath = path.join(workspaceRoot, "src", "Lib", "Helper.php");
      const expected = path.join(
        workspaceRoot,
        "coverage-html",
        "Lib",
        "Helper.php.html",
      );
      expect(
        resolveCoverageHtmlPath(sourcePath, [workspaceRoot], {
          sourceSegment: "auto",
        }),
      ).toBe(path.resolve(expected));
    });
  });

  describe("buildCoverageFileResult", () => {
    it("returns ParsedCoverageFileResult with line stats and testsByLine", () => {
      const sourcePath = path.join(
        workspaceRoot,
        "app",
        "Domain",
        "Foo",
        "Action.php",
      );
      const htmlPath = path.join(
        workspaceRoot,
        "coverage-html",
        "Domain",
        "Foo",
        "Action.php.html",
      );
      const result = buildCoverageFileResult(sourcePath, htmlPath);
      expect(result.filePath).toBe(sourcePath);
      expect(result.coverageHtmlPath).toBe(htmlPath);
      expect(result.coveredLines).toBe(1);
      expect(result.uncoveredLines).toBe(0);
      expect(result.lineCoveragePercent).toBe(100);
      expect(result.coveredLineNumbers).toEqual([1]);
      expect(result.testsByLine).toBeInstanceOf(Map);
      expect(result.lineStatuses).toBeInstanceOf(Map);
      expect(result.lineStatuses.get(1)).toBe(LINE_STATUS.COVERED_LARGE);
    });
  });

  describe("stripTestsByLine", () => {
    it("removes only testsByLine from ParsedCoverageFileResult and keeps coveredLineNumbers", () => {
      const sourcePath = path.join(
        workspaceRoot,
        "app",
        "Domain",
        "Foo",
        "Action.php",
      );
      const htmlPath = path.join(
        workspaceRoot,
        "coverage-html",
        "Domain",
        "Foo",
        "Action.php.html",
      );
      const full = buildCoverageFileResult(sourcePath, htmlPath);
      const stripped = stripTestsByLine(full);
      expect(stripped).not.toHaveProperty("testsByLine");
      expect(stripped).toHaveProperty("coveredLineNumbers");
      expect(stripped.coveredLineNumbers).toEqual(full.coveredLineNumbers);
      expect(stripped.filePath).toBe(full.filePath);
      expect(stripped.coveredLines).toBe(full.coveredLines);
    });
  });

  describe("findCoverageHtmlBasenameMatches", () => {
    it("finds files by basename under coverage-html", () => {
      const matches = findCoverageHtmlBasenameMatches("Action.php", [
        workspaceRoot,
      ]);
      expect(matches).toHaveLength(1);
      expect(matches[0].filePath).toContain("Action.php");
    });

    it("accepts query with .html suffix", () => {
      const matches = findCoverageHtmlBasenameMatches("Action.php.html", [
        workspaceRoot,
      ]);
      expect(matches).toHaveLength(1);
    });

    it("returns empty when no coverage-html root exists", () => {
      const emptyRoot = path.join(tmpDir, "empty");
      fs.mkdirSync(emptyRoot);
      expect(
        findCoverageHtmlBasenameMatches("Action.php", [emptyRoot]),
      ).toEqual([]);
    });

    it("excludes index.html and dashboard.html from basename search", () => {
      fs.writeFileSync(
        path.join(workspaceRoot, "coverage-html", "index.html"),
        "<html></html>",
      );
      fs.writeFileSync(
        path.join(workspaceRoot, "coverage-html", "dashboard.html"),
        "<html></html>",
      );
      fs.writeFileSync(path.join(workspaceRoot, "app", "index"), "");
      fs.writeFileSync(path.join(workspaceRoot, "app", "dashboard"), "");

      expect(findCoverageHtmlBasenameMatches("index", [workspaceRoot])).toEqual(
        [],
      );
      expect(
        findCoverageHtmlBasenameMatches("index.html", [workspaceRoot]),
      ).toEqual([]);
      expect(
        findCoverageHtmlBasenameMatches("dashboard", [workspaceRoot]),
      ).toEqual([]);
      expect(
        findCoverageHtmlBasenameMatches("dashboard.html", [workspaceRoot]),
      ).toEqual([]);
    });

    it('with sourceSegment "src", finds matches under src/', () => {
      fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
      fs.writeFileSync(path.join(workspaceRoot, "src", "Baz.php"), "<?php\n");
      fs.writeFileSync(
        path.join(workspaceRoot, "coverage-html", "Baz.php.html"),
        '<table id="code"><tr class="success d-flex"><td></td></tr></table>',
      );
      const matches = findCoverageHtmlBasenameMatches(
        "Baz.php",
        [workspaceRoot],
        { sourceSegment: "src" },
      );
      expect(matches).toHaveLength(1);
      expect(matches[0].filePath).toBe(
        path.resolve(workspaceRoot, "src", "Baz.php"),
      );
    });
  });

  describe("listCoverageHtmlSourcePaths", () => {
    it("returns all source paths that have coverage HTML under the given roots", () => {
      const paths = listCoverageHtmlSourcePaths([workspaceRoot]);
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe(
        path.resolve(workspaceRoot, "app", "Domain", "Foo", "Action.php"),
      );
    });

    it("excludes index.html and dashboard.html from discovery at any depth", () => {
      fs.writeFileSync(
        path.join(workspaceRoot, "coverage-html", "index.html"),
        "<html></html>",
      );
      fs.writeFileSync(
        path.join(workspaceRoot, "coverage-html", "dashboard.html"),
        "<html></html>",
      );
      // Source paths inferred by adapter: app/index, app/dashboard (basename without .html)
      fs.writeFileSync(path.join(workspaceRoot, "app", "index"), "");
      fs.writeFileSync(path.join(workspaceRoot, "app", "dashboard"), "");

      const paths = listCoverageHtmlSourcePaths([workspaceRoot]);

      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe(
        path.resolve(workspaceRoot, "app", "Domain", "Foo", "Action.php"),
      );
      expect(paths).not.toContain(path.resolve(workspaceRoot, "app", "index"));
      expect(paths).not.toContain(
        path.resolve(workspaceRoot, "app", "dashboard"),
      );
    });

    it("returns empty when coverage-html root does not exist", () => {
      const emptyRoot = path.join(tmpDir, "empty");
      fs.mkdirSync(emptyRoot);
      expect(listCoverageHtmlSourcePaths([emptyRoot])).toEqual([]);
    });

    it('with sourceSegment "src", discovers only source paths under src/', () => {
      fs.mkdirSync(path.join(workspaceRoot, "src", "Service"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(workspaceRoot, "coverage-html", "Service"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(workspaceRoot, "src", "Service", "Bar.php"),
        "<?php\n",
      );
      fs.writeFileSync(
        path.join(workspaceRoot, "coverage-html", "Service", "Bar.php.html"),
        '<table id="code"><tr class="success d-flex"><td></td></tr></table>',
      );
      const paths = listCoverageHtmlSourcePaths([workspaceRoot], {
        sourceSegment: "src",
      });
      expect(paths).toContain(
        path.resolve(workspaceRoot, "src", "Service", "Bar.php"),
      );
      expect(paths).not.toContain(
        path.resolve(workspaceRoot, "app", "Domain", "Foo", "Action.php"),
      );
    });
  });

  describe("PhpUnitHtmlAdapter", () => {
    it("populates record.lineStatuses from parser when coverage is found", async () => {
      const adapter = new PhpUnitHtmlAdapter();
      const sourcePath = path.join(
        workspaceRoot,
        "app",
        "Domain",
        "Foo",
        "Action.php",
      );
      const result = await adapter.getCoverage(sourcePath, [workspaceRoot]);
      const record = result.record;
      expect(record).not.toBeNull();
      expect(record!.lineStatuses).toBeDefined();
      expect(record!.lineStatuses!.get(1)).toBe(LINE_STATUS.COVERED_LARGE);
    });

    it("returns null when source file is newer than coverage HTML (stale)", async () => {
      const sourcePath = path.join(
        workspaceRoot,
        "app",
        "Domain",
        "Foo",
        "Action.php",
      );
      const htmlPath = path.join(
        workspaceRoot,
        "coverage-html",
        "Domain",
        "Foo",
        "Action.php.html",
      );
      const nowSec = Date.now() / 1000;
      const fiveSecondsAgo = nowSec - 5;
      fs.utimesSync(htmlPath, fiveSecondsAgo, fiveSecondsAgo);
      fs.utimesSync(sourcePath, nowSec, nowSec);

      const adapter = new PhpUnitHtmlAdapter();
      const result = await adapter.getCoverage(sourcePath, [workspaceRoot]);

      expect(result.record).toBeNull();
      expect(result.rejectReason).toBe("stale");
    });
  });
});
