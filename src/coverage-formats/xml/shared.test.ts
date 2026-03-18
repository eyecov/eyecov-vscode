import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  getSharedArtifactPaths,
  lineCoveragePercent,
  lineTestsNotSupportedMessage,
  normalizeLineCoverage,
  resolveCoverageSourcePath,
} from "./shared";

describe("coverage-formats/xml/shared", () => {
  it("returns one artifact path per workspace root", () => {
    expect(
      getSharedArtifactPaths(
        ["/workspace/a", "/workspace/b"],
        "coverage/cobertura.xml",
      ),
    ).toEqual([
      path.resolve("/workspace/a", "coverage/cobertura.xml"),
      path.resolve("/workspace/b", "coverage/cobertura.xml"),
    ]);
  });

  it("resolves relative source paths under the workspace root", () => {
    expect(resolveCoverageSourcePath("/workspace", "src/Foo.ts")).toBe(
      path.resolve("/workspace", "src/Foo.ts"),
    );
  });

  it("preserves absolute source paths", () => {
    expect(resolveCoverageSourcePath("/workspace", "/tmp/Foo.ts")).toBe(
      path.normalize("/tmp/Foo.ts"),
    );
  });

  it("normalizes duplicate and overlapping line coverage", () => {
    expect(
      normalizeLineCoverage({
        coveredLines: [3, 1, 3, 2],
        uncoveredLines: [5, 2, 0, -1, 5, 4],
      }),
    ).toEqual({
      coveredLines: [1, 2, 3],
      uncoveredLines: [4, 5],
      lineCoveragePercent: 60,
    });
  });

  it("returns null percent when there are no executable lines", () => {
    expect(lineCoveragePercent(0, 0)).toBeNull();
  });

  it("builds a capability-based line-tests message", () => {
    expect(lineTestsNotSupportedMessage("Cobertura")).toBe(
      "Covering tests not supported for the Cobertura coverage format.",
    );
  });
});
