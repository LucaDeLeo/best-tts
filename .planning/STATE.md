# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-27)

**Core value:** Read any text on the web or in documents with high-quality local TTS that works offline and keeps all data private.
**Current focus:** Phase 2 - Basic Playback

## Current Position

Phase: 2 of 8 (Basic Playback)
Plan: 3 of 4 in current phase
Status: In progress
Last activity: 2026-01-27 - Completed 02-03-PLAN.md (Content Script Audio Player)

Progress: [#######---] ~22% (7/~32 plans estimated)

## Performance Metrics

**Velocity:**
- Total plans completed: 7
- Average duration: 3 min
- Total execution time: 23 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-tts-engine | 4 | 16 min | 4 min |
| 02-basic-playback | 3 | 7 min | 2 min |

**Recent Trend:**
- Last 5 plans: 5 min, 4 min, 2 min, 2 min, 3 min
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

### Pending Todos

None.

### Blockers/Concerns

**From Research:**
- kokoro-js API stability (library is relatively new)
- Device performance variability (test on low-end devices in Phase 1) - ADDRESSED
- Chrome Web Store review policies for 92MB CDN download (verify in Phase 1) - TO VERIFY

## Session Continuity

Last session: 2026-01-27T05:49:03Z
Stopped at: Completed 02-03-PLAN.md (Content Script Audio Player)
Resume file: None

---
*Next action: Execute 02-04-PLAN.md (Popup Playback Controls)*
