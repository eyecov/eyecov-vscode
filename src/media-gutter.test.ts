import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MEDIA_DIR = path.join(process.cwd(), "media");
const GUTTER_COLORS = ["green", "red", "yellow"] as const;

describe("gutter icon assets", () => {
  it("media directory exists", () => {
    expect(fs.existsSync(MEDIA_DIR)).toBe(true);
    expect(fs.statSync(MEDIA_DIR).isDirectory()).toBe(true);
  });

  it.each(GUTTER_COLORS)("gutter-%s.svg exists and contains SVG", (color) => {
    const filePath = path.join(MEDIA_DIR, `gutter-${color}.svg`);
    expect(fs.existsSync(filePath), `${filePath} should exist`).toBe(true);
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("<svg");
    expect(content).toContain(color);
  });
});
