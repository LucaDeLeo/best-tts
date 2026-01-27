# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-27)

**Core value:** Read any text on the web or in documents with high-quality local TTS that works offline and keeps all data private.
**Current focus:** Phase 5 - Floating Player (In Progress)

## Current Position

Phase: 5 of 8 (Floating Player)
Plan: 3 of 5 in current phase
Status: In progress
Last activity: 2026-01-27 - Completed 05-03-PLAN.md (State Sync)

Progress: [####################] ~62% (20/~32 plans estimated)

## Performance Metrics

**Velocity:**
- Total plans completed: 20
- Average duration: 2.85 min
- Total execution time: 57 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-tts-engine | 4 | 16 min | 4 min |
| 02-basic-playback | 4 | 12 min | 3 min |
| 03-content-extraction | 4 | 9 min | 2.25 min |
| 04-text-highlighting | 5 | 12 min | 2.4 min |
| 05-floating-player | 3 | 8 min | 2.7 min |

**Recent Trend:**
- Last 5 plans: 3 min, 3 min, 2 min, 2 min, 4 min
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

### Pending Todos

None.

### Blockers/Concerns

**From Research:**
- kokoro-js API stability (library is relatively new)
- Device performance variability (test on low-end devices in Phase 1) - ADDRESSED
- Chrome Web Store review policies for 92MB CDN download (verify in Phase 1) - TO VERIFY

## Session Continuity

Last session: 2026-01-27T08:59:00Z
Stopped at: Completed 05-03-PLAN.md (State Sync)
Resume file: None

---
*Next action: Continue with 05-04-PLAN.md (Playback Control Wiring)*
