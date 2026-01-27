---
phase: 02-basic-playback
plan: 02
subsystem: tts
tags: [intl-segmenter, text-chunking, sentence-splitting, base64-audio]

# Dependency graph
requires:
  - phase: 02-01
    provides: PlaybackState module, message types for playback control
  - phase: 01-tts-engine
    provides: TTSEngine for audio generation
provides:
  - Sentence-level text chunking with Intl.Segmenter
  - Chunk-based TTS generation in offscreen document
  - PlaybackState populated with chunks for orchestration
affects: [02-03, 02-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Intl.Segmenter for locale-aware sentence boundaries"
    - "Base64-encoded audio transfer (cross-origin compatible)"
    - "Generation tokens for session tracking"

key-files:
  created:
    - src/lib/text-chunker.ts
  modified:
    - src/offscreen/offscreen.ts
    - src/background/service-worker.ts

key-decisions:
  - "Intl.Segmenter for sentence splitting (not regex) - handles abbreviations correctly"
  - "Base64 audio data instead of blob URLs for cross-origin content script playback"
  - "MAX_CHUNK_LENGTH=500 fallback for texts without punctuation"

patterns-established:
  - "splitIntoChunks(text, locale?) for sentence segmentation"
  - "TTS_GENERATE returns chunks array, TTS_GENERATE_CHUNK for single chunk audio"
  - "Locale fallback chain: provided -> navigator.language -> 'en'"

# Metrics
duration: 2min
completed: 2026-01-27
---

# Phase 02 Plan 02: Text Chunking Summary

**Sentence-level text chunking with Intl.Segmenter and chunk-based TTS generation for skip/progress tracking**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-27T05:41:08Z
- **Completed:** 2026-01-27T05:43:21Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Created text-chunker module using Intl.Segmenter for proper sentence boundaries
- Refactored offscreen document to split text and generate single chunks
- Updated service worker to store chunks in PlaybackState with generation tokens
- Established base64 audio transfer pattern for cross-origin compatibility

## Task Commits

Each task was committed atomically:

1. **Task 1: Create text chunking module with Intl.Segmenter** - `5f09d21` (feat)
2. **Task 2: Refactor offscreen for chunk-based generation** - `ad808f4` (feat)
3. **Task 3: Update service worker for chunk orchestration** - `f572b37` (feat)

## Files Created/Modified
- `src/lib/text-chunker.ts` - Sentence splitting with Intl.Segmenter, MAX_CHUNK_LENGTH fallback
- `src/offscreen/offscreen.ts` - TTS_GENERATE returns chunks, TTS_GENERATE_CHUNK generates single chunk as base64
- `src/background/service-worker.ts` - Stores chunks in PlaybackState, generateChunk helper for orchestration

## Decisions Made
- Used Intl.Segmenter instead of regex for sentence splitting - handles abbreviations like "Dr.", "U.S." correctly
- Return base64-encoded audio data instead of blob URLs - blob URLs are origin-bound and cannot be loaded by content scripts
- MAX_CHUNK_LENGTH=500 characters as fallback for texts without sentence-ending punctuation
- Locale fallback chain: provided locale -> navigator.language -> 'en'

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Text chunking ready for use by content script audio player (Plan 03)
- Chunk generation produces base64 audio data for cross-origin playback
- PlaybackState stores chunks with generation tokens for skip/progress tracking
- Full orchestration loop (generate -> play -> advance) to be implemented in Plan 03

---
*Phase: 02-basic-playback*
*Completed: 2026-01-27*
