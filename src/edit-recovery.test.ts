import { describe, expect, it } from "vitest";
import {
  createTrackedCoverageEntry,
  fingerprintDocumentText,
  tryRestoreTrackedCoverageEntry,
} from "./edit-recovery";
import { recordToTrackedState } from "./edit-tracking";

function makeTrackedEntry(text: string) {
  return createTrackedCoverageEntry(
    recordToTrackedState(
      {
        sourcePath: "/app/Foo.php",
        coveredLines: new Set([10, 20]),
        uncoveredLines: new Set([30]),
        uncoverableLines: new Set<number>(),
        lineCoveragePercent: 66.67,
      },
      3,
    ),
    4,
    text,
  );
}

describe("edit-recovery", () => {
  it("restores tracked coverage on undo when document matches the saved snapshot exactly", () => {
    const entry = makeTrackedEntry("line 1\nline 2\n");

    const restored = tryRestoreTrackedCoverageEntry({
      reason: 1,
      currentDocumentText: "line 1\nline 2\n",
      recoverableEntry: entry,
    });

    expect(restored).toEqual(entry);
  });

  it("hashes equal text to the same fingerprint", () => {
    expect(fingerprintDocumentText("same")).toBe(
      fingerprintDocumentText("same"),
    );
  });

  it("does not restore on non-undo edits even when the document text matches", () => {
    const entry = makeTrackedEntry("line 1\nline 2\n");

    const restored = tryRestoreTrackedCoverageEntry({
      reason: undefined,
      currentDocumentText: "line 1\nline 2\n",
      recoverableEntry: entry,
    });

    expect(restored).toBeNull();
  });

  it("does not restore when undo stops short of the saved snapshot", () => {
    const entry = makeTrackedEntry("line 1\nline 2\n");

    const restored = tryRestoreTrackedCoverageEntry({
      reason: 1,
      currentDocumentText: "line 1\nline 2 changed\n",
      recoverableEntry: entry,
    });

    expect(restored).toBeNull();
  });

  it("restores tracked coverage on redo when document returns to the saved snapshot exactly", () => {
    const entry = makeTrackedEntry("line 1\nline 2\n");

    const restored = tryRestoreTrackedCoverageEntry({
      reason: 2,
      currentDocumentText: "line 1\nline 2\n",
      recoverableEntry: entry,
    });

    expect(restored).toEqual(entry);
  });
});
