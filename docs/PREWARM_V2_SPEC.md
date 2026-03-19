# Spec: Prewarm V1 — Lean Incremental Indexing (Final - Phased)

## 1. Goal
Stop doing redundant work. Optimize the prewarm process to handle large repos by **fingerprinting artifacts** and **prioritizing the active workspace**, while providing enough visibility that the process doesn't feel "haunted."

## 2. The Core Wins (V1)
*   **Artifact Fingerprinting (Global):** Skip the entire crawl if the primary coverage artifacts haven't changed since the last index.
*   **Active-File Priority:** Index the files the user is looking at *right now* before the rest of the project.
*   **Visible State:** A simple status bar indicator to show that work is happening.

---

## 3. Phased Implementation

### Phase 1: Global Fingerprinting + Skip (High Certainty)
Instead of a blind crawl, the indexer checks the "Global Fingerprint" of the workspace coverage artifacts.
*   **Artifact Discovery:** The indexer receives the list of artifact paths to stat from the `CoverageConfig`.
*   **Metadata Store:** `CoverageCachePayload` stores a `globalFingerprint` object: `{ [path: string]: { mtime: number, size: number } }`.
*   **Skip-Logic:** If all current disk fingerprints match the cache, the crawl is skipped entirely.

### Phase 2: Visible-Editor Priority + Status UI (High Value)
Ensure the files the user is actually touching are indexed first and the process is visible.
*   **Tier 1 (High Priority):** Files open in `vscode.window.visibleTextEditors`.
*   **Tier 2 (Background):** All other files.
*   **Status Bar:** Add a spinner `[$(sync~spin)] EyeCov: Indexing (452/1200)...` and an idle state `[$(check)] EyeCov`.

### Phase 3: Partial Cache/Reporting (Speculative/Optional)
**Risk Note:** Only implement if Phase 1 & 2 are insufficient. Partial aggregates can be misleading or "unbalanced" based on what the user has open.
*   **Safety Flag:** Add `cacheState: "partial" | "full"` to the payload.
*   **Early Commit:** Write the cache with `cacheState: "partial"` after Tier 1.
*   **Partial Truth:** `projectAggregateFromCache` returns partial totals + the `partial` flag.

---

## 4. Technical Constraints

### 4.1. Cache Metadata Schema
```typescript
interface ArtifactFingerprint {
  mtime: number;
  size: number;
}

interface CoverageCachePayload {
  globalFingerprint: Record<string, ArtifactFingerprint>;
  cacheState: "partial" | "full";
  // ... existing fields
}
```

### 4.2. Indexer Lifecycle (V1)
1.  **Discovery:** Get artifact paths from config.
2.  **Fingerprint:** Stat artifacts and compare with `globalFingerprint` in cache.
3.  **Skip/Crawl:** If match, exit. Else, start sequential crawl.
4.  **Finalize:** Write full cache with new fingerprints.

---

## 5. Explicit Non-Goals
*   **NO Worker Threads:** Sequential main-thread I/O is sufficient for V1.
*   **NO Sharded Storage:** Stick to a single `coverage-cache.json`.
*   **NO Per-File Mapping:** Fingerprinting is global for the workspace in V1.

---

## 6. Success Metrics
*   **Instant Skip:** < 100ms startup cost when artifacts are unchanged.
*   **Zero Haunted Work:** Status bar clearly indicates when indexing is active.
*   **Safe Aggregates:** Project totals remain trustworthy by defaulting to "full" commits only.
