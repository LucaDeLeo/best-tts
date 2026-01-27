---
phase: 07-library
plan: 01
subsystem: storage
tags: [indexeddb, idb, library, crud, folders]
depends_on:
  requires: []
  provides: [library-storage, library-types, folder-crud]
  affects: [07-02, 07-03, 07-04, 07-05]
tech-stack:
  added: [idb@^8.0.0]
  patterns: [singleton-db, atomic-transactions, index-queries, retry-backoff]
key-files:
  created:
    - src/lib/library-types.ts
    - src/lib/library-storage.ts
  modified:
    - package.json
    - package-lock.json
decisions:
  - id: 07-01-01
    decision: "by-folderId index type is string (not string|null) - root items filtered in JS"
    context: "IndexedDB indexes require IDBValidKey which doesn't include null"
    alternatives: ["Use empty string sentinel value"]
metrics:
  duration: 3 min
  completed: 2026-01-27
---

# Phase 07 Plan 01: Library Storage Foundation Summary

IndexedDB storage layer with idb wrapper, typed schema, atomic cross-store transactions, and folder CRUD operations.

## What Was Built

### Core Types (`library-types.ts`)

- **LibraryItem**: Complete metadata interface with id, title, url, source, folderId, timestamps, contentDeleted flags, contentSize, contentHash, and resumeData
- **LibraryFolder**: Simple folder structure with id, name, createdAt, updatedAt
- **LibraryContent**: Separate content storage keyed by item id
- **ResumeData**: Position recovery with fallback chain (currentChunkIndex, chunkingVersion, contentSnippet, charOffset, contentLength, contentHash)
- **LibraryDB**: Typed DBSchema interface for idb with indexes: by-url, by-lastReadAt, by-folderId
- **CHUNKING_VERSION**: Constant `'1.0.0'` for resume algorithm versioning

### Storage Module (`library-storage.ts`)

**Database Setup:**
- Singleton pattern with `getLibraryDB()`
- Version 1 upgrade handler creates all stores and indexes
- `blocking` callback handles multi-tab version changes
- `terminated` callback resets singleton on abnormal termination

**Item CRUD (Atomic):**
- `saveLibraryItem(item, content)` - Cross-store atomic save
- `deleteLibraryItem(id)` - Cross-store atomic delete
- `getLibraryItems(options)` - Query with folderId filter and sortByRecent
- `getLibraryItemById(id)` - Single item lookup
- `getLibraryContent(id)` - Content retrieval
- `isUrlSaved(url)` - URL deduplication via index
- `updateLibraryItemPosition(id, resumeData)` - Fast autosave (single-store)

**Folder CRUD:**
- `createFolder(name)` - Creates with UUID and timestamps
- `renameFolder(id, name)` - Updates name and updatedAt
- `deleteFolder(id)` - Moves items to root, then deletes
- `getFolders()` - Returns all folders sorted by name

**Helpers:**
- `hashContent(content)` - SHA-256 via crypto.subtle
- `getRecentItems(limit)` - Uses by-lastReadAt index with reverse cursor
- `getStorageEstimateForLibrary()` - Quota checking for save decisions
- `withRetry(operation, maxRetries)` - Exponential backoff for transient errors
- `closeLibraryDB()` - Clean up connection

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| 07-01-01 | by-folderId index type is `string` not `string\|null` | IndexedDB indexes require IDBValidKey; root items (folderId: null) filtered in JavaScript instead |

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- `npm install` completed - idb package in node_modules
- `npm run build` completed without errors
- `npx tsc --noEmit` shows no type errors
- Files exist: src/lib/library-types.ts, src/lib/library-storage.ts
- All expected exports present in library-storage.ts

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 6809db4 | feat | Install idb and create library types |
| 5e1c3aa | feat | Create library storage module with database setup |
| 43c8602 | feat | Add folder CRUD and helper functions |

## Next Phase Readiness

**Ready for 07-02 (Context Menu Save):**
- `saveLibraryItem()` available for saving extracted content
- `isUrlSaved()` available for duplicate detection
- `hashContent()` available for content hashing
- All types exported for use in other modules

**No blockers identified.**
