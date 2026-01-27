Phase 07 CONTEXT.md has been created at `.planning/phases/07-library/CONTEXT.md`.

**Key decisions made:**

1. **Storage split** — Separate `library-items` (metadata) and `library-contents` stores to keep list queries fast
2. **Use `idb` wrapper** — The `idb` package (Promise-based IndexedDB wrapper) for library; `idb-keyval` is too limited (no indexes). The `idb` wrapper provides `tx.done`, proper index support, and cleaner async patterns while still allowing raw IDB access when needed
3. **Resume safety** — Added `chunkingVersion` + `contentSnippet` + `contentLength` fallback with defined recovery paths for stable position recovery
4. **Autosave** — Unified 10s throttle for all triggers (timer, chunk change); immediate on pause/stop; saves full resume data including `charOffset` + `contentLength` for percentage fallback; no offscreen dependency
5. **Context menu** — Added "Save to Library" right-click option for webpages (requires `contextMenus` permission, already present)
6. **IDB versioning** — Explicit version tracking with migration handlers for schema changes
7. **Quota handling** — Proactive quota checks with graceful degradation and user notification
8. **Error recovery** — Retry with exponential backoff for transient IDB failures; corruption detection triggers cleanup
9. **Content-deleted items** — Explicit `contentDeleted` flag with defined re-extraction flow; playback disabled until content restored
10. **Permissions verified** — `contextMenus` and `<all_urls>` already present in manifest; no new permissions needed

**Flagged for human review:**
- Tags vs folders-only (recommend folders-only for Phase 7)
- Recent items count in popup (recommend 5 items)

---

## Technical Details

### IDB Versioning & Migration Strategy

The library uses two object stores in a single IndexedDB database (`library-db`):
- `library-items` — metadata only (id, title, url, timestamps, progress, folderId)
- `library-contents` — full text content keyed by item id

**Cross-store atomicity:**
Save, update, and delete operations that touch both stores MUST use a single transaction to prevent orphaned data:

```js
async function saveLibraryItem(item, content) {
  const tx = db.transaction(['library-items', 'library-contents'], 'readwrite');
  const itemsStore = tx.objectStore('library-items');
  const contentsStore = tx.objectStore('library-contents');

  itemsStore.put(item);
  contentsStore.put({ id: item.id, content });

  await tx.done; // Both succeed or both fail
}

async function deleteLibraryItem(id) {
  const tx = db.transaction(['library-items', 'library-contents'], 'readwrite');
  tx.objectStore('library-items').delete(id);
  tx.objectStore('library-contents').delete(id);
  await tx.done;
}
```

**Failure modes prevented:**
- Quota exceeded mid-save: transaction aborts, neither store modified
- Browser crash: uncommitted transaction rolled back
- No orphaned content (content without metadata) or dangling references (metadata without content)

**Metadata-only updates (e.g., autosave):**
Position updates only touch `library-items` — single-store transaction is sufficient and faster.

**Version tracking:**
- Database version starts at `1` and increments with each schema change
- Each version bump includes a migration handler in `onupgradeneeded`
- Migration handlers run sequentially from current → target version
- Schema version is separate from extension version to allow independent evolution

**Migration pattern:**
```
onupgradeneeded(event) {
  const db = event.target.result;
  const oldVersion = event.oldVersion;

  if (oldVersion < 1) {
    // Initial schema: create both stores
    const items = db.createObjectStore('library-items', { keyPath: 'id' });
    items.createIndex('url', 'url', { unique: false });
    items.createIndex('lastReadAt', 'lastReadAt', { unique: false });
    items.createIndex('folderId', 'folderId', { unique: false });
    db.createObjectStore('library-contents', { keyPath: 'id' });
  }
  if (oldVersion < 2) {
    // Example future migration: add contentHash index
  }
}
```

**Migration constraints:**
- Data transformations happen in a post-upgrade transaction if needed
- Test migrations with synthetic old-version databases before release

**Schema deprecation lifecycle:**
The "never delete" rule is impractical long-term and conflicts with corruption detection. Instead, use a deprecation lifecycle:

