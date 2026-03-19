import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  afterEach as vitestAfterEach,
} from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  writeCoverageCache,
  readCoverageCache,
  buildCoverageCachePayload,
  deleteCoverageCache,
} from "./coverage-cache";
import type { CoverageRecord } from "./coverage-resolver";

describe("coverage-cache", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `eyecov-cache-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  describe("writeCoverageCache", () => {
    it("writes valid JSON at workspaceRoot/.eyecov/coverage-cache.json with version, workspaceRoot, generatedAt", () => {
      const payload = {
        workspaceRoot: tmpDir,
        detectedFormat: "phpunit-html",
        aggregateCoveragePercent: 81.1,
        totalFiles: 320,
        coveredFiles: 280,
        missingCoverageFiles: 22,
        staleCoverageFiles: 0,
        files: [
          {
            filePath: path.join(tmpDir, "app/Domain/Foo.php"),
            lineCoveragePercent: 85.5,
            coveredLines: 120,
            uncoveredLines: 20,
            uncoverableLines: 5,
          },
        ],
      };

      writeCoverageCache(tmpDir, payload);

      const cachePath = path.join(tmpDir, ".eyecov", "coverage-cache.json");
      expect(fs.existsSync(cachePath)).toBe(true);
      const raw = fs.readFileSync(cachePath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.version).toBe(2);
      expect(parsed.workspaceRoot).toBe(tmpDir);
      expect(parsed.generatedAt).toBeDefined();
      expect(typeof parsed.generatedAt).toBe("string");
      expect(parsed.detectedFormat).toBe("phpunit-html");
      expect(parsed.aggregateCoveragePercent).toBe(81.1);
      expect(parsed.files).toHaveLength(1);
      expect(parsed.files[0].filePath).toBe(
        path.join(tmpDir, "app/Domain/Foo.php"),
      );
      expect(parsed.files[0].lineCoveragePercent).toBe(85.5);
      expect(parsed.files[0].coveredLines).toBe(120);
      expect(parsed.files[0].uncoveredLines).toBe(20);
      expect(parsed.files[0].uncoverableLines).toBe(5);
    });

    it("preserves the existing cache when atomic finalization fails", () => {
      const initialPayload = {
        workspaceRoot: tmpDir,
        detectedFormat: "phpunit-html",
        aggregateCoveragePercent: 81.1,
        totalFiles: 320,
        coveredFiles: 280,
        missingCoverageFiles: 22,
        staleCoverageFiles: 0,
        files: [],
      };
      writeCoverageCache(tmpDir, initialPayload);

      const renameSpy = vi
        .spyOn(fs, "renameSync")
        .mockImplementation((): never => {
          throw new Error("rename failed");
        });

      expect(() =>
        writeCoverageCache(tmpDir, {
          ...initialPayload,
          detectedFormat: "lcov",
          aggregateCoveragePercent: 50,
        }),
      ).toThrow("rename failed");

      renameSpy.mockRestore();

      const cache = readCoverageCache(tmpDir);
      expect(cache).not.toBeNull();
      expect(cache!.detectedFormat).toBe("phpunit-html");
      expect(cache!.aggregateCoveragePercent).toBe(81.1);
      expect(
        fs
          .readdirSync(path.join(tmpDir, ".eyecov"))
          .filter((entry) => entry.includes(".tmp")),
      ).toEqual([]);
    });
  });

  describe("readCoverageCache", () => {
    it("returns parsed cache when file exists and is valid", () => {
      const payload = {
        workspaceRoot: tmpDir,
        detectedFormat: "lcov",
        aggregateCoveragePercent: 90,
        totalFiles: 10,
        coveredFiles: 9,
        missingCoverageFiles: 1,
        staleCoverageFiles: 0,
        files: [
          {
            filePath: path.join(tmpDir, "src/bar.ts"),
            lineCoveragePercent: 100,
            coveredLines: 5,
            uncoveredLines: 0,
            uncoverableLines: 0,
          },
        ],
      };
      writeCoverageCache(tmpDir, payload);

      const result = readCoverageCache(tmpDir);

      expect(result).not.toBeNull();
      expect(result!.version).toBe(2);
      expect(result!.workspaceRoot).toBe(tmpDir);
      expect(result!.detectedFormat).toBe("lcov");
      expect(result!.aggregateCoveragePercent).toBe(90);
      expect(result!.files).toHaveLength(1);
      expect(result!.files[0].filePath).toBe(path.join(tmpDir, "src/bar.ts"));
    });

    it("returns null when cache file does not exist", () => {
      const result = readCoverageCache(tmpDir);
      expect(result).toBeNull();
    });

    it("returns null when cache file is malformed JSON", () => {
      const dir = path.join(tmpDir, ".eyecov");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "coverage-cache.json"),
        "not json",
        "utf-8",
      );

      const result = readCoverageCache(tmpDir);
      expect(result).toBeNull();
    });

    it("returns null when cache has wrong version or missing required fields", () => {
      const dir = path.join(tmpDir, ".eyecov");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "coverage-cache.json"),
        JSON.stringify({ version: 99 }),
        "utf-8",
      );

      const result = readCoverageCache(tmpDir);
      expect(result).toBeNull();
    });
  });

  describe("buildCoverageCachePayload", () => {
    it("builds payload from workspaceRoot, detectedFormat, and CoverageRecords with aggregate fields", () => {
      const workspaceRoot = "/project";
      const records: CoverageRecord[] = [
        {
          sourcePath: "/project/app/Foo.php",
          coveredLines: new Set([1, 2, 3]),
          uncoveredLines: new Set([4]),
          uncoverableLines: new Set([5]),
          lineCoveragePercent: 75,
        },
        {
          sourcePath: "/project/app/Bar.php",
          coveredLines: new Set([1, 2]),
          uncoveredLines: new Set([]),
          uncoverableLines: new Set([]),
          lineCoveragePercent: 100,
        },
      ];
      const pathCount = 3; // one path had no coverage

      const payload = buildCoverageCachePayload({
        workspaceRoot,
        detectedFormat: "phpunit-html",
        records,
        totalPathCount: pathCount,
      });

      expect(payload.workspaceRoot).toBe(workspaceRoot);
      expect(payload.detectedFormat).toBe("phpunit-html");
      expect(payload.totalFiles).toBe(pathCount);
      expect(payload.coveredFiles).toBe(2);
      expect(payload.missingCoverageFiles).toBe(1);
      expect(payload.staleCoverageFiles).toBe(0);
      expect(payload.aggregateCoveragePercent).toBe(83.33); // 5 covered / 6 executable
      expect(payload.files).toHaveLength(2);
      expect(payload.files[0].filePath).toBe("/project/app/Foo.php");
      expect(payload.files[0].lineCoveragePercent).toBe(75);
      expect(payload.files[0].coveredLines).toBe(3);
      expect(payload.files[0].uncoveredLines).toBe(1);
      expect(payload.files[0].uncoverableLines).toBe(1);
      expect(payload.files[1].filePath).toBe("/project/app/Bar.php");
      expect(payload.files[1].lineCoveragePercent).toBe(100);
      expect(payload.files[1].coveredLines).toBe(2);
      expect(payload.files[1].uncoveredLines).toBe(0);
      expect(payload.files[1].uncoverableLines).toBe(0);
    });

    it("returns null aggregate percent and zero counts when records is empty", () => {
      const payload = buildCoverageCachePayload({
        workspaceRoot: "/project",
        detectedFormat: "lcov",
        records: [],
        totalPathCount: 0,
      });

      expect(payload.aggregateCoveragePercent).toBeNull();
      expect(payload.totalFiles).toBe(0);
      expect(payload.coveredFiles).toBe(0);
      expect(payload.missingCoverageFiles).toBe(0);
      expect(payload.files).toEqual([]);
    });

    it("sets missingPaths to paths that have no record when paths array is provided", () => {
      const workspaceRoot = "/project";
      const allPaths = [
        "/project/app/Foo.php",
        "/project/app/Bar.php",
        "/project/app/Missing.php",
      ];
      const records: CoverageRecord[] = [
        {
          sourcePath: "/project/app/Foo.php",
          coveredLines: new Set([1]),
          uncoveredLines: new Set([]),
          uncoverableLines: new Set([]),
          lineCoveragePercent: 100,
        },
        {
          sourcePath: "/project/app/Bar.php",
          coveredLines: new Set([1, 2]),
          uncoveredLines: new Set([]),
          uncoverableLines: new Set([]),
          lineCoveragePercent: 100,
        },
      ];

      const payload = buildCoverageCachePayload({
        workspaceRoot,
        detectedFormat: "phpunit-html",
        records,
        totalPathCount: allPaths.length,
        paths: allPaths,
      });

      expect(payload.missingPaths).toEqual(["/project/app/Missing.php"]);
    });
  });

  describe("deleteCoverageCache", () => {
    it("removes cache file when it exists", () => {
      writeCoverageCache(tmpDir, {
        workspaceRoot: tmpDir,
        detectedFormat: "phpunit-html",
        aggregateCoveragePercent: 50,
        totalFiles: 1,
        coveredFiles: 1,
        missingCoverageFiles: 0,
        staleCoverageFiles: 0,
        files: [],
      });
      expect(readCoverageCache(tmpDir)).not.toBeNull();

      deleteCoverageCache(tmpDir);

      expect(readCoverageCache(tmpDir)).toBeNull();
    });

    it("is a no-op when cache file does not exist", () => {
      expect(() => deleteCoverageCache(tmpDir)).not.toThrow();
    });
  });
});

vitestAfterEach(() => {
  vi.restoreAllMocks();
});
