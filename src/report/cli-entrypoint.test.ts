import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CoverageDiffResult } from "../coverage-diff";
import { runReportCli } from "./cli-main";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eyecov-report-cli-"));
  tempDirs.push(dir);
  return dir;
}

function createWriter(isTTY = false): {
  stream: { isTTY: boolean; write: (chunk: string) => boolean };
  read(): string;
} {
  let output = "";
  return {
    stream: {
      isTTY,
      write(chunk: string): boolean {
        output += chunk;
        return true;
      },
    },
    read(): string {
      return output;
    },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("runReportCli", () => {
  it("runs coverage diff in json mode without requiring --path", async () => {
    const stdout = createWriter();
    const stderr = createWriter();
    const diffResult: CoverageDiffResult = {
      baseRef: "main",
      headRef: "HEAD",
      comparisonMode: "merge-base",
      filesChanged: 1,
      filesResolved: 1,
      filesUncovered: 1,
      filesMissingCoverage: 0,
      filesStale: 0,
      changedExecutableLines: 2,
      changedCoveredLines: 1,
      changedUncoveredLines: 1,
      changedUncoverableLines: 0,
      items: [
        {
          filePath: "src/foo.ts",
          status: "uncovered",
          changedLineRanges: [[10, 12]],
          coveredLines: [10],
          uncoveredLines: [11],
          uncoverableLines: [],
          nonExecutableChangedLines: [],
          uncoveredRegions: [],
          lineCoveragePercent: 50,
        },
      ],
    };

    const exitCode = await runReportCli({
      args: ["--diff", "main", "--json"],
      stdout: stdout.stream,
      stderr: stderr.stream,
      getCoverageDiffImpl: async () => diffResult,
    });

    expect(exitCode).toBe(0);
    expect(stderr.read()).toBe("");
    expect(JSON.parse(stdout.read())).toMatchObject(diffResult);
  });

  it("renders human coverage diff output", async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runReportCli({
      args: ["--diff", "main"],
      stdout: stdout.stream,
      stderr: stderr.stream,
      getCoverageDiffImpl: async () => ({
        baseRef: "main",
        headRef: "HEAD",
        comparisonMode: "merge-base",
        filesChanged: 3,
        filesResolved: 1,
        filesUncovered: 1,
        filesMissingCoverage: 1,
        filesStale: 1,
        changedExecutableLines: 2,
        changedCoveredLines: 1,
        changedUncoveredLines: 1,
        changedUncoverableLines: 0,
        items: [
          {
            filePath: "src/foo.ts",
            status: "uncovered",
            changedLineRanges: [[10, 12]],
            coveredLines: [10],
            uncoveredLines: [11],
            uncoverableLines: [],
            nonExecutableChangedLines: [],
            uncoveredRegions: [],
            lineCoveragePercent: 50,
          },
          {
            filePath: "src/bar.ts",
            status: "missing",
            reason: "No configured coverage source resolved this file.",
          },
          {
            filePath: "src/baz.ts",
            status: "stale",
            reason: "Coverage artifact is older than the source file.",
          },
        ],
      }),
    });

    expect(exitCode).toBe(0);
    expect(stderr.read()).toBe("");
    expect(stdout.read()).toContain(
      "Coverage diff against merge-base(main..HEAD)",
    );
    expect(stdout.read()).toContain("3 changed files");
    expect(stdout.read()).toContain("src/foo.ts");
    expect(stdout.read()).toContain("uncovered changed lines: 11");
    expect(stdout.read()).toContain("src/bar.ts");
    expect(stdout.read()).toContain("missing coverage");
  });

  it("returns 3 when --path is missing", async () => {
    const stderr = createWriter();

    const exitCode = await runReportCli({
      args: [],
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(3);
    expect(stderr.read()).toContain("Missing required --path");
  });

  it("accepts the newly supported --format values", async () => {
    const tempDir = createTempDir();
    const artifactPath = path.join(tempDir, "coverage.json");
    fs.writeFileSync(artifactPath, "{}");
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runReportCli({
      args: ["--path", artifactPath, "--format", "istanbul-json"],
      stdout: stdout.stream,
      stderr: stderr.stream,
      loadCoverageArtifactImpl: async () => {
        throw new Error("not found");
      },
      detectCoverageFormatImpl: () => "istanbul-json",
    });

    expect(exitCode).toBe(1);
    expect(stderr.read()).not.toContain("Invalid --format");
  });

  it("loads an artifact and prints JSON output", async () => {
    const tempDir = createTempDir();
    const workspaceRoot = path.join(tempDir, "workspace");
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src", "foo.ts"), "export {};\n");
    fs.writeFileSync(
      path.join(workspaceRoot, "coverage.info"),
      ["TN:", "SF:src/foo.ts", "DA:1,1", "DA:2,0", "end_of_record"].join("\n"),
    );
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runReportCli({
      args: [
        "--path",
        path.join(workspaceRoot, "coverage.info"),
        "--workspace-root",
        workspaceRoot,
        "--json",
      ],
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(0);
    expect(stderr.read()).toBe("");
    expect(JSON.parse(stdout.read())).toMatchObject({
      format: "lcov",
      filesDiscovered: 1,
      totals: {
        coveredLines: 1,
        uncoveredLines: 1,
        executableLines: 2,
        aggregateCoveragePercent: 50,
      },
    });
  });

  it("returns 3 when --sample-files has trailing non-numeric characters", async () => {
    const stderr = createWriter();

    const exitCode = await runReportCli({
      args: ["--path", "/nonexistent.xml", "--sample-files", "10abc"],
      stderr: stderr.stream,
    });

    expect(exitCode).toBe(3);
    expect(stderr.read()).toContain("sample-files");
  });

  it("returns 2 when verification mismatches", async () => {
    const tempDir = createTempDir();
    const workspaceRoot = path.join(tempDir, "workspace");
    fs.mkdirSync(path.join(workspaceRoot, "app"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "coverage-html"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(workspaceRoot, "app", "foo.ts"), "<?php\n");
    fs.writeFileSync(
      path.join(workspaceRoot, "coverage-html", "foo.ts.html"),
      '<table id="code"><tr class="success d-flex"><td><a id="1" href="#1">1</a></td></tr><tr class="danger d-flex"><td><a id="2" href="#2">2</a></td></tr></table>',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "coverage-html", "index.html"),
      "<table><tr><td>Total</td><td>2 / 2</td><td>100%</td></tr></table>",
    );
    const stdout = createWriter();

    const exitCode = await runReportCli({
      args: [
        "--path",
        path.join(workspaceRoot, "coverage-html"),
        "--workspace-root",
        workspaceRoot,
        "--format",
        "phpunit-html",
        "--verify-report-totals",
      ],
      stdout: stdout.stream,
      stderr: createWriter().stream,
    });

    expect(exitCode).toBe(2);
    expect(stdout.read()).toContain("Verification");
  });

  it("returns 1 when artifact loading throws at runtime", async () => {
    const tempDir = createTempDir();
    const artifactPath = path.join(tempDir, "coverage.xml");
    fs.writeFileSync(artifactPath, "<coverage></coverage>");
    const stderr = createWriter();

    const exitCode = await runReportCli({
      args: ["--path", artifactPath, "--format", "cobertura"],
      stderr: stderr.stream,
      detectCoverageFormatImpl: () => "cobertura",
      loadCoverageArtifactImpl: async () => {
        throw new Error("boom");
      },
    });

    expect(exitCode).toBe(1);
    expect(stderr.read()).toContain("boom");
  });
});
