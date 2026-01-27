---
phase: 04-text-highlighting
plan: 05
subsystem: playback
tags: [highlighting, tts, service-worker, message-routing, chunking]

# Dependency graph
requires:
  - phase: 04-04
    provides: INIT_HIGHLIGHTING message type, chunkIndex in PLAY_AUDIO
provides:
  - Highlighting-aware TTS generation flow
  - DOM-aligned chunk extraction via content script
  - Fallback chunking when highlighting unavailable
affects: [05-enhancements, 06-settings]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Highlighting-first chunking with fallback pattern
    - Service worker as TTS orchestrator (not forwarding)

key-files:
  created: []
  modified:
    - src/background/service-worker.ts

key-decisions:
  - "TTS_GENERATE handled directly in service worker (not forwarded to offscreen)"
  - "INIT_HIGHLIGHTING sent to content script before TTS playback"
  - "Fallback to splitIntoChunks if highlighting initialization fails"
  - "Highlighting mode determined from pendingExtraction.source"

patterns-established:
  - "Highlighting-first TTS flow: extract -> init highlighting -> get DOM-aligned chunks -> play"

# Metrics
duration: 3min
completed: 2026-01-27
---

# Phase 04 Plan 05: Flow Integration Summary

**Service worker handles TTS_GENERATE directly to integrate highlighting initialization with DOM-aligned chunk extraction and fallback support.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-27T08:00:41Z
- **Completed:** 2026-01-27T08:04:16Z
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- TTS_GENERATE now handled in service worker (not forwarded to offscreen)
- Service worker sends INIT_HIGHLIGHTING to content script before playback
- Chunks returned from highlighting are DOM-aligned for accurate highlighting
- Fallback to `splitIntoChunks` when content script unavailable or highlighting fails
- startPlaybackWithChunks helper centralizes playback initialization logic

## Task Commits

Each task was committed atomically:

1. **Task 1: Verify INIT_HIGHLIGHTING message type exists** - (no commit - verification only, type already existed from 04-04)
2. **Task 2: Update service worker for highlighting-aware TTS flow** - `8c4f54d` (feat)
3. **Task 3: Build verification and import validation** - (no commit - verification only)

**Plan metadata:** (to be committed with this summary)

## Files Created/Modified

- `src/background/service-worker.ts` - Added TTS_GENERATE handler with highlighting integration, startPlaybackWithChunks helper

## Decisions Made

1. **TTS_GENERATE handled directly in service worker** - Instead of forwarding to offscreen, service worker now orchestrates highlighting initialization and chunk extraction
2. **INIT_HIGHLIGHTING sent before playback** - Ensures DOM spans are created and aligned with TTS chunks before audio generation begins
3. **Highlighting mode from extraction source** - `pendingExtraction.source === 'article'` triggers overlay mode; selection triggers selection mode
4. **Fallback chunking** - If content script communication fails or highlighting initialization fails, use `splitIntoChunks` from text-chunker module

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 04 (Text Highlighting) complete
- All 5 plans executed successfully
- Full flow operational: extract -> highlight init -> TTS generate -> play with highlights
- Ready for Phase 05 (Enhancements) or milestone verification

---
*Phase: 04-text-highlighting*
*Completed: 2026-01-27*
