# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-27)

**Core value:** Read any text on the web or in documents with high-quality local TTS that works offline and keeps all data private.
**Current focus:** Phase 3 - Content Extraction (In Progress)

## Current Position

Phase: 3 of 8 (Content Extraction)
Plan: 1 of 4 in current phase
Status: In progress
Last activity: 2026-01-27 - Completed 03-01-PLAN.md (Content Extraction Foundation)

Progress: [#########-] ~28% (9/~32 plans estimated)

## Performance Metrics

**Velocity:**
- Total plans completed: 9
- Average duration: 3.3 min
- Total execution time: 30 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-tts-engine | 4 | 16 min | 4 min |
| 02-basic-playback | 4 | 12 min | 3 min |
| 03-content-extraction | 1 | 2 min | 2 min |

**Recent Trend:**
- Last 5 plans: 2 min, 2 min, 3 min, 5 min, 2 min
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

### Pending Todos

None.

### Blockers/Concerns

**From Research:**
- kokoro-js API stability (library is relatively new)
- Device performance variability (test on low-end devices in Phase 1) - ADDRESSED
- Chrome Web Store review policies for 92MB CDN download (verify in Phase 1) - TO VERIFY

## Session Continuity

Last session: 2026-01-27T06:41:14Z
Stopped at: Completed 03-01-PLAN.md (Content Extraction Foundation)
Resume file: None

---
*Next action: Continue Phase 3 with 03-02 (Context Menu Integration)*
