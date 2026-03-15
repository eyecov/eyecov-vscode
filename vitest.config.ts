import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/test/**"],
    environment: "node",
    globals: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test/**", "**/*.d.ts"],
      reporter: ["text", "html", "lcov", "json"],
      reportsDirectory: "./coverage",
    },
  },
});
