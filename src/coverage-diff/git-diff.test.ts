import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { getGitDiffForRoot } from "./git-diff";

const tempDirs: string[] = [];

function createRepo(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "eyecov-git-diff-"));
  tempDirs.push(repoRoot);
  execFileSync("git", ["init", "-b", "main"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "EyeCov Test"], {
    cwd: repoRoot,
  });
  execFileSync("git", ["config", "user.email", "eyecov@example.test"], {
    cwd: repoRoot,
  });
  return repoRoot;
}

function git(repoRoot: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("getGitDiffForRoot", () => {
  it("returns target-side changed line ranges for modified files", async () => {
    const repoRoot = createRepo();
    fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "src", "foo.ts"),
      ["one", "two", "three"].join("\n") + "\n",
    );
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "initial");
    git(repoRoot, "checkout", "-b", "feature/diff");

    fs.writeFileSync(
      path.join(repoRoot, "src", "foo.ts"),
      ["one", "two changed", "three", "four"].join("\n") + "\n",
    );
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "change");

    const result = await getGitDiffForRoot(repoRoot, {
      workspaceRoots: [repoRoot],
      base: "main",
      comparison: "direct",
      head: "HEAD",
    });

    expect(result).toMatchObject({
      baseRef: "main",
      headRef: "HEAD",
      comparisonMode: "direct",
      files: [
        {
          repoRelativePath: "src/foo.ts",
          diffStatus: "modified",
          changedLineRanges: [
            [2, 3],
            [4, 5],
          ],
        },
      ],
    });
  });

  it("supports renamed files when git provides target-side hunks", async () => {
    const repoRoot = createRepo();
    fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "src", "old.ts"),
      ["alpha", "beta", "gamma", "delta", "epsilon"].join("\n") + "\n",
    );
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "initial");
    git(repoRoot, "checkout", "-b", "feature/diff");

    git(repoRoot, "mv", "src/old.ts", "src/new.ts");
    fs.writeFileSync(
      path.join(repoRoot, "src", "new.ts"),
      ["alpha", "beta changed", "gamma", "delta", "epsilon"].join("\n") + "\n",
    );
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "rename");

    const result = await getGitDiffForRoot(repoRoot, {
      workspaceRoots: [repoRoot],
      base: "main",
      comparison: "direct",
      head: "HEAD",
    });

    expect(result.files).toMatchObject([
      {
        repoRelativePath: "src/new.ts",
        diffStatus: "renamed",
        changedLineRanges: [[2, 3]],
      },
    ]);
  });

  it("marks deleted files as unsupported", async () => {
    const repoRoot = createRepo();
    fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "src", "gone.ts"), "bye\n");
    git(repoRoot, "add", ".");
    git(repoRoot, "commit", "-m", "initial");
    git(repoRoot, "checkout", "-b", "feature/diff");

    git(repoRoot, "rm", "src/gone.ts");
    git(repoRoot, "commit", "-m", "delete");

    const result = await getGitDiffForRoot(repoRoot, {
      workspaceRoots: [repoRoot],
      base: "main",
      comparison: "direct",
      head: "HEAD",
    });

    expect(result.files).toMatchObject([
      {
        repoRelativePath: "src/gone.ts",
        diffStatus: "unsupported",
      },
    ]);
  });
});
