import path from "node:path";
import { describe, expect, it } from "vitest";
import { runReportCli } from "./cli-main";

function createWriter(): {
  stream: { isTTY: boolean; write: (chunk: string) => boolean };
  read(): string;
} {
  let output = "";
  return {
    stream: {
      isTTY: false,
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

const samplesRoot = path.resolve(__dirname, "../../coverage-samples");

const sampleCases = [
  {
    format: "phpunit-html",
    artifactPath: path.join(
      samplesRoot,
      "phpunit-html",
      "docs-derived",
      "coverage-html",
    ),
    workspaceRoot: path.join(samplesRoot, "phpunit-html", "docs-derived"),
    verifyTotals: true,
  },
  {
    format: "cobertura",
    artifactPath: path.join(
      samplesRoot,
      "cobertura",
      "docs-derived",
      "cobertura.xml",
    ),
    workspaceRoot: path.join(samplesRoot, "cobertura", "docs-derived"),
    verifyTotals: true,
  },
  {
    format: "clover",
    artifactPath: path.join(
      samplesRoot,
      "clover",
      "docs-derived",
      "clover.xml",
    ),
    workspaceRoot: path.join(samplesRoot, "clover", "docs-derived"),
    verifyTotals: true,
  },
  {
    format: "lcov",
    artifactPath: path.join(samplesRoot, "lcov", "docs-derived", "lcov.info"),
    workspaceRoot: path.join(samplesRoot, "lcov", "docs-derived"),
    verifyTotals: true,
  },
  {
    format: "istanbul-json",
    artifactPath: path.join(
      samplesRoot,
      "istanbul-json",
      "docs-derived",
      "coverage-final.json",
    ),
    workspaceRoot: path.join(samplesRoot, "istanbul-json", "docs-derived"),
    verifyTotals: false,
  },
  {
    format: "jacoco",
    artifactPath: path.join(
      samplesRoot,
      "jacoco",
      "docs-derived",
      "jacoco.xml",
    ),
    workspaceRoot: path.join(samplesRoot, "jacoco", "docs-derived"),
    verifyTotals: true,
  },
  {
    format: "go-coverprofile",
    artifactPath: path.join(
      samplesRoot,
      "go-coverprofile",
      "docs-derived",
      "coverage.out",
    ),
    workspaceRoot: path.join(samplesRoot, "go-coverprofile", "docs-derived"),
    verifyTotals: true,
  },
  {
    format: "coveragepy-json",
    artifactPath: path.join(
      samplesRoot,
      "coveragepy-json",
      "docs-derived",
      "coverage.json",
    ),
    workspaceRoot: path.join(samplesRoot, "coveragepy-json", "docs-derived"),
    verifyTotals: true,
  },
  {
    format: "opencover",
    artifactPath: path.join(
      samplesRoot,
      "opencover",
      "localized-sample",
      "coverage.opencover.xml",
    ),
    workspaceRoot: path.join(samplesRoot, "opencover", "localized-sample"),
    verifyTotals: true,
  },
] as const;

describe("report CLI sample artifacts", () => {
  for (const sample of sampleCases) {
    it(`parses the ${sample.format} sample bundle`, async () => {
      const stdout = createWriter();
      const stderr = createWriter();
      const args = [
        "--path",
        sample.artifactPath,
        "--workspace-root",
        sample.workspaceRoot,
        "--json",
      ];

      if (sample.verifyTotals) {
        args.push("--verify-report-totals");
      }

      const exitCode = await runReportCli({
        args,
        stdout: stdout.stream,
        stderr: stderr.stream,
      });

      expect(exitCode).toBe(0);
      expect(stderr.read()).toBe("");

      const parsed = JSON.parse(stdout.read()) as {
        format: string;
        filesDiscovered: number;
        warnings: string[];
        verification: {
          supported: boolean;
          matches: boolean | null;
        };
      };

      expect(parsed.format).toBe(sample.format);
      expect(parsed.filesDiscovered).toBeGreaterThan(0);
      expect(
        parsed.warnings.find((warning) =>
          warning.toLowerCase().includes("unresolved"),
        ),
      ).toBeUndefined();

      if (sample.verifyTotals) {
        expect(parsed.verification.supported).toBe(true);
        expect(parsed.verification.matches).toBe(true);
      } else {
        expect(parsed.verification.supported).toBe(false);
      }
    });
  }
});
