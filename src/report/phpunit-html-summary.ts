import fs from "node:fs";
import path from "node:path";
import type { ReportTotalsMetadata } from "./artifact-loader";

function stripTags(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTotalRow(html: string): string | null {
  const pattern =
    /<tr\b[^>]*>[\s\S]*?<(?:td|th)[^>]*>\s*Total\s*<\/(?:td|th)>[\s\S]*?<\/tr>/gi;
  let last: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    last = match[0];
  }
  return last;
}

export function readPhpUnitHtmlSummary(
  coverageHtmlDir: string,
): ReportTotalsMetadata | null {
  const indexPath = path.join(coverageHtmlDir, "index.html");
  if (!fs.existsSync(indexPath)) {
    return null;
  }

  const totalRow = extractTotalRow(fs.readFileSync(indexPath, "utf8"));
  if (!totalRow) {
    return null;
  }

  const ratioMatch = stripTags(totalRow).match(/(\d+)\s*\/\s*(\d+)/);
  if (!ratioMatch) {
    return null;
  }

  const coveredLines = Number.parseInt(ratioMatch[1] ?? "", 10);
  const executableLines = Number.parseInt(ratioMatch[2] ?? "", 10);
  const ariaPercent = totalRow.match(/aria-valuenow=["']([\d.]+)["']/i)?.[1];
  const textPercent = stripTags(totalRow).match(/(\d+(?:\.\d+)?)%/)?.[1];
  const percent = Number.parseFloat(ariaPercent ?? textPercent ?? "");

  if (
    !Number.isInteger(coveredLines) ||
    !Number.isInteger(executableLines) ||
    !Number.isFinite(percent)
  ) {
    return null;
  }

  return {
    coveredLines,
    executableLines,
    aggregateCoveragePercent: Number(percent.toFixed(2)),
  };
}
