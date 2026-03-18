import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CoberturaAdapter, listCoberturaSourcePaths } from "./index";

describe("CoberturaAdapter", () => {
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eyecov-cobertura-"));
    workspaceRoot = path.join(tmpDir, "workspace");
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "coverage"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "build"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves coverage for a source file from Cobertura XML", async () => {
    const sourcePath = path.join(workspaceRoot, "src", "Example.ts");
    const artifactPath = path.join(
      workspaceRoot,
      "coverage",
      "cobertura-coverage.xml",
    );
    fs.writeFileSync(sourcePath, "const value = 1;\n");
    fs.writeFileSync(
      artifactPath,
      `<?xml version="1.0"?>
<coverage>
  <sources>
    <source>${workspaceRoot}</source>
  </sources>
  <packages>
    <package>
      <classes>
        <class name="Example" filename="src/Example.ts">
          <lines>
            <line number="1" hits="1"/>
            <line number="2" hits="0"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`,
    );

    const adapter = new CoberturaAdapter();
    const result = await adapter.getCoverage(sourcePath, [workspaceRoot]);

    expect(result.rejectReason).toBeUndefined();
    expect(result.record).not.toBeNull();
    expect(result.record!.sourcePath).toBe(sourcePath);
    expect(result.record!.coveredLines.has(1)).toBe(true);
    expect(result.record!.uncoveredLines.has(2)).toBe(true);
    expect(result.record!.lineCoveragePercent).toBe(50);
  });

  it("returns stale when the source file is newer than the coverage artifact", async () => {
    const sourcePath = path.join(workspaceRoot, "src", "Example.ts");
    const artifactPath = path.join(
      workspaceRoot,
      "coverage",
      "cobertura-coverage.xml",
    );
    fs.writeFileSync(sourcePath, "const value = 1;\n");
    fs.writeFileSync(
      artifactPath,
      `<?xml version="1.0"?>
<coverage>
  <sources>
    <source>${workspaceRoot}</source>
  </sources>
  <packages>
    <package>
      <classes>
        <class name="Example" filename="src/Example.ts">
          <lines>
            <line number="1" hits="1"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`,
    );
    const nowSec = Date.now() / 1000;
    fs.utimesSync(artifactPath, nowSec - 10, nowSec - 10);
    fs.utimesSync(sourcePath, nowSec, nowSec);

    const adapter = new CoberturaAdapter();
    const result = await adapter.getCoverage(sourcePath, [workspaceRoot]);

    expect(result.record).toBeNull();
    expect(result.rejectReason).toBe("stale");
  });

  it("honors a custom Cobertura artifact path", async () => {
    const sourcePath = path.join(workspaceRoot, "src", "Example.ts");
    const artifactPath = path.join(workspaceRoot, "build", "coverage.xml");
    fs.writeFileSync(sourcePath, "const value = 1;\n");
    fs.writeFileSync(
      artifactPath,
      `<?xml version="1.0"?>
<coverage>
  <sources>
    <source>${workspaceRoot}</source>
  </sources>
  <packages>
    <package>
      <classes>
        <class name="Example" filename="src/Example.ts">
          <lines>
            <line number="1" hits="1"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`,
    );

    const adapter = new CoberturaAdapter({ path: "build/coverage.xml" });
    const result = await adapter.getCoverage(sourcePath, [workspaceRoot]);

    expect(result.record).not.toBeNull();
    expect(result.record!.lineCoveragePercent).toBe(100);
  });
});

describe("listCoberturaSourcePaths", () => {
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eyecov-cobertura-list-"));
    workspaceRoot = path.join(tmpDir, "workspace");
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "coverage"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists resolved source file paths from Cobertura XML", () => {
    fs.writeFileSync(path.join(workspaceRoot, "src", "Alpha.ts"), "");
    fs.writeFileSync(path.join(workspaceRoot, "src", "Beta.ts"), "");
    fs.writeFileSync(
      path.join(workspaceRoot, "coverage", "cobertura-coverage.xml"),
      `<?xml version="1.0"?>
<coverage>
  <sources>
    <source>${workspaceRoot}</source>
  </sources>
  <packages>
    <package>
      <classes>
        <class name="Alpha" filename="src/Alpha.ts">
          <lines><line number="1" hits="1"/></lines>
        </class>
        <class name="Beta" filename="src/Beta.ts">
          <lines><line number="1" hits="0"/></lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`,
    );

    expect(listCoberturaSourcePaths([workspaceRoot])).toEqual([
      path.resolve(workspaceRoot, "src", "Alpha.ts"),
      path.resolve(workspaceRoot, "src", "Beta.ts"),
    ]);
  });

  it("supports a custom Cobertura artifact path when listing source paths", () => {
    fs.writeFileSync(path.join(workspaceRoot, "src", "Custom.ts"), "");
    fs.mkdirSync(path.join(workspaceRoot, "build"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "build", "coverage.xml"),
      `<?xml version="1.0"?>
<coverage>
  <sources>
    <source>${workspaceRoot}</source>
  </sources>
  <packages>
    <package>
      <classes>
        <class name="Custom" filename="src/Custom.ts">
          <lines><line number="1" hits="1"/></lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`,
    );

    expect(
      listCoberturaSourcePaths([workspaceRoot], { path: "build/coverage.xml" }),
    ).toEqual([path.resolve(workspaceRoot, "src", "Custom.ts")]);
  });
});
