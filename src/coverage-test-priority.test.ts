import { describe, it, expect } from "vitest";
import { computeTestPriorityItems } from "./coverage-test-priority";

describe("coverage-test-priority", () => {
  describe("computeTestPriorityItems", () => {
    it('returns missing paths as top priority with score 100 and reason "no coverage"', () => {
      const result = computeTestPriorityItems({
        filesWithCoverage: [],
        missingPaths: ["app/Domain/SomeNewFile.php", "app/Other/Missing.php"],
        limit: 20,
        fromCache: false,
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        filePath: "app/Domain/SomeNewFile.php",
        priorityScore: 100,
        lineCoveragePercent: null,
        uncoveredLines: 0,
        reasons: ["no coverage"],
      });
      expect(result[1]).toEqual({
        filePath: "app/Other/Missing.php",
        priorityScore: 100,
        lineCoveragePercent: null,
        uncoveredLines: 0,
        reasons: ["no coverage"],
      });
    });

    it("scores files with coverage by low percent and high uncovered count with explainable reasons", () => {
      const result = computeTestPriorityItems({
        filesWithCoverage: [
          {
            filePath: "app/Domain/Automation/Foo.php",
            lineCoveragePercent: 33.3,
            coveredLines: 24,
            uncoveredLines: 48,
            uncoverableLines: 0,
          },
          {
            filePath: "app/Domain/WellCovered.php",
            lineCoveragePercent: 90,
            coveredLines: 18,
            uncoveredLines: 2,
            uncoverableLines: 0,
          },
        ],
        missingPaths: [],
        limit: 20,
        fromCache: false,
      });

      expect(result).toHaveLength(2);
      expect(result[0].filePath).toBe("app/Domain/Automation/Foo.php");
      expect(result[0].priorityScore).toBeGreaterThan(result[1].priorityScore);
      expect(result[0].reasons).toContain("low coverage");
      expect(result[0].reasons).toContain("many uncovered lines");
      expect(result[0].lineCoveragePercent).toBe(33.3);
      expect(result[0].uncoveredLines).toBe(48);

      expect(result[1].filePath).toBe("app/Domain/WellCovered.php");
      expect(result[1].reasons).not.toContain("low coverage");
      expect(result[1].reasons).not.toContain("many uncovered lines");
    });

    it("puts missing paths first then files by score and respects limit", () => {
      const result = computeTestPriorityItems({
        filesWithCoverage: [
          {
            filePath: "app/Low.php",
            lineCoveragePercent: 20,
            coveredLines: 5,
            uncoveredLines: 20,
            uncoverableLines: 0,
          },
        ],
        missingPaths: ["app/NoCov.php"],
        limit: 2,
        fromCache: false,
      });

      expect(result).toHaveLength(2);
      expect(result[0].filePath).toBe("app/NoCov.php");
      expect(result[0].priorityScore).toBe(100);
      expect(result[1].filePath).toBe("app/Low.php");
    });

    it("when includeNoCoverage is false excludes missing paths from result", () => {
      const result = computeTestPriorityItems({
        filesWithCoverage: [
          {
            filePath: "app/HasCov.php",
            lineCoveragePercent: 50,
            coveredLines: 10,
            uncoveredLines: 10,
            uncoverableLines: 0,
          },
        ],
        missingPaths: ["app/NoCov.php"],
        limit: 20,
        fromCache: false,
        includeNoCoverage: false,
      });

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe("app/HasCov.php");
      expect(result.every((r) => r.filePath !== "app/NoCov.php")).toBe(true);
    });
  });
});
