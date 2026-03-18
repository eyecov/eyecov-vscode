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
  if (!trimmed.startsWith("<") && !trimmed.startsWith("<?xml")) {
    return null;
  }

  if (/<project\b/i.test(content)) {
    return "clover";
  }

  if (/<coverage\b/i.test(content)) {
    return "cobertura";
  }

  return null;
}