1. **Deprecate (version N):** Mark store/index as deprecated in code comments; stop using it
2. **Grace period (versions N to N+2):** Keep deprecated schema elements; existing data remains accessible
3. **Remove (version N+3 or later):** Delete deprecated stores/indexes in `onupgradeneeded`
4. **Minimum 3 versions:** Ensures users who skip updates still migrate cleanly

```js
if (oldVersion < 4) {
  // v4: Remove deprecated 'tags' index (deprecated in v1, unused since v2)
  const items = transaction.objectStore('library-items');
  if (items.indexNames.contains('tags')) {
    items.deleteIndex('tags');
  }
}
```

**Rationale:** Intentional removals are distinguishable from corruption because:
- Removal only happens during `onupgradeneeded` (controlled code path)
- `NotFoundError` for a removed element after successful upgrade = code bug, not corruption
- `NotFoundError` for expected element (not in deprecation list) = corruption

---

### Resume Safety & Position Recovery

Resume relies on `chunkingVersion` and `contentSnippet` to find the user's position. Defined behavior for edge cases:

**Stored resume data:**
```js
{
  currentChunkIndex: 42,        // Primary: index into chunked content
  chunkingVersion: '1.0.0',     // Version of chunking algorithm used
  contentSnippet: 'first 100 chars of current chunk...',  // Fallback anchor
  charOffset: 12450,            // Secondary: character offset in full text
  contentLength: 54000,         // Total content length at save time (required for percentage fallback)
  contentHash: 'abc123...'      // Hash of stored content at save time
}
```

**Note on `contentLength`:** This field is REQUIRED for percentage-based resume fallback. It must be stored alongside `charOffset` at every autosave. If `contentLength` is missing from legacy data, percentage fallback is unavailable and the system falls back to user prompt or beginning.

**Resume algorithm (in order):**
1. **Hash match + version match:** Use `currentChunkIndex` directly (fast path)
2. **Hash match + version mismatch:** Re-chunk content with current algorithm, use `charOffset` to find new chunk index
3. **Hash mismatch (content changed):** Search for `contentSnippet` in new content
   - If found: calculate new `charOffset` from snippet position, derive chunk index
   - If not found: see fallback behavior below
4. **No snippet match:** Fallback behavior triggered

**Fallback behavior when snippet not found:**
Content has changed significantly (edited page, different version, etc.). Options in order of preference:

1. **Percentage-based approximation:** If old `charOffset` and old `contentLength` are stored, calculate percentage position and apply to new content length
   ```js
   const percentage = oldCharOffset / oldContentLength;
   const newCharOffset = Math.floor(percentage * newContentLength);
   ```
2. **User prompt:** Show toast: "Content has changed. Resume from beginning or approximate position (~X%)?"
   - "Beginning" → reset to chunk 0
   - "Approximate" → use percentage calculation
3. **Default if no interaction:** Resume from beginning, clear stale resume data

**Content change detection:**
- Compare `contentHash` at resume time vs. stored hash
- If different, mark item as `contentChanged: true` in metadata
- UI shows indicator: "Content may have changed since last read"

**Edge case: corrupted resume data:**
- If `currentChunkIndex` > total chunks, reset to last chunk
- If `charOffset` > content length, reset to beginning
- If `chunkingVersion` unrecognized, re-chunk and use `charOffset`

---

### Storage Quota Handling

Extensions share the origin's storage quota (typically ~10% of disk or browser-defined limit). Full content storage can exhaust quota quickly.

**Dynamic quota checking (not fixed thresholds):**
Before saving, compare actual content size against available space:

