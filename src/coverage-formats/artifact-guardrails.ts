import fs from "node:fs";

export const COVERAGE_ARTIFACT_LIMITS = {
  maxArtifactBytes: 5 * 1024 * 1024,
  maxGoCoverprofileLines: 100_000,
  maxIstanbulStatements: 10_000,
} as const;

export class CoverageArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverageArtifactError";
  }
}

export function readArtifactUtf8WithLimit(
  artifactPath: string,
  formatLabel: string,
): string {
  const stats = fs.statSync(artifactPath);
  if (stats.size > COVERAGE_ARTIFACT_LIMITS.maxArtifactBytes) {
    throw new CoverageArtifactError(
      `${formatLabel} artifact is too large (${stats.size} bytes). Maximum supported size is ${COVERAGE_ARTIFACT_LIMITS.maxArtifactBytes} bytes.`,
    );
  }

  return fs.readFileSync(artifactPath, "utf8");
}

export function toCoverageArtifactWarning(
  error: unknown,
  formatLabel: string,
): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${formatLabel} artifact could not be processed safely: ${message}`;
}
