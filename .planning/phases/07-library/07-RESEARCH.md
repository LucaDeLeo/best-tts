# Phase 07: Library - Research

**Researched:** 2026-01-27
**Domain:** IndexedDB storage, library management, position persistence
**Confidence:** HIGH

## Summary

Phase 07 implements a local library system for saving webpages and documents with resume position tracking. The comprehensive CONTEXT.md already defines the architecture: split storage (`library-items` for metadata, `library-contents` for full text), the `idb` Promise-based wrapper, resume safety via `chunkingVersion`/`contentSnippet`/`charOffset` fallback chain, and autosave with 10s throttling.

This research validates the CONTEXT.md decisions against current `idb` documentation, identifies existing patterns in the codebase to extend, and documents specific implementation patterns for the planner.

**Primary recommendation:** Use the `idb` library (v8.x) with typed DBSchema interface. Separate metadata and content stores. Implement resume fallback chain as specified in CONTEXT.md. Add context menu "Save to Library" alongside existing popup save.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| idb | ^8.0.0 | Promise-based IndexedDB wrapper | Official jake archibald wrapper, used by Google devs, typed DBSchema support |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| idb-keyval | (existing) | Simple key-value storage | Already used for model cache; keep for simple settings |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| idb | raw IndexedDB | More verbose, no tx.done Promise, harder error handling |
| idb | Dexie.js | More features but heavier (~20KB vs ~1KB), overkill for this use case |
| idb | localForage | Uses multiple backends, adds complexity |

**Installation:**
```bash
npm install idb
```

Note: The project already has `idb-keyval` installed (`src/lib/model-cache.ts:1`). The full `idb` package is a separate dependency that adds DBSchema typing and transaction support.

## Architecture Patterns

### Recommended Module Structure
```
src/lib/
├── library-storage.ts    # IDB database, schema, CRUD operations
├── library-types.ts      # TypeScript interfaces for library items
├── autosave.ts           # Position tracking and throttled save logic
└── library-messages.ts   # Message types (or add to existing messages.ts)
```

### Pattern 1: Typed DBSchema with Split Stores
**What:** Define TypeScript interfaces that map to IndexedDB stores for type safety.
**When to use:** Always when using idb with TypeScript.
**Example:**
```typescript
// Source: Context7 /jakearchibald/idb README
import { openDB, DBSchema } from 'idb';

interface LibraryDB extends DBSchema {
  'library-items': {
    key: string;  // UUID
    value: LibraryItem;
    indexes: {
      'by-url': string;
      'by-lastReadAt': number;
      'by-folderId': string;
    };
  };
  'library-contents': {
    key: string;  // Same UUID as library-items
    value: { id: string; content: string };
  };
}

async function openLibraryDB() {
  return openDB<LibraryDB>('library-db', 1, {
    upgrade(db) {
      const items = db.createObjectStore('library-items', { keyPath: 'id' });
      items.createIndex('by-url', 'url');
      items.createIndex('by-lastReadAt', 'lastReadAt');
      items.createIndex('by-folderId', 'folderId');

      db.createObjectStore('library-contents', { keyPath: 'id' });
    }
  });
}
```

### Pattern 2: Cross-Store Atomic Transactions
**What:** Use single transaction for operations touching both stores to prevent orphans.
**When to use:** Save and delete operations (metadata + content).
**Example:**
```typescript
// Source: CONTEXT.md Decision #1 + idb docs
async function saveLibraryItem(db: IDBPDatabase<LibraryDB>, item: LibraryItem, content: string) {
  const tx = db.transaction(['library-items', 'library-contents'], 'readwrite');
  tx.objectStore('library-items').put(item);
  tx.objectStore('library-contents').put({ id: item.id, content });
  await tx.done;  // Both succeed or both fail
}

async function deleteLibraryItem(db: IDBPDatabase<LibraryDB>, id: string) {
  const tx = db.transaction(['library-items', 'library-contents'], 'readwrite');
  tx.objectStore('library-items').delete(id);
  tx.objectStore('library-contents').delete(id);
  await tx.done;
}
```