```js
async function canSaveContent(contentBytes) {
  const estimate = await getStorageEstimate();
  if (!estimate) {
    // Fallback: attempt save, handle QuotaExceededError
    return { canSave: true, fallbackMode: true };
  }

  const available = estimate.quota - estimate.usage;
  const buffer = 5 * 1024 * 1024; // 5MB safety buffer

  if (contentBytes + buffer > available) {
    return {
      canSave: false,
      available,
      needed: contentBytes,
      message: `Need ${formatBytes(contentBytes)}, only ${formatBytes(available)} available`
    };
  }
  return { canSave: true, available };
}

async function getStorageEstimate() {
  // navigator.storage.estimate() may be unavailable or inaccurate
  if (!navigator.storage?.estimate) {
    return null; // API unavailable
  }
  try {
    const estimate = await navigator.storage.estimate();
    // Some browsers return 0 or undefined for quota
    if (!estimate.quota || estimate.quota === 0) {
      return null;
    }
    return estimate;
  } catch {
    return null; // API failed
  }
}
```

**Quota check unavailable or inaccurate:**
When `navigator.storage.estimate()` is unavailable, returns 0, or throws:
1. **Proceed optimistically:** Attempt the save operation
2. **Catch `QuotaExceededError`:** Handle at write time (see below)
3. **Log warning:** Console warn that quota pre-check unavailable
4. **Do NOT block saves** based on fixed thresholds when actual quota unknown

**Graceful degradation on quota exceeded:**
1. `QuotaExceededError` caught during `put()` operations
2. Show toast notification: "Library storage full. Delete old items or export to free space."
3. Offer to open library manager for cleanup
4. Do NOT silently fail — user must know save did not complete

**Size-aware save decisions:**
- Calculate `contentSize` before save, store in metadata
- Show estimated size in save confirmation UI: "Save article (~150KB)?"
- For very large content (>1MB), warn user before save
- Display current usage in settings/library UI (sum of all `contentSize` values)

**Storage hygiene:**
- Track `contentSize` in metadata for accurate usage calculation
- Consider LRU eviction prompt for items not read in 90+ days (future phase)

---

### Content-Deleted Items (Metadata-Only State)

The "Delete content, keep metadata" option creates items where `library-contents` has no entry but `library-items` metadata remains. This state requires explicit handling.

**Schema marker:**
```js
// In library-items metadata
{
  id: 'abc123',
  title: 'Saved Article',
  url: 'https://example.com/article',
  contentDeleted: true,           // Explicit flag for content-deleted state
  contentDeletedAt: 1706000000,   // Timestamp when content was deleted
  // Resume data preserved but marked stale
  resumeData: { ... },
  resumeStale: true               // Resume data may not work after re-extract
}
```

**Defined behaviors for content-deleted items:**

1. **Library list display:**
   - Show normally with visual indicator (e.g., "Content removed" badge or faded appearance)
   - Title, URL, folder assignment remain intact

2. **Playback attempt:**
   - Do NOT allow playback from library directly
   - Show prompt: "Content was removed to save space. Re-extract from original page?"
   - "Re-extract" button navigates to URL and triggers extraction
   - "Cancel" returns to library

3. **Re-extraction flow:**
   - User clicks "Re-extract" → open URL in new tab
   - Content script extracts content
   - Save to `library-contents` with same item ID
   - Clear `contentDeleted` and `contentDeletedAt` flags
   - Mark `resumeStale: true` (content may have changed)

4. **Resume after re-extract:**
   - Since content may have changed, use the standard content-changed resume flow
   - Compare new `contentHash` vs. stored hash
   - If different, trigger snippet search or percentage fallback
   - Show toast: "Content was re-extracted and may have changed"

5. **`contentHash` checks:**
   - Skip hash validation for content-deleted items (no content to hash)
   - After re-extraction, compute new hash and store it

6. **Snippet fallback:**
   - `contentSnippet` is preserved but may not match re-extracted content
   - Standard snippet search applies; if not found, use percentage or prompt

7. **Bulk operations:**
   - "Delete all content-deleted items" option in library manager
   - Export includes content-deleted items (metadata only)

**Why not just delete the whole item?**
- Users may want to keep bookmarks/reading list without storage cost
- URL and title allow re-finding content later
- Folder organization preserved

---

### Autosave Throttling & Write Amplification

Autosave runs during playback to persist position data for resume.

