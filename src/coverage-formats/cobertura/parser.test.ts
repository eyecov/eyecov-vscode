import { describe, expect, it } from "vitest";
import { parseCoberturaXml } from "./parser";

const VALID_COBERTURA_XML = `
<?xml version="1.0" encoding="UTF-8"?>
<coverage line-rate="0.5" branch-rate="0" version="1.0">
  <sources>
    <source>/workspace/project</source>
    <source>/workspace/project</source>
  </sources>
  <packages>
    <package name="app" line-rate="0.5">
      <classes>
        <class name="Example" filename="src/Example.ts" line-rate="0.5">
          <lines>
            <line number="1" hits="1"/>
            <line number="2" hits="0"/>
            <line number="2" hits="0"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>
`;

describe("parseCoberturaXml", () => {
  it("parses valid Cobertura XML into source roots and file line coverage", () => {
    const result = parseCoberturaXml(VALID_COBERTURA_XML);

    expect(result.sourceRoots).toEqual(["/workspace/project"]);
    expect(result.files).toEqual([
      {
        sourcePath: "src/Example.ts",
        coveredLines: [1],
        uncoveredLines: [2],
        lineCoveragePercent: 50,
      },
    ]);
    expect(result.totals).toEqual({
      coveredLines: null,
      executableLines: null,
      aggregateCoveragePercent: 50,
    });
  });

  it("returns an empty result for malformed XML", () => {
    expect(() => parseCoberturaXml("<coverage><broken")).not.toThrow();
    expect(parseCoberturaXml("<coverage><broken")).toEqual({
      sourceRoots: [],
      files: [],
      totals: {
        coveredLines: null,
        executableLines: null,
        aggregateCoveragePercent: null,
      },
    });
  });
});
