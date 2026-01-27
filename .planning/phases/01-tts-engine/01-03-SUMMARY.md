---
phase: 01-tts-engine
plan: 03
subsystem: tts
tags: [kokoro-js, onnxruntime-web, transformers.js, wasm, indexeddb, audio-playback]

# Dependency graph
requires:
  - phase: 01-02
    provides: Offscreen document lifecycle, service worker message routing
provides:
  - Kokoro TTS singleton engine with model loading and progress tracking
  - Audio generation and playback in offscreen document
  - Voice selection persistence via chrome.storage.local
  - Model cache status tracking via IndexedDB
  - WASM file bundling for ONNX Runtime
affects: [01-04]

# Tech tracking
tech-stack:
  added: [vite-plugin-static-copy]
  patterns: [singleton pattern for model loading, progress callback forwarding, audio URL lifecycle management]

key-files:
  created:
    - src/lib/tts-engine.ts
    - src/lib/voice-storage.ts
    - src/lib/model-cache.ts
  modified:
    - vite.config.ts
    - src/offscreen/offscreen.ts

key-decisions:
  - "Defined VOICE_IDS const array for type-safe voice IDs (kokoro-js VOICES not exported)"
  - "Single-threaded WASM (numThreads=1) to avoid cross-origin isolation issues"
  - "WASM files copied to dist/assets/ via vite-plugin-static-copy"

patterns-established:
  - "Singleton pattern: TTSEngine.getInstance() with promise caching for concurrent calls"
  - "Progress callback: Forward transformers.js progress to storage and service worker"
  - "Audio cleanup: URL.revokeObjectURL on playback end/error to prevent memory leaks"

# Metrics
duration: 5min
completed: 2026-01-27
---

# Phase 1 Plan 3: TTS Engine Integration Summary

**Kokoro TTS singleton with WASM execution, progress tracking, and audio playback in offscreen document**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-27T04:35:00Z
- **Completed:** 2026-01-27T04:40:00Z
- **Tasks:** 4
- **Files modified:** 5

## Accomplishments
- Kokoro TTS engine loads 92MB q8 model via WASM backend
- Download progress persists to storage and broadcasts to service worker
- Audio generation creates blob and plays via HTMLAudioElement
- Voice selection persists across sessions
- Model caches in IndexedDB for offline support

## Task Commits

Each task was committed atomically:

1. **Task 0: Configure Vite to copy ONNX Runtime WASM files** - `40d59d1` (feat)
2. **Task 1: Create TTS engine singleton wrapper** - `909ebee` (feat)
3. **Task 2: Implement voice storage and model cache utilities** - `d1a3bd9` (feat)
4. **Task 3: Wire up offscreen document with actual TTS engine** - `0fc4884` (feat)

## Files Created/Modified
- `vite.config.ts` - Added vite-plugin-static-copy for WASM files
- `src/lib/tts-engine.ts` - Singleton Kokoro TTS wrapper with getInstance, generate, getVoices
- `src/lib/voice-storage.ts` - getSelectedVoice, setSelectedVoice via chrome.storage.local
- `src/lib/model-cache.ts` - getCacheStatus, setCacheStatus, clearModelCache via idb-keyval
- `src/offscreen/offscreen.ts` - Full TTS init, generate, stop, list-voices, status handlers

## Decisions Made
- **VOICE_IDS const array:** kokoro-js does not export VOICES, so defined local const array with all 28 voice IDs for type safety
- **Single-threaded WASM:** Set ort.env.wasm.numThreads = 1 to avoid cross-origin isolation requirements
- **WASM path prefix:** ort.env.wasm.wasmPaths = chrome.runtime.getURL('assets/') for extension context

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed kokoro-js type mismatches**
- **Found during:** Task 1 (TTS engine singleton)
- **Issue:** kokoro-js types show list_voices() returns void (logs to console), and VOICES is not exported
- **Fix:** Used Object.keys(tts.voices) for voice list, defined local VOICE_IDS const array with type assertions
- **Files modified:** src/lib/tts-engine.ts
- **Verification:** npx tsc --noEmit passes
- **Committed in:** 909ebee (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix for type compatibility)
**Impact on plan:** Minor type workaround for library quirk. No scope creep.

## Issues Encountered
None - plan executed smoothly after type fixes

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TTS engine ready for popup UI integration (Plan 04)
- Model downloads and caches correctly
- Audio plays through offscreen document
- Progress tracking flows to storage for UI consumption

---
*Phase: 01-tts-engine*
*Completed: 2026-01-27*