**Autosave payload:**
Each autosave persists the full resume data required for percentage fallback:
```js
{
  currentChunkIndex: 42,        // Primary position
  charOffset: 12450,            // Character offset (required for percentage fallback)
  contentLength: 54000,         // Content length at save time (required for percentage fallback)
  lastReadAt: 1706000000,       // Timestamp for sorting
  // chunkingVersion and contentHash are set at initial save, not updated during autosave
}
```
This ensures percentage-based resume fallback is always available.

**Unified throttling policy:**
All autosave triggers share a single throttle: **minimum 10 seconds between writes**.

- **Dirty flag:** Only write if `currentChunkIndex` actually changed since last save
- **Single throttle:** Whether triggered by timer, chunk change, or pause, the 10s minimum applies
- **Batch updates:** If multiple fields change, coalesce into single write
- **Backoff on failure:** If write fails, double interval (10s → 20s → 40s), cap at 5 minutes

**Write amplification mitigation:**
- Only update `library-items` store (small metadata), never rewrite `library-contents`
- Use `IDBObjectStore.put()` which overwrites in-place (no append-only bloat)

**MV3 service worker considerations:**
- Service worker only handles message-based saves (explicit user action or cross-context sync)
- Service worker cannot host timers reliably (suspended after ~30s idle)

**Autosave strategy (simplified, no offscreen dependency):**

The offscreen document approach was considered but rejected:
- Requires `offscreen` permission with valid justification (audio playback is already justified; "autosave timer" is not)
- Chrome limits offscreen docs to specific use cases; timers alone don't qualify
- Adds complexity for marginal gain

Instead, use a **best-effort UI-context approach:**

1. **Primary: UI context timer** — popup/side panel/floating player each run their own 30s autosave timer while open (subject to 10s throttle)
2. **Save on pause/stop** — Explicit user actions trigger immediate save (bypasses throttle)
3. **Save on chunk change** — When chunk advances, trigger save (subject to 10s throttle)
4. **Best-effort unload save** — `visibilitychange` + synchronous IDB write attempt

```js
// In popup/side panel
let lastSaveTime = 0;
let lastSavedChunk = -1;
const THROTTLE_MS = 10_000;

function savePosition(force = false) {
  const now = Date.now();
  if (!force && now - lastSaveTime < THROTTLE_MS) {
    return; // Throttled
  }
  if (currentChunkIndex === lastSavedChunk) {
    return; // No change
  }

  // Save full resume data for percentage fallback
  const resumeData = {
    currentChunkIndex,
    charOffset: calculateCharOffset(currentChunkIndex),
    contentLength: totalContentLength,
    lastReadAt: now
  };

  updateLibraryItemPosition(itemId, resumeData);
  lastSaveTime = now;
  lastSavedChunk = currentChunkIndex;
}

function onChunkChange(newChunkIndex) {
  currentChunkIndex = newChunkIndex;
  savePosition(); // Throttled
}

function onPauseOrStop() {
  savePosition(true); // Force immediate save
}

// Best-effort unload save using visibilitychange
// (more reliable than beforeunload for extensions)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // Attempt synchronous-ish save before context closes
    // IDB transactions started here may complete if browser allows
    savePosition(true);
  }
});
```

**Why visibilitychange instead of beforeunload + sendBeacon:**
- `sendBeacon` sends HTTP requests to URLs — extensions have no HTTP endpoint to receive them
- `beforeunload` in extension contexts (popup, side panel) fires too late and unreliably
- `visibilitychange` fires earlier when popup/tab loses focus, giving more time for IDB write
- Still not guaranteed, but more likely to complete than `beforeunload`

**Accepted data loss:**
- Worst case: up to 10s of progress if UI closes unexpectedly between saves
- Mitigated by: chunk-change saves (throttled), pause/stop saves, and `visibilitychange` handler
- This is acceptable for a reading position; users can easily find their place

**Why not offscreen:**
- The existing `offscreen` permission is justified for TTS audio playback
- Using it for autosave timers would require a separate justification Chrome may reject
- The complexity/benefit ratio doesn't justify it
- Future consideration: if MV3 introduces better background persistence, revisit

---

### IDB Error Handling & Recovery

IndexedDB can fail due to quota, corruption, or browser restrictions.

