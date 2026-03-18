import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
