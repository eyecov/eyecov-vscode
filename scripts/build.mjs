import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outDir = path.join(rootDir, "out");
const watchMode = process.argv.includes("--watch");

const sharedOptions = {
  bundle: true,
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  sourcemap: false,
  target: "node20",
  logLevel: "info",
};

const entryPoints = [
  {
    entryPoints: [path.join(rootDir, "src", "extension.ts")],
    outfile: path.join(outDir, "extension.js"),
  },
  {
    entryPoints: [path.join(rootDir, "src", "mcp", "server.ts")],
    outfile: path.join(outDir, "mcp", "server.js"),
  },
  {
    entryPoints: [path.join(rootDir, "scripts", "report.ts")],
    outfile: path.join(outDir, "report.js"),
  },
];

async function build() {
  rmSync(outDir, { force: true, recursive: true });

  if (watchMode) {
    const contexts = await Promise.all(
      entryPoints.map((config) =>
        esbuild.context({ ...sharedOptions, ...config }),
      ),
    );

    await Promise.all(contexts.map((context) => context.watch()));
    console.log("Watching bundled extension build...");
    return;
  }

  await Promise.all(
    entryPoints.map((config) => esbuild.build({ ...sharedOptions, ...config })),
  );
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
