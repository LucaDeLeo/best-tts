---
phase: 6
plan: 5
subsystem: document-support
tags: [service-worker, extraction, cancellation, indexeddb, warnings]

# Dependency graph
requires: ["06-01", "06-02", "06-03", "06-04"]
provides: [service-worker-extraction-handlers, chunk-storage, extraction-cancellation, soft-limit-warnings]
affects: ["07-xx"]

# Tech tracking
tech-stack:
  added: []
  patterns: [indexeddb-chunk-storage, abort-signal-cancellation, pending-warning-flow]

# File tracking
key-files:
  created:
    - src/lib/extraction-state.ts
  modified:
    - src/background/service-worker.ts
    - src/popup/popup.ts
    - src/offscreen/offscreen.ts

# Decisions
decisions:
  - id: "06-05-01"
    choice: "Chunk storage in offscreen IndexedDB, not SW memory"
    rationale: "Per CONTEXT.md Decision #2 - avoids MV3 SW suspension issues"
  - id: "06-05-02"
    choice: "Page count warning triggers early via callback during PDF extraction"
    rationale: "Per CONTEXT.md Decision #6 - avoids wasting work on large PDFs"
  - id: "06-05-03"
    choice: "5-minute timeout auto-cancels pending warnings"
    rationale: "Prevents indefinite resource holding"
  - id: "06-05-04"
    choice: "Promise resolver pattern for early page count warnings"
    rationale: "Allows extraction to pause/resume based on user response"

# Metrics
metrics:
  duration: "3 min"
  completed: "2026-01-27"
---

# Phase 6 Plan 5: Service Worker & Warnings Summary

**One-liner:** Service worker orchestration for document extraction with chunked uploads, IndexedDB storage, cancellation, and soft limit warnings.

## What Was Built

### Extraction State Management (extraction-state.ts)
- **In-memory state tracking** for current extraction metadata
- **Chunk metadata tracking** (count only - actual data in offscreen IndexedDB)
- **Pending warning support** with badge indicator ("!")
- **5-minute auto-cancel timeout** for unanswered warnings
- **Cancellation detection** via extraction ID mismatch

### Service Worker Handlers (service-worker.ts)
- **EXTRACT_DOCUMENT** - Handles direct and chunked uploads
- **DOCUMENT_CHUNK** - Forwards chunks to offscreen IndexedDB
- **DOCUMENT_CHUNK_COMPLETE** - Triggers extraction from reassembled chunks
- **WARNING_RESPONSE** - Handles user continue/cancel decision
- **CANCEL_EXTRACTION** - Aborts extraction and cleans up
- **GET_PENDING_WARNING** - Returns current warning state for popup
- **PAGE_COUNT_WARNING** - Early warning from offscreen during PDF metadata load

### Popup Warning Handling (popup.ts)
- **checkPendingWarning()** - Checks for pending warnings on init
- **showExtractionWarning()** - Displays warning in file size dialog
- **Updated cancelFileSizeWarning()** - Handles both file and extraction warnings
- **Updated continueWithLargeFile()** - Handles both file and extraction warnings

### Offscreen Chunk Storage (offscreen.ts)
- **IndexedDB helpers** - openChunkDb, storeChunkInDb, getChunksFromDb, deleteChunksFromDb
- **INIT_CHUNK_STORAGE** - Initializes metadata for chunked upload
- **STORE_CHUNK** - Stores chunk to IndexedDB
- **EXTRACT_FROM_CHUNKS** - Reassembles and extracts with AbortSignal
- **CLEANUP_CHUNKS** - Cleans up IndexedDB entries
- **CANCEL_EXTRACTION** - Aborts and cleans up

## Extraction Flow

### Direct Upload (< 10 MB)
```
Popup -> EXTRACT_DOCUMENT(data) -> SW -> Offscreen(extract) -> Result
```

### Chunked Upload (> 10 MB)
```
Popup -> EXTRACT_DOCUMENT(null) -> SW -> Offscreen(init IndexedDB)
Popup -> DOCUMENT_CHUNK x N -> SW -> Offscreen(store to IndexedDB)
Popup -> DOCUMENT_CHUNK_COMPLETE -> SW -> Offscreen(reassemble & extract) -> Result
```

### Warning Flow (Page Count)
```
Offscreen(PDF metadata) -> PAGE_COUNT_WARNING -> SW(set pending, show badge)
                                                    |
                                                    v
                                              Popup(show dialog)
                                                    |
                                                    v
                                              WARNING_RESPONSE -> SW(resolve promise)
                                                    |
                                                    v
                                              Offscreen(continue or abort)
```

### Warning Flow (Text Length)
```
Offscreen(extraction complete) -> Result -> SW(check text length)
                                             |
                                             v
                                       SW(set pending, store result)
                                             |
                                             v
                                       Popup(show dialog)
                                             |
                                             v
                                       WARNING_RESPONSE -> SW(return stored result or cancel)
```

## Key Design Decisions

1. **Chunk storage in offscreen IndexedDB** - Per CONTEXT.md Decision #2, chunks are stored in offscreen document's IndexedDB, not service worker memory. This avoids MV3 SW suspension issues and memory pressure.

2. **Early page count warning** - Per CONTEXT.md Decision #6, page count warning triggers after PDF metadata load, BEFORE full text extraction. Uses Promise resolver pattern to pause extraction.

3. **Text length warning is post-extraction** - Result is stored in session storage while waiting for user response, then returned or discarded.

4. **AbortSignal for cancellation** - Passed through extraction pipeline for clean cancellation support.

5. **Badge indicator** - Shows "!" when warning is pending, even if popup is closed.

## Commits

| Hash | Description |
|------|-------------|
| b1fbd04 | feat(06-05): add extraction state management module |
| ea7cb04 | feat(06-05): add document extraction handlers to service worker |
| a5aa272 | feat(06-05): add pending warning check to popup |
| a7b7094 | feat(06-05): add chunk storage and cancellation support to offscreen |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- [x] TypeScript compiles without errors
- [x] Build succeeds
- [x] Service worker handles EXTRACT_DOCUMENT messages
- [x] Chunked uploads stored in offscreen IndexedDB (not SW memory)
- [x] Chunk reassembly happens in offscreen document
- [x] Cancellation aborts via AbortSignal and cleans up IndexedDB
- [x] Page count warning triggers EARLY after PDF metadata load
- [x] Text length warning triggers after extraction completes
- [x] Badge shows "!" when warning is pending
- [x] Popup retrieves and displays pending warnings on open
- [x] User can continue or cancel from warning dialog

## Next Phase Readiness

Phase 6 Document Support is now complete with all 5 plans executed:
1. 06-01: Message Types & Types
2. 06-02: PDF Extraction
3. 06-03: Text File Extraction
4. 06-04: Popup Import UI
5. 06-05: Service Worker & Warnings

Ready for Phase 7: Library Storage.
