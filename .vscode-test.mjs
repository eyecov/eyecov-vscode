import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@vscode/test-cli";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  files: "out/test/suite/**/*.test.js",
  workspaceFolder: path.join(__dirname, "test-workspace"),
  mocha: {
    ui: "tdd",
    timeout: 20_000,
  },
});
