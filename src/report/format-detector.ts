import fs from "node:fs";
import path from "node:path";
import type { CoverageFormatType } from "../coverage-config";

export function detectCoverageFormat(
  artifactPath: string,
): CoverageFormatType | null {
  if (!fs.existsSync(artifactPath)) {
    return null;
  }

  const stat = fs.statSync(artifactPath);
  if (stat.isDirectory()) {
    return "phpunit-html";
  }

  if (path.extname(artifactPath).toLowerCase() === ".info") {
    return "lcov";
  }

  const content = fs.readFileSync(artifactPath, "utf8");
  const trimmed = content.trim();
  if (trimmed.startsWith("mode:")) {
    return "go-coverprofile";
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (
        parsed.meta &&
        parsed.files &&
        typeof parsed.meta === "object" &&
        typeof parsed.files === "object"
      ) {
        return "coveragepy-json";
      }
      if (
        Object.values(parsed).some(
          (value) =>
            value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            ("statementMap" in value || "fnMap" in value),
        )
      ) {
        return "istanbul-json";
      }
    } catch {
      return null;
    }
    return null;
  }

  if (!trimmed.startsWith("<") && !trimmed.startsWith("<?xml")) {
    return null;
  }

  if (/<project\b/i.test(content)) {
    return "clover";
  }

  if (/<CoverageSession\b/i.test(content)) {
    return "opencover";
  }

  if (/<report\b/i.test(content) && /<sourcefile\b/i.test(content)) {
    return "jacoco";
  }

  if (/<coverage\b/i.test(content)) {
    return "cobertura";
  }

  return null;
}
