import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPhpUnitHtmlSummary } from "./phpunit-html-summary";

const tempDirs: string[] = [];

function createCoverageHtmlDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eyecov-report-summary-"));
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

describe("readPhpUnitHtmlSummary", () => {
  it("parses the Total row from a root index.html", () => {
    const coverageDir = createCoverageHtmlDir();
    fs.writeFileSync(
      path.join(coverageDir, "index.html"),
      [
        "<table>",
        '<tr><td>Total</td><td>8 / 10</td><td><div aria-valuenow="80"></div></td></tr>',
        "</table>",
      ].join(""),
    );

    expect(readPhpUnitHtmlSummary(coverageDir)).toEqual({
      coveredLines: 8,
      executableLines: 10,
      aggregateCoveragePercent: 80,
    });
  });

  it("supports percent extraction from cell text when aria-valuenow is absent", () => {
    const coverageDir = createCoverageHtmlDir();
    fs.writeFileSync(
      path.join(coverageDir, "index.html"),
      "<table><tr><td>Total</td><td>3 / 4</td><td>75.00%</td></tr></table>",
    );

    expect(readPhpUnitHtmlSummary(coverageDir)).toEqual({
      coveredLines: 3,
      executableLines: 4,
      aggregateCoveragePercent: 75,
    });
  });

  it("parses the real PHPUnit 12 total row shape with percent before the ratio", () => {
    const coverageDir = createCoverageHtmlDir();
    fs.writeFileSync(
      path.join(coverageDir, "index.html"),
      [
        '<table class="table table-bordered"><tbody>',
        '<tr><td class="warning">Total</td>',
        '<td class="warning big"><div class="progress"><div aria-valuenow="68.02"></div></div></td>',
        '<td class="warning small"><div align="right">68.02%</div></td>',
        '<td class="warning small"><div align="right">13256&nbsp;/&nbsp;19489</div></td>',
        "</tr></tbody></table>",
      ].join(""),
    );

    expect(readPhpUnitHtmlSummary(coverageDir)).toEqual({
      coveredLines: 13256,
      executableLines: 19489,
      aggregateCoveragePercent: 68.02,
    });
  });

  it("picks the summary Total row when another row also contains exactly 'Total' as its cell text", () => {
    const coverageDir = createCoverageHtmlDir();
    fs.writeFileSync(
      path.join(coverageDir, "index.html"),
      [
        "<table>",
        "<tr><td>Total</td><td>2 / 5</td><td>40%</td></tr>",
        "<tr><td>Total</td><td>8 / 10</td><td>80%</td></tr>",
        "</table>",
      ].join(""),
    );

    expect(readPhpUnitHtmlSummary(coverageDir)).toEqual({
      coveredLines: 8,
      executableLines: 10,
      aggregateCoveragePercent: 80,
    });
  });

  it("returns null for malformed or missing root summary input", () => {
    const coverageDir = createCoverageHtmlDir();
    fs.writeFileSync(path.join(coverageDir, "index.html"), "<html></html>");

    expect(readPhpUnitHtmlSummary(coverageDir)).toBeNull();
    expect(
      readPhpUnitHtmlSummary(path.join(coverageDir, "missing")),
    ).toBeNull();
  });
});