### Pattern 3: Resume Position Fallback Chain
**What:** Multi-level fallback for resume when content or chunking changes.
**When to use:** Loading a saved item for playback.
**Example:**
```typescript
// Source: CONTEXT.md Resume Safety section
interface ResumeData {
  currentChunkIndex: number;
  chunkingVersion: string;
  contentSnippet: string;      // First 100 chars of current chunk
  charOffset: number;
  contentLength: number;
  contentHash: string;
}

function resumePosition(item: LibraryItem, newChunks: string[], newContent: string): number {
  const resume = item.resumeData;
  const newHash = hashContent(newContent);

  // Fast path: exact match
  if (resume.contentHash === newHash && resume.chunkingVersion === CHUNKING_VERSION) {
    return Math.min(resume.currentChunkIndex, newChunks.length - 1);
  }

  // Content changed: try snippet search
  const snippetIndex = newContent.indexOf(resume.contentSnippet);
  if (snippetIndex !== -1) {
    return findChunkForOffset(newChunks, snippetIndex);
  }

  // Fallback: percentage-based approximation
  if (resume.charOffset && resume.contentLength) {
    const percentage = resume.charOffset / resume.contentLength;
    const newOffset = Math.floor(percentage * newContent.length);
    return findChunkForOffset(newChunks, newOffset);
  }

  // Ultimate fallback: start from beginning
  return 0;
}
```

### Pattern 4: Throttled Autosave
**What:** Debounced position saves with immediate save on pause/stop.
**When to use:** During playback to persist position.
**Example:**
```typescript
// Source: CONTEXT.md Autosave section
const THROTTLE_MS = 10_000;
let lastSaveTime = 0;
let lastSavedChunk = -1;

function savePosition(force = false) {
  const now = Date.now();
  if (!force && now - lastSaveTime < THROTTLE_MS) return;
  if (currentChunkIndex === lastSavedChunk) return;

  updateLibraryItemPosition(itemId, {
    currentChunkIndex,
    charOffset: calculateCharOffset(currentChunkIndex),
    contentLength: totalContentLength,
    lastReadAt: now
  });

  lastSaveTime = now;
  lastSavedChunk = currentChunkIndex;
}

// Save on pause/stop
function onPauseOrStop() {
  savePosition(true);  // Force immediate
}

// Attempt save on visibility change
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    savePosition(true);
  }
});
```

### Anti-Patterns to Avoid
- **Storing content in metadata store:** Slows list queries, loads MB into memory for simple lists
- **Using idb-keyval for library:** No indexes, can't query by folder or sort by date
- **Chunk index only for resume:** Breaks when chunking algorithm changes
- **Blocking saves on every chunk change:** Creates write storm, throttle instead

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IDB Promise wrapper | Manual Promise wrapping | `idb` library | Edge cases (abort, error propagation), tx.done pattern |
| Content hashing | Custom hash function | `crypto.subtle.digest('SHA-256', ...)` | Browser-native, fast, secure |
| URL deduplication | Manual URL comparison | Index by URL + getFromIndex | IDB handles efficiently |
| Sentence chunking | New chunker | Existing `splitIntoChunks` from `text-chunker.ts` | Already implemented, tested |

**Key insight:** IDB has many subtle edge cases (transaction auto-commit timing, error propagation). The `idb` wrapper handles these correctly; raw IDB code often has bugs.

## Common Pitfalls

### Pitfall 1: Transaction Auto-Commit
**What goes wrong:** Transaction commits before all operations complete if you `await` something outside the transaction.
**Why it happens:** IDB transactions auto-commit when the event loop returns to idle.
**How to avoid:** Keep all async work inside the transaction callback, use `Promise.all` for parallel ops.
**Warning signs:** "Transaction already committed" errors, partial data.

### Pitfall 2: Schema Version Mismatch
**What goes wrong:** `NotFoundError` when accessing stores that should exist.
**Why it happens:** Code expects newer schema than what's in user's browser.
**How to avoid:** Check `db.version` before operations, handle `onversionchange` event.
**Warning signs:** Works on fresh install, fails for users with existing data.

