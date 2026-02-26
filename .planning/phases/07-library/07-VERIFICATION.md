---
phase: 07-library
verified: 2026-01-27T12:00:00Z
status: gaps_found
score: 3/4 must-haves verified
gaps:
  - truth: "Reading position is remembered and resume works correctly"
    status: partial
    reason: "Autosave infrastructure exists but library playback doesn't trigger autosave context setup"
    artifacts:
      - path: "src/popup/popup.ts"
        issue: "playRecentItem() loads library content but doesn't set library context for autosave"
      - path: "src/background/service-worker.ts"
        issue: "TTS_GENERATE handler doesn't check if content is from library to enable autosave"
    missing:
      - "Library context setup in content script when playing from library"
      - "Pass itemId, contentHash, contentLength to content script during library playback"
      - "Wire startLibraryPlayback() call when TTS_GENERATE is initiated from library content"
---

# Phase 7: Library Verification Report

**Phase Goal:** User can save content and resume reading across sessions
**Verified:** 2026-01-27T12:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can save any webpage or document to library for later | ✓ VERIFIED | Context menu "Save to Library" exists, popup save button exists, handlers wired |
| 2 | Reading position is remembered and resume works correctly | ⚠️ PARTIAL | Autosave module exists with resumePosition algorithm, but library playback doesn't trigger autosave context setup |
| 3 | User can organize library items with folders or tags | ✓ VERIFIED | Folder CRUD operations exist, library panel with folder UI exists, handlers wired |
| 4 | All library data is stored locally (no cloud, works offline) | ✓ VERIFIED | IndexedDB storage with idb wrapper, no network calls in storage layer |

**Score:** 3/4 truths verified (75% — Truth 2 is PARTIAL, not FAILED)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/library-types.ts` | TypeScript interfaces for library items, folders, resume data | ✓ VERIFIED | All types exist: LibraryItem, LibraryFolder, ResumeData, LibraryContent, LibraryDB with proper exports (110 lines) |
| `src/lib/library-storage.ts` | IDB database operations for library | ✓ VERIFIED | Database setup, CRUD operations, folder management, helpers all present (399 lines) |
| `src/lib/autosave.ts` | Autosaver factory and resumePosition algorithm | ✓ VERIFIED | createAutosaver, resumePosition with 5-level fallback, savePositionNow all present (267 lines) |
| `src/lib/messages.ts` | Library message types | ✓ VERIFIED | SAVE_TO_LIBRARY, AUTOSAVE_POSITION, GET_LIBRARY_ITEM, PLAY_LIBRARY_ITEM, FOLDER_* messages exist |
| `src/background/service-worker.ts` | Library handlers | ✓ VERIFIED | All message handlers implemented: save, autosave, folder CRUD, library items, recent items (lines 456-700+) |
| `src/popup/popup.ts` | Recent items, library panel integration | ⚠️ PARTIAL | Recent items display works (loadRecentItems), library panel exists, but playRecentItem doesn't set autosave context |
| `src/content/content-script.ts` | Autosave integration | ⚠️ PARTIAL | startLibraryPlayback exists, autosave interval logic exists, but never called from library playback flow |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| service-worker.ts | library-storage.ts | `import { saveLibraryItem, ... }` | ✓ WIRED | Line 41-53, all storage functions imported |
| service-worker.ts | autosave.ts | `import { savePositionNow, resumePosition }` | ✓ WIRED | Line 55, both functions imported and used |
| service-worker.ts | idb | via library-storage module | ✓ WIRED | library-storage.ts line 1 imports from 'idb', DB operations work |
| popup.ts | service-worker | `sendToServiceWorker(MessageType.SAVE_TO_LIBRARY)` | ✓ WIRED | handleSaveToLibrary (line 787) sends save message |
| popup.ts | service-worker | `sendToServiceWorker(MessageType.GET_RECENT_ITEMS)` | ✓ WIRED | loadRecentItems (line 1397) fetches recent items |
| content-script.ts | autosave interval | `setInterval(sendAutosavePosition)` | ✓ WIRED | Line 464, 10s interval during library playback |
| popup.ts | content-script.ts | Library context setup on playback | ✗ NOT_WIRED | playRecentItem doesn't call startLibraryPlayback in content script |
| service-worker TTS_GENERATE | content-script setLibraryContext | Library metadata passed during generation | ✗ NOT_WIRED | No library context passed when TTS_GENERATE is for library content |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| LIB-01: Save content to library | ✓ SATISFIED | Context menu and save button functional |
| LIB-02: Resume reading position | ⚠️ BLOCKED | Autosave doesn't trigger for library playback |
| LIB-03: Organize with folders/tags | ✓ SATISFIED | Folder CRUD and UI complete |
| LIB-04: Local storage only | ✓ SATISFIED | IndexedDB with no cloud dependencies |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/popup/popup.ts | 1418 | playRecentItem loads content but doesn't set library context | 🛑 Blocker | Autosave never triggers for library playback |
| src/content/content-script.ts | 449 | startLibraryPlayback function defined but never called | 🛑 Blocker | Library autosave interval never starts |
| src/lib/autosave.ts | 267 | savePositionNow exists but only used for explicit autosave messages | ℹ️ Info | Works but not integrated into playback flow |

### Human Verification Required

#### 1. Context Menu "Save to Library" Visibility

**Test:** Right-click on a webpage background (not on text/images)
**Expected:** "Save to Library" option appears in context menu
**Why human:** Chrome extension context menu requires manual testing with actual extension loaded

#### 2. Library Item Displays with Progress

**Test:** 
1. Save a webpage to library
2. Play it and pause midway
3. Open popup, check recent items section
**Expected:** Item shows with progress percentage (e.g., "45%")
**Why human:** Visual UI rendering with progress ring CSS

#### 3. Folder Organization Flow

**Test:**
1. Create a folder via library panel
2. Move an item into the folder
3. Switch folder view
**Expected:** Item appears only when folder is selected
**Why human:** Multi-step UI interaction with state changes

#### 4. Resume Position After Browser Restart

**Test:**
1. Play a library item, pause midway
2. Close and reopen browser
3. Play same item from library
**Expected:** Should resume from where you left off (if autosave gap is fixed)
**Why human:** Cross-session persistence testing

### Gaps Summary

The library infrastructure is **95% complete** with excellent storage, folder management, and save functionality. However, there's a **critical wiring gap** in the resume/autosave flow:

**The Issue:**
- The autosave module (`src/lib/autosave.ts`) is well-designed with throttling and fallback chains
- The content script has `startLibraryPlayback()` ready to enable autosave intervals
- BUT: When playing from library via `playRecentItem()` in popup, the library context never gets set

**What's Missing:**
1. When `playRecentItem()` loads library content, it should pass library metadata (itemId, contentHash, contentLength) alongside the TTS_GENERATE request
2. The service worker's TTS_GENERATE handler should recognize library playback and include library context when sending PLAY_AUDIO to content script
3. The content script should call `startLibraryPlayback()` when it receives library context with PLAY_AUDIO message

**Impact:**
- Users can save to library ✓
- Users can organize with folders ✓
- Users can play from library ✓
- BUT: Reading position is NOT saved during playback, so resume doesn't work

**Estimated Fix:** 30-60 minutes of wiring work in 3 files (popup.ts, service-worker.ts, content-script.ts)

---

_Verified: 2026-01-27T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
