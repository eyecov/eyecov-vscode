import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadCoverageConfig,
  DEFAULT_CONFIG,
  getPhpUnitHtmlDir,
  getPhpUnitHtmlSourceSegment,
  getLcovPath,
  getCoverageArtifactPathsToWatch,
  type CoverageConfig,
} from "./coverage-config";

describe("coverage-config", () => {
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-config-"));
    workspaceRoot = path.join(tmpDir, "workspace");
    fs.mkdirSync(workspaceRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("DEFAULT_CONFIG", () => {
    it("has phpunit-html, cobertura, clover, then lcov with default paths", () => {
      expect(DEFAULT_CONFIG.formats).toHaveLength(4);
      expect(DEFAULT_CONFIG.formats[0]).toEqual({
        type: "phpunit-html",
        path: "coverage-html",
      });
      expect(DEFAULT_CONFIG.formats[1]).toEqual({
        type: "cobertura",
        path: "coverage/cobertura-coverage.xml",
      });
      expect(DEFAULT_CONFIG.formats[2]).toEqual({
        type: "clover",
        path: "coverage/clover.xml",
      });
      expect(DEFAULT_CONFIG.formats[3]).toEqual({
        type: "lcov",
        path: "coverage/lcov.info",
      });
    });
  });

  describe("loadCoverageConfig", () => {
    it("returns DEFAULT_CONFIG when no config file exists", () => {
      const config = loadCoverageConfig(workspaceRoot);
      expect(config.formats).toEqual(DEFAULT_CONFIG.formats);
    });

    it("returns DEFAULT_CONFIG when workspace root is empty or missing", () => {
      expect(loadCoverageConfig("").formats).toEqual(DEFAULT_CONFIG.formats);
      expect(
        loadCoverageConfig(path.join(tmpDir, "nonexistent")).formats,
      ).toEqual(DEFAULT_CONFIG.formats);
    });

    it("loads .eyecov.json and uses its formats", () => {
      fs.writeFileSync(
        path.join(workspaceRoot, ".eyecov.json"),
        JSON.stringify({
          formats: [
            { type: "phpunit-html", path: "build/coverage-html" },
            { type: "cobertura", path: "build/cobertura.xml" },
            { type: "clover", path: "build/clover.xml" },
            { type: "lcov", path: "out/lcov.info" },
          ],
        }),
      );
      const config = loadCoverageConfig(workspaceRoot);
      expect(config.formats).toHaveLength(4);
      expect(config.formats[0]).toEqual({
        type: "phpunit-html",
        path: "build/coverage-html",
      });
      expect(config.formats[1]).toEqual({
        type: "cobertura",
        path: "build/cobertura.xml",
      });
      expect(config.formats[2]).toEqual({
        type: "clover",
        path: "build/clover.xml",
      });
      expect(config.formats[3]).toEqual({
        type: "lcov",
        path: "out/lcov.info",
      });
    });

    it("parses sourceSegment for phpunit-html entry when valid", () => {
      fs.writeFileSync(
        path.join(workspaceRoot, ".eyecov.json"),
        JSON.stringify({
          formats: [
            {
              type: "phpunit-html",
              path: "coverage-html",
              sourceSegment: "src",
            },
            { type: "cobertura", path: "coverage/cobertura-coverage.xml" },
            { type: "lcov", path: "coverage/lcov.info" },
          ],
        }),
      );
      const config = loadCoverageConfig(workspaceRoot);
      expect(config.formats[0]).toMatchObject({
        type: "phpunit-html",
        path: "coverage-html",
        sourceSegment: "src",
      });
      expect(getPhpUnitHtmlSourceSegment(config)).toBe("src");
    });

    it("loads eyecov.json when .eyecov.json is absent", () => {
      fs.writeFileSync(
        path.join(workspaceRoot, "eyecov.json"),
        JSON.stringify({
          formats: [{ type: "lcov", path: "coverage/lcov.info" }],
        }),
      );
      const config = loadCoverageConfig(workspaceRoot);
      expect(config.formats).toHaveLength(1);
      expect(config.formats[0]).toEqual({
        type: "lcov",
        path: "coverage/lcov.info",
      });
    });

    it("prefers .eyecov.json over eyecov.json", () => {
      fs.writeFileSync(
        path.join(workspaceRoot, "eyecov.json"),
        JSON.stringify({ formats: [{ type: "lcov", path: "a.info" }] }),
      );
      fs.writeFileSync(
        path.join(workspaceRoot, ".eyecov.json"),
        JSON.stringify({ formats: [{ type: "lcov", path: "b.info" }] }),
      );
      const config = loadCoverageConfig(workspaceRoot);
      expect(config.formats[0].path).toBe("b.info");
    });

    it("ignores unknown format types", () => {
      fs.writeFileSync(
        path.join(workspaceRoot, ".eyecov.json"),
        JSON.stringify({
          formats: [
            { type: "phpunit-html", path: "coverage-html" },
            { type: "unknown-format", path: "x" },
            { type: "clover", path: "coverage/clover.xml" },
            { type: "lcov", path: "coverage/lcov.info" },
          ],
        }),
      );
      const config = loadCoverageConfig(workspaceRoot);
      expect(config.formats).toHaveLength(3);
      expect(config.formats.map((f) => f.type)).toEqual([
        "phpunit-html",
        "clover",
        "lcov",
      ]);
    });

    it("ignores entries with missing or invalid type/path", () => {
      fs.writeFileSync(
        path.join(workspaceRoot, ".eyecov.json"),
        JSON.stringify({
          formats: [
            { type: "phpunit-html", path: "" },
            { type: "", path: "coverage-html" },
            { type: "cobertura", path: "coverage/cobertura-coverage.xml" },
            { type: "lcov", path: "coverage/lcov.info" },
          ],
        }),
      );
      const config = loadCoverageConfig(workspaceRoot);
      expect(config.formats).toHaveLength(2);
      expect(config.formats[0].type).toBe("cobertura");
      expect(config.formats[1].type).toBe("lcov");
    });

    it("returns DEFAULT_CONFIG when JSON is invalid", () => {
      fs.writeFileSync(path.join(workspaceRoot, ".eyecov.json"), "not json");
      const config = loadCoverageConfig(workspaceRoot);
      expect(config.formats).toEqual(DEFAULT_CONFIG.formats);
    });

    it("returns DEFAULT_CONFIG when formats is not an array", () => {
      fs.writeFileSync(
        path.join(workspaceRoot, ".eyecov.json"),
        JSON.stringify({ formats: null }),
      );
      const config = loadCoverageConfig(workspaceRoot);
      expect(config.formats).toEqual(DEFAULT_CONFIG.formats);
    });
  });

  describe("getPhpUnitHtmlDir", () => {
    it("returns default when no phpunit-html in config", () => {
      const config = {
        formats: [{ type: "lcov", path: "coverage/lcov.info" }],
      };
      expect(getPhpUnitHtmlDir(config)).toBe("coverage-html");
    });

    it("returns path from first phpunit-html entry", () => {
      const config = {
        formats: [{ type: "phpunit-html", path: "build/html" }],
      };
      expect(getPhpUnitHtmlDir(config)).toBe("build/html");
    });
  });

  describe("getPhpUnitHtmlSourceSegment", () => {
    it('returns "auto" when no phpunit-html in config', () => {
      const config = {
        formats: [{ type: "lcov", path: "coverage/lcov.info" }],
      };
      expect(getPhpUnitHtmlSourceSegment(config)).toBe("auto");
    });

    it('returns "auto" when phpunit-html entry has no sourceSegment', () => {
      const config = {
        formats: [{ type: "phpunit-html", path: "coverage-html" }],
      };
      expect(getPhpUnitHtmlSourceSegment(config)).toBe("auto");
    });

    it("returns sourceSegment from first phpunit-html entry when set", () => {
      const config = {
        formats: [
          {
            type: "phpunit-html",
            path: "coverage-html",
            sourceSegment: "src" as const,
          },
        ],
      };
      expect(getPhpUnitHtmlSourceSegment(config)).toBe("src");
    });
  });

  describe("getLcovPath", () => {
    it("returns default when no lcov in config", () => {
      const config = {
        formats: [{ type: "phpunit-html", path: "coverage-html" }],
      };
      expect(getLcovPath(config)).toBe("coverage/lcov.info");
    });

    it("returns path from first lcov entry", () => {
      const config = { formats: [{ type: "lcov", path: "out/lcov.info" }] };
      expect(getLcovPath(config)).toBe("out/lcov.info");
    });
  });

  describe("getCoverageArtifactPathsToWatch", () => {
    it("returns one absolute path per shared-file format per workspace root using default paths", () => {
      const config: CoverageConfig = DEFAULT_CONFIG;
      const roots = [workspaceRoot];
      const paths = getCoverageArtifactPathsToWatch(config, roots);
      expect(paths).toHaveLength(3);
      expect(paths).toEqual([
        path.join(workspaceRoot, "coverage", "cobertura-coverage.xml"),
        path.join(workspaceRoot, "coverage", "clover.xml"),
        path.join(workspaceRoot, "coverage", "lcov.info"),
      ]);
    });

    it("returns custom shared-file paths when configured", () => {
      const config: CoverageConfig = {
        formats: [
          { type: "cobertura", path: "build/cobertura.xml" },
          { type: "clover", path: "reports/clover.xml" },
          { type: "lcov", path: "build/coverage.info" },
        ],
      };
      const roots = [workspaceRoot];
      const paths = getCoverageArtifactPathsToWatch(config, roots);
      expect(paths).toHaveLength(3);
      expect(paths).toEqual([
        path.join(workspaceRoot, "build", "cobertura.xml"),
        path.join(workspaceRoot, "reports", "clover.xml"),
        path.join(workspaceRoot, "build", "coverage.info"),
      ]);
    });

    it("returns one path per format per workspace root for multi-root", () => {
      const root2 = path.join(tmpDir, "workspace2");
      fs.mkdirSync(root2, { recursive: true });
      const config: CoverageConfig = DEFAULT_CONFIG;
      const paths = getCoverageArtifactPathsToWatch(config, [
        workspaceRoot,
        root2,
      ]);
      expect(paths).toHaveLength(6);
      expect(paths).toEqual([
        path.join(workspaceRoot, "coverage", "cobertura-coverage.xml"),
        path.join(workspaceRoot, "coverage", "clover.xml"),
        path.join(workspaceRoot, "coverage", "lcov.info"),
        path.join(root2, "coverage", "cobertura-coverage.xml"),
        path.join(root2, "coverage", "clover.xml"),
        path.join(root2, "coverage", "lcov.info"),
      ]);
    });

    it("returns empty array when config has no shared-file formats", () => {
      const config: CoverageConfig = {
        formats: [{ type: "phpunit-html", path: "coverage-html" }],
      };
      const paths = getCoverageArtifactPathsToWatch(config, [workspaceRoot]);
      expect(paths).toHaveLength(0);
    });
  });
});
