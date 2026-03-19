import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { prewarmCoverageForRoot } from "./coverage-prewarm";
import { readCoverageCache } from "./coverage-cache";
import type { CoverageRecord } from "./coverage-resolver";
import type { CoverageConfig } from "./coverage-config";

describe("coverage-prewarm", () => {
  let tmpDir: string;
  const BATCH_SIZE = 2;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `eyecov-prewarm-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      // ignore
    }
  });

  it("writes valid cache after listing paths and resolving coverage in batches", async () => {
    const pathA = path.join(tmpDir, "app/A.php");
    const pathB = path.join(tmpDir, "app/B.php");
    const pathC = path.join(tmpDir, "app/C.php");
    const _config: CoverageConfig = {
      formats: [
        { type: "phpunit-html", path: path.join(tmpDir, "coverage-html") },
      ],
    };
    const recordA: CoverageRecord = {
      sourcePath: pathA,
      coveredLines: new Set([1, 2]),
      uncoveredLines: new Set([3]),
      uncoverableLines: new Set([]),
      lineCoveragePercent: 66.67,
    };
    const recordB: CoverageRecord = {
      sourcePath: pathB,
      coveredLines: new Set([1]),
      uncoveredLines: new Set([]),
      uncoverableLines: new Set([]),
      lineCoveragePercent: 100,
    };
    const listPaths = () => ({
      paths: [pathA, pathB, pathC],
      formatType: "phpunit-html" as const,
    });
    const getCoverage = async (p: string): Promise<CoverageRecord | null> => {
      if (p === pathA) return recordA;
      if (p === pathB) return recordB;
      return null;
    };

    await prewarmCoverageForRoot(tmpDir, {
      listPaths,
      getCoverage,
      batchSize: BATCH_SIZE,
    });

    const cache = readCoverageCache(tmpDir);
    expect(cache).not.toBeNull();
    expect(cache!.totalFiles).toBe(3);
    expect(cache!.coveredFiles).toBe(2);
    expect(cache!.missingCoverageFiles).toBe(1);
    expect(cache!.files).toHaveLength(2);
    expect(cache!.detectedFormat).toBe("phpunit-html");
  });

  it("does not write cache when signal is aborted before completion", async () => {
    const pathA = path.join(tmpDir, "app/A.php");
    const _config: CoverageConfig = {
      formats: [
        { type: "phpunit-html", path: path.join(tmpDir, "coverage-html") },
      ],
    };
    const listPaths = () => ({
      paths: [pathA],
      formatType: "phpunit-html" as const,
    });
    const getCoverage = async (): Promise<CoverageRecord | null> => {
      await new Promise((r) => setTimeout(r, 100));
      return null;
    };
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    await prewarmCoverageForRoot(tmpDir, {
      listPaths,
      getCoverage,
      signal: controller.signal,
      batchSize: 1,
    });

    const cache = readCoverageCache(tmpDir);
    expect(cache).toBeNull();
  });

  it("skips indexing when fingerprints match the existing cache", async () => {
    const artifactPath = path.join(tmpDir, "coverage/lcov.info");
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, "dummy-lcov");
    const sourcePath = path.join(tmpDir, "src/index.ts");
    const _config: CoverageConfig = {
      formats: [{ type: "lcov", path: "coverage/lcov.info" }],
    };
    const listPaths = () => ({
      paths: [sourcePath],
      formatType: "lcov" as const,
    });
    let getCoverageCalls = 0;
    const getCoverage = async (p: string): Promise<CoverageRecord | null> => {
      getCoverageCalls++;
      return {
        sourcePath: p,
        coveredLines: new Set([1]),
        uncoveredLines: new Set([]),
        uncoverableLines: new Set([]),
        lineCoveragePercent: 100,
      };
    };

    // First prewarm - should index
    await prewarmCoverageForRoot(tmpDir, {
      listPaths,
      getCoverage,
      artifactPaths: [artifactPath],
    });
    expect(getCoverageCalls).toBe(1);
    const cache1 = readCoverageCache(tmpDir);
    expect(cache1).not.toBeNull();
    expect(cache1!.globalFingerprint).not.toBeUndefined();
    expect(cache1!.globalFingerprint![artifactPath]).not.toBeUndefined();

    // Second prewarm - should skip
    await prewarmCoverageForRoot(tmpDir, {
      listPaths,
      getCoverage,
      artifactPaths: [artifactPath],
    });
    expect(getCoverageCalls).toBe(1); // No more calls

    // Update artifact - should re-index
    const now = Date.now() / 1000;
    fs.utimesSync(artifactPath, now + 10, now + 10);
    await prewarmCoverageForRoot(tmpDir, {
      listPaths,
      getCoverage,
      artifactPaths: [artifactPath],
    });
    expect(getCoverageCalls).toBe(2);
  });
});