**Error classification:**
| Error | Cause | Recovery |
|-------|-------|----------|
| `QuotaExceededError` | Storage full | Notify user, block save |
| `InvalidStateError` | DB closed unexpectedly | Reopen connection |
| `AbortError` | Transaction aborted | Retry once |
| `NotFoundError` | Missing store/index | Version mismatch or corruption — see tiered handling below |
| `UnknownError` / corruption | Browser bug, disk issue | Corruption — prompt DB reset (see below) |

**Retry strategy:**
- Transient errors (`AbortError`, `InvalidStateError`): retry up to 3× with exponential backoff (100ms, 200ms, 400ms)
- Persistent errors: fail fast, show error UI, log to console
- Never retry `QuotaExceededError` (not transient)

**NotFoundError tiered handling:**
`NotFoundError` can occur from version mismatch (e.g., code expects store/index that requires a higher DB version) or genuine corruption. Tiered recovery avoids destructive resets for recoverable cases:

1. **Detect version mismatch:** Compare `db.version` against code's expected version
   - If `db.version < expectedVersion`: close connection, reopen with `expectedVersion` to trigger `onupgradeneeded`
   - This handles: extension update before DB upgrade, failed previous upgrade
2. **Retry after upgrade:** If `onupgradeneeded` completes successfully, retry the original operation
3. **Corruption detection:** If `NotFoundError` persists after version matches (or `onupgradeneeded` fails), treat as corruption
4. **Corruption recovery:** Only then prompt user for DB reset

```js
async function handleNotFoundError(error, expectedVersion) {
  const db = await openDB('library-db');
  if (db.version < expectedVersion) {
    db.close();
    // Reopen triggers onupgradeneeded
    return openDB('library-db', expectedVersion);
  }
  // Version matches but store missing = corruption
  throw new CorruptionError('Schema corruption detected');
}
```

**Corruption handling (only after version mismatch ruled out):**
- If `NotFoundError` persists after upgrade attempt, or repeated `UnknownError`, treat as corruption
- Prompt user: "Library database corrupted. Reset library? (This deletes all saved items.)"
- On confirmation, call `indexedDB.deleteDatabase('library-db')` and reinitialize
- Future: export before reset if possible

**Connection management:**
- Keep single connection open per context (popup, side panel)
- Close connection on context unload to avoid locks
- Handle `onversionchange` event to close and notify user if another tab upgrades DB

---

### Context Menu: Permissions & User Gesture Constraints

The "Save to Library" context menu requires specific manifest permissions and respects Chrome's user gesture requirements.

**Required manifest permissions:**
```json
{
  "permissions": ["contextMenus"],
  "host_permissions": ["<all_urls>"]
}
```
- `contextMenus` — required to create right-click menu items; **verified present** in `src/manifest.json` line 6
- `host_permissions` with `<all_urls>` — **verified present** in `src/manifest.json` line 13

**Permission verification (2026-01-27):**
Checked `src/manifest.json`:
- Line 6: `"permissions": ["offscreen", "storage", "activeTab", "scripting", "contextMenus", "notifications"]`
- Line 13: `"<all_urls>"` in `host_permissions` array

**User impact analysis for `<all_urls>`:**
This permission was already present before Phase 7 (required for content script injection and TTS extraction on any page). The library feature does NOT expand permission scope:
- Same pages accessible: all URLs (already granted)
- Same capabilities used: content script injection, page content access
- No new permission prompts: users who installed the extension already consented

**Alternative considered (activeTab-only):**
Using `activeTab` instead of `<all_urls>` would require user gesture per page, which conflicts with:
- Library re-extraction (needs to access saved URLs without fresh user gesture)
- Background content script injection for extraction

Since `<all_urls>` is already present and justified by core TTS functionality, no permission change is needed for Phase 7

