import { describe, expect, it } from "vitest";
import { parseCloverCoverage } from "./parser";

describe("parseCloverCoverage", () => {
  it("parses file line coverage from Clover XML", () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<coverage generated="1" clover="1.0">',
      '<project timestamp="1">',
      '<file name="Foo.ts" path="src/Foo.ts">',
      '<line num="1" type="stmt" count="1"/>',
      '<line num="2" type="stmt" count="0"/>',
      "</file>",
      "</project>",
      "</coverage>",
    ].join("\n");

    expect(parseCloverCoverage(xml)).toEqual({
      files: [
        {
          sourcePath: "src/Foo.ts",
          coveredLines: [1],
          uncoveredLines: [2],
        },
      ],
      totals: {
        coveredLines: null,
        executableLines: null,
        aggregateCoveragePercent: null,
      },
    });
  });

  it("returns an empty list for malformed XML", () => {
    expect(parseCloverCoverage('<coverage><file path="src/Foo.ts">')).toEqual({
      files: [],
      totals: {
        coveredLines: null,
        executableLines: null,
        aggregateCoveragePercent: null,
      },
    });
  });

  it("parses Clover XML with single-quoted attributes", () => {
    const xml = [
      "<?xml version='1.0' encoding='UTF-8'?>",
      "<coverage generated='1' clover='1.0'>",
      "<project timestamp='1'>",
      "<file name='Foo.ts' path='src/Foo.ts'>",
      "<line num='1' type='stmt' count='1'/>",
      "<line num='2' type='stmt' count='0'/>",
      "</file>",
      "</project>",
      "</coverage>",
    ].join("\n");

    expect(parseCloverCoverage(xml)).toEqual({
      files: [
        {
          sourcePath: "src/Foo.ts",
          coveredLines: [1],
          uncoveredLines: [2],
        },
      ],
      totals: {
        coveredLines: null,
        executableLines: null,
        aggregateCoveragePercent: null,
      },
    });
  });

  it("ignores non-statement Clover line entries", () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<coverage generated="1">',
      '<project timestamp="1">',
      '<file name="src/Foo.ts">',
      '<line num="10" type="method" count="1"/>',
      '<line num="11" type="stmt" count="1"/>',
      '<line num="12" type="stmt" count="0"/>',
      "</file>",
      "</project>",
      "</coverage>",
    ].join("\n");

    expect(parseCloverCoverage(xml)).toEqual({
      files: [
        {
          sourcePath: "src/Foo.ts",
          coveredLines: [11],
          uncoveredLines: [12],
        },
      ],
      totals: {
        coveredLines: null,
        executableLines: null,
        aggregateCoveragePercent: null,
      },
    });
  });

  it("collects only real file nodes from Clover package/class trees", () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<coverage generated="1">',
      '<project timestamp="1" name="Clover Coverage">',
      '<package name="App\\Domain\\Example">',
      '<file name="/repo/app/Example.php">',
      '<class name="App\\Domain\\Example" namespace="App\\Domain">',
      '<metrics methods="1" coveredmethods="0" statements="2" coveredstatements="1"/>',
      "</class>",
      '<line num="10" type="method" name="__invoke" count="0"/>',
      '<line num="11" type="stmt" count="1"/>',
      '<line num="12" type="stmt" count="0"/>',
      '<metrics statements="2" coveredstatements="1"/>',
      "</file>",
      "</package>",
      '<metrics statements="2" coveredstatements="1"/>',
      "</project>",
      "</coverage>",
    ].join("\n");

    expect(parseCloverCoverage(xml)).toEqual({
      files: [
        {
          sourcePath: "/repo/app/Example.php",
          coveredLines: [11],
          uncoveredLines: [12],
        },
      ],
      totals: {
        coveredLines: 1,
        executableLines: 2,
        aggregateCoveragePercent: 50,
      },
    });
  });
});
