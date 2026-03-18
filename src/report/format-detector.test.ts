import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectCoverageFormat } from "./format-detector";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eyecov-report-format-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("detectCoverageFormat", () => {
  it("detects a directory as phpunit-html", () => {
    const dir = createTempDir();

    expect(detectCoverageFormat(dir)).toBe("phpunit-html");
  });

  it("detects .info files as lcov", () => {
    const dir = createTempDir();
    const filePath = path.join(dir, "coverage.info");
    fs.writeFileSync(filePath, "TN:\n");

    expect(detectCoverageFormat(filePath)).toBe("lcov");
  });

  it("distinguishes Cobertura XML from Clover XML by root tag", () => {
    const dir = createTempDir();
    const coberturaPath = path.join(dir, "cobertura.xml");
    const cloverPath = path.join(dir, "clover.xml");

    fs.writeFileSync(coberturaPath, '<coverage lines-covered="1"></coverage>');
    fs.writeFileSync(
      cloverPath,
      '<?xml version="1.0"?><coverage generated="1"><project name="Clover Coverage"></project></coverage>',
    );

    expect(detectCoverageFormat(coberturaPath)).toBe("cobertura");
    expect(detectCoverageFormat(cloverPath)).toBe("clover");
  });

  it("detects go coverprofile, coverage.py JSON, and Istanbul JSON", () => {
    const dir = createTempDir();
    const goPath = path.join(dir, "coverage.out");
    const coveragePyPath = path.join(dir, "coverage.json");
    const istanbulPath = path.join(dir, "coverage-final.json");

    fs.writeFileSync(goPath, "mode: set\nsrc/foo.go:1.1,1.2 1 1\n");
    fs.writeFileSync(
      coveragePyPath,
      JSON.stringify({
        meta: { version: "7.0" },
        files: { "src/foo.py": { executed_lines: [1], missing_lines: [2] } },
      }),
    );
    fs.writeFileSync(
      istanbulPath,
      JSON.stringify({
        "src/foo.ts": {
          path: "src/foo.ts",
          statementMap: { "0": { start: { line: 1 } } },
          s: { "0": 1 },
        },
      }),
    );

    expect(detectCoverageFormat(goPath)).toBe("go-coverprofile");
    expect(detectCoverageFormat(coveragePyPath)).toBe("coveragepy-json");
    expect(detectCoverageFormat(istanbulPath)).toBe("istanbul-json");
  });

  it("detects JaCoCo and OpenCover XML", () => {
    const dir = createTempDir();
    const jacocoPath = path.join(dir, "jacoco.xml");
    const opencoverPath = path.join(dir, "opencover.xml");

    fs.writeFileSync(
      jacocoPath,
      '<report><package name="src"><sourcefile name="Foo.java" /></package></report>',
    );
    fs.writeFileSync(opencoverPath, "<CoverageSession></CoverageSession>");

    expect(detectCoverageFormat(jacocoPath)).toBe("jacoco");
    expect(detectCoverageFormat(opencoverPath)).toBe("opencover");
  });

  it("returns null for unknown input", () => {
    const dir = createTempDir();
    const filePath = path.join(dir, "report.txt");
    fs.writeFileSync(filePath, "not coverage");

    expect(detectCoverageFormat(filePath)).toBeNull();
  });
});
