import type { ReportCliOutput } from "./types";

export function renderJsonReport(output: ReportCliOutput): string {
  return JSON.stringify(output, null, 2);
}
