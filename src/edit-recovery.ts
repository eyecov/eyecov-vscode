import { createHash } from "node:crypto";
import type { TrackedCoverageState } from "./edit-tracking";

export interface TrackedCoverageEntry {
  state: TrackedCoverageState;
  editCount: number;
  fingerprint: string;
}

export interface RestoreTrackedCoverageOptions {
  reason: number | undefined;
  currentDocumentText: string;
  recoverableEntry: TrackedCoverageEntry | undefined;
}

export function fingerprintDocumentText(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

export function createTrackedCoverageEntry(
  state: TrackedCoverageState,
  editCount: number,
  documentText: string,
): TrackedCoverageEntry {
  return {
    state,
    editCount,
    fingerprint: fingerprintDocumentText(documentText),
  };
}

export function tryRestoreTrackedCoverageEntry(
  options: RestoreTrackedCoverageOptions,
): TrackedCoverageEntry | null {
  const { reason, currentDocumentText, recoverableEntry } = options;
  if (!recoverableEntry) {
    return null;
  }
  if (reason !== 1 && reason !== 2) {
    return null;
  }
  return fingerprintDocumentText(currentDocumentText) ===
    recoverableEntry.fingerprint
    ? recoverableEntry
    : null;
}
