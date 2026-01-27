# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-27)

**Core value:** Read any text on the web or in documents with high-quality local TTS that works offline and keeps all data private.
**Current focus:** v1 Milestone Complete

## Current Position

Phase: 8 of 8 (Side Panel Polish) - MILESTONE COMPLETE
Plan: 7 of 7 in current phase
Status: v1 milestone complete - all 8 phases finished
Last activity: 2026-01-27 - Completed Phase 8 with verification

Progress: [###################################] 100% (40/40 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 40
- Average duration: 2.7 min
- Total execution time: 109 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-tts-engine | 4 | 16 min | 4 min |
| 02-basic-playback | 4 | 12 min | 3 min |
| 03-content-extraction | 4 | 9 min | 2.25 min |
| 04-text-highlighting | 5 | 12 min | 2.4 min |
| 05-floating-player | 5 | 12 min | 2.4 min |
| 06-document-support | 5 | 11 min | 2.2 min |
| 07-library | 5 | 17 min | 3.4 min |
| 08-side-panel-polish | 7 | 17 min | 2.4 min |

**Recent Trend:**
- Last 5 plans: 4 min, 3 min, 2 min, 2 min, 3 min
- Trend: stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- (01-01) Used Vite 5.x instead of 7.x for CRXJS compatibility
- (01-01) Set root to src/ for cleaner project structure
- (01-01) Added offscreen as explicit rollup input
- (01-02) Service worker is pure router, all TTS logic in offscreen document
- (01-02) Used intersection type for RoutableMessage (TTSMessage is union)
- (01-03) Defined VOICE_IDS const array for type-safe voice IDs (kokoro-js VOICES not exported)
- (01-03) Single-threaded WASM (numThreads=1) to avoid cross-origin isolation issues
- (01-03) WASM files copied to dist/assets/ via vite-plugin-static-copy
- (01-04) Grade A voices shown first with '(High Quality)' indicator
- (01-04) Messages routed through service worker to prevent duplicate handling
- (01-04) Safe DOM manipulation using removeChild/appendChild instead of innerHTML
- (02-01) In-memory state resets on service worker restart (acceptable per CONTEXT.md)
- (02-01) PlaybackSpeed persisted to chrome.storage.local for user preference
- (02-01) Base64-encoded audio data for cross-context transfer (blob URLs are origin-bound)
- (02-01) Generation token pattern for matching messages to active sessions
- (02-02) Intl.Segmenter for sentence splitting (not regex) - handles abbreviations correctly
- (02-02) MAX_CHUNK_LENGTH=500 fallback for texts without punctuation
- (02-02) Locale fallback chain: provided -> navigator.language -> 'en'
- (02-03) Audio plays in content script to inherit page's Media Engagement Index
- (02-03) 2-second heartbeat interval for liveness detection
- (02-03) User-friendly autoplay error message guides recovery
- (02-04) Route TTS_GENERATE to service worker for proper playback orchestration
- (02-04) Focus guard pattern: keyboard shortcuts disabled when textarea focused
- (02-04) STATUS_UPDATE/AUDIO_ERROR message handling for UI synchronization
- (03-01) Used @mozilla/readability (not @plumalab/readability which doesn't exist)
- (03-01) MutationObserver for SPA stabilization: 300ms inactivity, 3s max wait
- (03-01) MIN_CONTENT_LENGTH=100 chars for valid article extraction
- (03-02) Store extraction results in chrome.storage.session.pendingExtraction
- (03-02) Show notification after extraction since popup cannot be opened programmatically
- (03-02) Use 48x48 blue circle as placeholder icon for notifications and toolbar
- (03-03) 10s extraction timeout prevents content script from hanging under MV3 30s limit
- (03-03) ExtractionResult includes source field ('selection' | 'article') for context
- (03-04) chrome.runtime.connect() port keeps SW alive during extraction
- (03-04) 15s popup timeout (content script has 10s internal timeout)
- (03-04) 5-minute expiry for pending extractions in session storage
- (03-04) storePendingExtraction() shared between popup-close fallback and context menu
- (04-01) Added Intl.Segmenter type declarations (ES2022 lib not loading properly)
- (04-01) Updated tsconfig.json with ES2022 lib for Intl support
- (04-01) 3-second user scroll debounce before auto-scroll resumes
- (04-02) Overlay container uses fixed positioning with max z-index
- (04-02) textContent and DOM methods (no innerHTML) for XSS prevention
- (04-02) Close button dispatches custom event for cleanup coordination
- (04-03) DOM text node walking via TreeWalker (NOT selection.toString())
- (04-03) Cumulative offset map for accurate sentence boundary mapping
- (04-03) splitText() calls tracked in SplitNodeRecord for DOM restoration
- (04-04) chunkIndex passed in PLAY_AUDIO for event-driven highlighting
- (04-04) INIT_HIGHLIGHTING message initializes mode before playback
- (04-04) Mode-specific cleanup (selection unwrap vs overlay remove)
- (04-05) TTS_GENERATE handled directly in service worker (not forwarded to offscreen)
- (04-05) INIT_HIGHLIGHTING sent to content script before TTS playback
- (04-05) Fallback to splitIntoChunks if highlighting initialization fails
- (05-01) Shadow DOM closed mode for security (page scripts cannot access internal state)
- (05-01) Fixed bottom-right position with max z-index (2147483647)
- (05-01) Inline styles with :host { all: initial } for complete CSS isolation
- (05-01) Player starts hidden, shows on first PLAY_AUDIO
- (05-02) Speed control cycles through presets on click (0.75 -> 2.0 -> 0.75)
- (05-02) Dismiss button sends STOP_PLAYBACK to service worker
- (05-02) Progress "X / Y" format, Speed "X.Xx" format
- (05-02) Focus-scoped keyboard shortcuts (Space, Escape, Arrows)
- (05-03) SW owns authoritative state, content script holds derived/cached copy
- (05-03) GET_STATUS returns explicit boolean fields for UI sync (isPlaying, isPaused, isGenerating)
- (05-03) Content script requests initial state on load for page refresh sync
- (05-04) Dismiss hides player without stopping playback (per CONTEXT.md decision [7])
- (05-04) playerDismissed state resets on stop or idle status
- (05-04) Show Player button in popup restores dismissed floating player
- (05-04) Overlay close triggers STOP_PLAYBACK to service worker
- (05-05) tabs.onUpdated marks state as 'paused' on hard navigation (audio destroyed)
- (05-05) tabs.onRemoved resets playback state when active tab closes
- (05-05) GET_TAB_ID utility message for content script tab verification
- (05-05) Rehydration creates player only if this tab is activeTabId with valid chunks
- (06-01) Single EXTRACT_DOCUMENT message type with documentType field per CONTEXT.md
- (06-01) Document types defined in document-types.ts, re-exported from messages.ts
- (06-01) OffscreenHandledMessage union type extends handler for document messages
- (06-02) External PDF.js worker with inline fallback for memory isolation
- (06-02) PDF text normalization: spacing, hyphenation, whitespace collapse
- (06-02) Early page count warning triggers after metadata load, before extraction
- (06-02) AbortSignal support for PDF extraction cancellation
- (06-03) BOM-based encoding detection for UTF-8 and UTF-16
- (06-03) Text normalization: CRLF -> LF, remove null chars, collapse excess blank lines
- (06-03) extractTextFile returns encoding type in result for debugging/display
- (06-04) File size checked via file.size BEFORE file.arrayBuffer() to avoid memory allocation
- (06-04) Chunked upload uses file.slice() for files > 10 MB per CONTEXT.md Decision #2
- (06-04) Progress UI shows upload phase (0-50%) and extraction phase (50-100%)
- (06-05) Chunk storage in offscreen IndexedDB, not SW memory (per CONTEXT.md Decision #2)
- (06-05) Promise resolver pattern for early page count warnings
- (06-05) 5-minute timeout auto-cancels pending warnings
- (06-05) WARNING_RESPONSE handles both page count and text length warnings
- (07-01) by-folderId index type is string (not string|null) - root items filtered in JS
- (07-03) Dynamic import for library-storage in savePositionNow avoids circular deps
- (07-03) Resume fallback chain: exact -> charOffset -> snippet -> percentage -> beginning
- (07-03) Autosave triggers: 10s interval during play, immediate on pause/stop/beforeunload
- (07-02) Context menu save extracts content inline rather than showing popup
- (07-02) Save button disabled (not hidden) after save to show content is saved
- (07-02) Quota check includes 5MB buffer before save
- (07-05) Recent items use safe DOM methods (createElement/appendChild) per project patterns
- (07-05) Click recent item auto-plays after loading content from library
- (08-01) Keep popup as default action, side panel opened via explicit button (per CONTEXT.md Decision #8)
- (08-01) Side panel tab structure with Library and Settings sections
- (08-01) Dark mode toggle with persistence to chrome.storage.local
- (08-01) Safe DOM manipulation using createElement/appendChild (no innerHTML)
- (08-02) CSS variables defined in theme.css, imported by shared.css
- (08-02) System dark mode via @media (prefers-color-scheme: dark)
- (08-02) .dark-mode class on root for explicit toggle, .light-mode escape hatch
- (08-02) CSS import chain: component.css -> shared.css -> theme.css
- (08-03) Settings stored in consolidated 'settings' key in chrome.storage.local
- (08-03) Migration runs once on service worker load, deletes legacy keys after migration
- (08-03) ShortcutBindings interface for in-panel keyboard shortcuts (not global Chrome shortcuts)
- (08-04) Shared library-list.ts component extracted to src/lib/ui/ per CONTEXT.md Decision #9
- (08-04) Library state (folders, items, currentFolderId, selectedItemId) managed in side panel
- (08-04) sendToServiceWorker helper for consistent message passing to service worker
- (08-05) Voice dropdown shows Grade A voices first with "High Quality" indicator
- (08-05) Theme toggle uses settings-storage module for persistence
- (08-05) Shortcuts displayed read-only with link to chrome://extensions/shortcuts
- (08-05) Voice preview button placeholder for 08-06 implementation
- (08-06) Base64 audio encoding for cross-context transfer (same pattern as TTS playback)
- (08-06) Fixed preview text: "This is the {VoiceName} voice."
- (08-06) Cancel previous preview before starting new one
- (08-07) Hamburger menu icon for side panel button (consistent with mobile patterns)
- (08-07) Popup closes after opening side panel (cleaner UX)
- (08-07) Storage listener for real-time theme updates

### Pending Todos

None.

### Blockers/Concerns

**From Research:**
- kokoro-js API stability (library is relatively new)
- Device performance variability (test on low-end devices in Phase 1) - ADDRESSED
- Chrome Web Store review policies for 92MB CDN download (verify in Phase 1) - TO VERIFY

## Session Continuity

Last session: 2026-01-27T13:04:06Z
Stopped at: Completed 08-06-PLAN.md (Voice Preview) - Phase 8 Complete
Resume file: None

---
*v1 Milestone Complete. All 8 phases finished and verified. Ready for milestone audit.*
