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
  recoverableEntries: TrackedCoverageEntry[] | undefined;
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
  const { currentDocumentText, recoverableEntries } = options;
  if (!recoverableEntries || recoverableEntries.length === 0) {
    return null;
  }
  const fingerprint = fingerprintDocumentText(currentDocumentText);
  for (let i = recoverableEntries.length - 1; i >= 0; i -= 1) {
    if (recoverableEntries[i].fingerprint === fingerprint) {
      return recoverableEntries[i];
    }
  }
  return null;
}

export function pushRecoverableEntry(
  entries: TrackedCoverageEntry[] | undefined,
  entry: TrackedCoverageEntry,
): TrackedCoverageEntry[] {
  const existing = entries ?? [];
  const last = existing[existing.length - 1];
  if (last?.fingerprint === entry.fingerprint) {
    return existing;
  }
  const next = [...existing, entry];
  return next.length > 50 ? next.slice(next.length - 50) : next;
}
