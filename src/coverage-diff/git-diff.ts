import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CoverageDiffOptions,
  GitDiffFile,
  GitDiffResult,
} from "./index";

const execFileAsync = promisify(execFile);

type NameStatusEntry = {
  repoRelativePath: string;
  diffStatus: GitDiffFile["diffStatus"];
  reason?: string;
};

function parseNameStatus(output: string): NameStatusEntry[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const status = parts[0] ?? "";
      if (status === "A") {
        return {
          repoRelativePath: parts[1] ?? "",
          diffStatus: "added" as const,
        };
      }
      if (status === "M") {
        return {
          repoRelativePath: parts[1] ?? "",
          diffStatus: "modified" as const,
        };
      }
      if (status.startsWith("R")) {
        return {
          repoRelativePath: parts[2] ?? "",
          diffStatus: "renamed" as const,
        };
      }
      return {
        repoRelativePath: parts[parts.length - 1] ?? "",
        diffStatus: "unsupported" as const,
        reason: "Unsupported diff shape.",
      };
    });
}

function parsePatchRanges(output: string): Map<string, Array<[number, number]>> {
  const rangesByPath = new Map<string, Array<[number, number]>>();
  let currentPath: string | null = null;

  for (const line of output.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentPath = line.slice("+++ b/".length);
      if (!rangesByPath.has(currentPath)) {
        rangesByPath.set(currentPath, []);
      }
      continue;
    }

    if (!currentPath || !line.startsWith("@@")) {
      continue;
    }

    const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) {
      continue;
    }

    const startLine = Number(match[1]);
    const lineCount = match[2] ? Number(match[2]) : 1;
    if (lineCount <= 0) {
      continue;
    }

    rangesByPath.get(currentPath)!.push([startLine, startLine + lineCount]);
  }

  return rangesByPath;
}

async function resolveComparisonRefs(
  workspaceRoot: string,
  options: CoverageDiffOptions,
): Promise<{ leftRef: string; baseRef: string; headRef: string }> {
  const headRef = options.head ?? "HEAD";
  if ((options.comparison ?? "merge-base") === "direct") {
    return {
      leftRef: options.base,
      baseRef: options.base,
      headRef,
    };
  }

  const mergeBase = await execFileAsync(
    "git",
    ["merge-base", options.base, headRef],
    { cwd: workspaceRoot },
  );
  const leftRef = mergeBase.stdout.trim();
  return {
    leftRef,
    baseRef: options.base,
    headRef,
  };
}

export async function getGitDiffForRoot(
  workspaceRoot: string,
  options: CoverageDiffOptions,
): Promise<GitDiffResult> {
  const comparisonMode = options.comparison ?? "merge-base";
  const { leftRef, baseRef, headRef } = await resolveComparisonRefs(
    workspaceRoot,
    options,
  );

  const nameStatusOutput = await execFileAsync(
    "git",
    ["diff", "--name-status", "--find-renames", leftRef, headRef, "--"],
    { cwd: workspaceRoot },
  );
  const patchOutput = await execFileAsync(
    "git",
    [
      "diff",
      "--unified=0",
      "--find-renames",
      "--diff-filter=AMR",
      "--no-ext-diff",
      "--no-color",
      leftRef,
      headRef,
      "--",
    ],
    { cwd: workspaceRoot },
  );

  const entries = parseNameStatus(nameStatusOutput.stdout);
  const rangesByPath = parsePatchRanges(patchOutput.stdout);
  const files: GitDiffFile[] = entries.map((entry) => {
    if (entry.diffStatus === "unsupported") {
      return {
        repoRelativePath: entry.repoRelativePath,
        absolutePath: path.join(workspaceRoot, entry.repoRelativePath),
        diffStatus: "unsupported",
        changedLineRanges: [],
        reason: entry.reason,
      };
    }

    const ranges = rangesByPath.get(entry.repoRelativePath) ?? [];
    if (ranges.length === 0) {
      return {
        repoRelativePath: entry.repoRelativePath,
        absolutePath: path.join(workspaceRoot, entry.repoRelativePath),
        diffStatus: "unsupported",
        changedLineRanges: [],
        reason: "No target-side hunk ranges available for this diff.",
      };
    }

    return {
      repoRelativePath: entry.repoRelativePath,
      absolutePath: path.join(workspaceRoot, entry.repoRelativePath),
      diffStatus: entry.diffStatus,
      changedLineRanges: ranges,
    };
  });

  return {
    baseRef,
    headRef,
    comparisonMode,
    files,
  };
}