### Pitfall 3: Quota Exceeded Without Warning
**What goes wrong:** Save operation fails silently or throws cryptic error.
**Why it happens:** Extension storage quota exhausted by large documents.
**How to avoid:** Check `navigator.storage.estimate()` before large saves, catch `QuotaExceededError`.
**Warning signs:** Works for small docs, fails for PDFs; works initially, fails after saving several items.

### Pitfall 4: Orphaned Content Records
**What goes wrong:** `library-contents` has entries without matching `library-items`.
**Why it happens:** Delete operation only deleted from one store (non-atomic).
**How to avoid:** Always use single transaction for cross-store operations.
**Warning signs:** Storage grows but library shows fewer items, `contentDeleted` items never cleaned up.

## Code Examples

### Opening the Database
```typescript
// Source: Context7 idb docs + project patterns
import { openDB, IDBPDatabase } from 'idb';
import type { LibraryDB } from './library-types';

let dbInstance: IDBPDatabase<LibraryDB> | null = null;

export async function getLibraryDB(): Promise<IDBPDatabase<LibraryDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<LibraryDB>('library-db', 1, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const items = db.createObjectStore('library-items', { keyPath: 'id' });
        items.createIndex('by-url', 'url', { unique: false });
        items.createIndex('by-lastReadAt', 'lastReadAt', { unique: false });
        items.createIndex('by-folderId', 'folderId', { unique: false });

        db.createObjectStore('library-contents', { keyPath: 'id' });
      }
    },
    blocking() {
      // Another tab opened newer version
      dbInstance?.close();
      dbInstance = null;
    },
    terminated() {
      dbInstance = null;
    }
  });

  return dbInstance;
}
```

### Getting Recent Items
```typescript
// Source: idb docs index usage
export async function getRecentItems(limit = 5): Promise<LibraryItem[]> {
  const db = await getLibraryDB();
  const tx = db.transaction('library-items', 'readonly');
  const index = tx.store.index('by-lastReadAt');

  // Iterate backwards (most recent first) with limit
  const items: LibraryItem[] = [];
  let cursor = await index.openCursor(null, 'prev');

  while (cursor && items.length < limit) {
    items.push(cursor.value);
    cursor = await cursor.continue();
  }

  return items;
}
```

### Checking URL Already Saved
```typescript
// Source: idb docs + CONTEXT.md dedup
export async function isUrlSaved(url: string): Promise<LibraryItem | null> {
  const db = await getLibraryDB();
  const item = await db.getFromIndex('library-items', 'by-url', url);
  return item || null;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| callback-based IDB | Promise-based via `idb` | 2019 (idb v4) | Much cleaner async/await code |
| Manual version checks | DBSchema with TypeScript | idb v5 | Compile-time safety for store operations |
| idb-keyval for everything | idb for complex queries | N/A | idb-keyval lacks indexes, sorting |

**Deprecated/outdated:**
- Manual Promise wrapping of IDB: Use `idb` library instead
- Storing large blobs in same store as metadata: Split stores for performance

## Open Questions

1. **Folder implementation**
   - What we know: CONTEXT.md recommends folders-only for Phase 7, defer tags
   - What's unclear: Nested folders or flat hierarchy?
   - Recommendation: Start with flat folders (simpler), add nesting in Phase 8 if needed

2. **Recent items in popup count**
   - What we know: CONTEXT.md recommends 5 items
   - What's unclear: User preference?
   - Recommendation: Use 5, make configurable in Phase 8 settings

## Sources

### Primary (HIGH confidence)
- `/jakearchibald/idb` Context7 - openDB, transactions, schema
- `CONTEXT.md` in `.planning/phases/07-library/` - All architecture decisions

### Secondary (MEDIUM confidence)
- Existing codebase patterns (`model-cache.ts`, `service-worker.ts`)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - idb is well-documented, matches CONTEXT.md decision
- Architecture: HIGH - CONTEXT.md provides detailed patterns
- Pitfalls: HIGH - Based on IDB documentation and common issues

**Research date:** 2026-01-27
**Valid until:** 30 days (stable domain)