**Menu registration:**
- Register menu in `chrome.runtime.onInstalled` listener, NOT top-level scope
- Top-level code runs on every SW wake (not just install), which would cause duplicate creation errors
- Use a fixed `id` parameter in `chrome.contextMenus.create()` for idempotency:
```js
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-library',  // fixed ID prevents duplicates
    title: 'Save to Library',
    contexts: ['page']
  });
});
```
- The `onInstalled` listener fires on install, update, and Chrome update — sufficient for menu setup
- Menu appears on all pages; handler checks if page is extractable before proceeding
- Context: `["page"]` — only show on page background, not on links/images

**User gesture flow:**
1. User right-clicks → selects "Save to Library" (user gesture satisfied)
2. Service worker receives `chrome.contextMenus.onClicked`
3. SW sends message to content script to extract content
4. Content script extracts and returns text
5. SW saves to library via `library-storage` module
6. SW shows notification or badge update

**Constraints:**
- No permission prompt for `contextMenus` — it's a "silent" permission
- Extraction still requires content script injection (existing `scripting` permission)
- If page blocks content scripts (CSP), show error toast instead of failing silently

---

## Auto-Discuss Metadata

- **Rounds:** 3
- **Codex Available:** yes
- **Uncertainties Resolution:** none
- **Timestamp:** 2026-01-27T10:35:16Z

<details>
<summary>Codex Review (Round 2)</summary>

**Findings**
- Biggest risk: storing full `content` inside the same `items` object store will make list queries load large blobs; this can stall UI and hit quota sooner. Consider separating metadata vs. content in distinct stores.
- Resume safety: chunk-index-only resumes can break if chunking changes, or if text normalization changes; needs a versioned chunking scheme or a more stable position key.
- Autosave trigger: relying on popup/tab close events in MV3 is unreliable; without periodic saves you can lose position.

**Decision Review**
1. [QUESTION] Mixing `idb-keyval` and raw IndexedDB adds complexity; I’d use raw IndexedDB for the whole library (indexes + larger payloads) and keep `idb-keyval` only for simple caches.
2. [QUESTION] Service worker CRUD is fine, but MV3 SW can be suspended; consider a shared `library-storage` module callable from popup/side panel directly to avoid wakeups for simple reads.
3. [AGREE] Unified schema is good; add `language`, `sourceUrl` (if different from `url`), `extractedAt`, and `chunkingVersion` as optional fields.
4. [QUESTION] Chunk index is OK, but add `chunkingVersion` or a `charOffset`/`snippet` fallback to avoid mis-resume after algo changes.
5. [QUESTION] Pause/stop is good, but close events are unreliable; prefer autosave on `currentChunkIndex` change or every N seconds during playback.
6. [UNCERTAIN] Tags + folders may be too much UI for Phase 7; product call. If time-boxed, ship folders only and defer tags.
7. [AGREE] Minimal folder schema is fine; optional `updatedAt` if you want sorting by recency later.
8. [SUGGEST] Popup save after extraction is right; floating player button is nice but optional. Consider adding a context-menu “Save to Library” for webpages.
9. [AGREE] Popup minimal list now, full UI in side panel later makes sense.
10. [SUGGEST] Dedup by content hash is fine, but also index by `url` for faster “already saved” detection; compute hash off main thread.
11. [QUESTION] Storing full text only is OK for playback, but watch quota; if you keep full text, consider compression or chunked storage.
12. [AGREE] Message types fit existing pattern; add `FOLDER_UPDATE` and `LIBRARY_SEARCH` if you need them soon.
13. [AGREE] Resume flow is correct; ensure chunking uses same settings as when saved.
14. [QUESTION] Add indexes for `lastReadAt`, `contentHash`, and `url`; consider splitting into `items` (metadata) + `contents` store to avoid loading huge text on list queries.
15. [AGREE] Dedicated `library-storage` module is the right abstraction.

**Gaps Claude Missed**
- IDB versioning/migrations strategy.
- Quota handling and UX for storage-full scenarios.
- Metadata/content split to keep list queries fast.
- Chunking/versioning strategy for stable resume.
- Autosave cadence and throttling to avoid IDB write storms.
- Import/export or backup (even if deferred, note it).
- Error handling and retry strategy for IDB failures.

If you want, I can turn these into explicit acceptance criteria for Phase 7.

</details>
