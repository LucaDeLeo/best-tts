---
phase: 01-tts-engine
plan: 02
subsystem: infra
tags: [chrome-extension, mv3, offscreen-document, service-worker, message-passing]

# Dependency graph
requires:
  - phase: 01-01
    provides: MV3 manifest, type-safe message contracts, placeholder entry points
provides:
  - Offscreen document lifecycle management
  - Service worker message routing hub
  - Message passing infrastructure (popup -> SW -> offscreen)
  - Download progress persistence
affects: [01-03, 01-04]

# Tech tracking
tech-stack:
  added: []
  patterns: [offscreen document pattern, message routing with target rewriting, race condition prevention with promise pattern]

key-files:
  created:
    - src/lib/offscreen-manager.ts
  modified:
    - src/background/service-worker.ts
    - src/offscreen/offscreen.ts

key-decisions:
  - "Used intersection type for RoutableMessage since TTSMessage is a union (cannot extend union)"
  - "Service worker is ONLY a message router, all TTS logic stays in offscreen document"
  - "Download progress persisted to storage so popup can show it when reopened"

patterns-established:
  - "Target filtering: each listener checks message.target before handling"
  - "forwardTo pattern: service worker routes messages with forwardTo='offscreen' to offscreen document"
  - "Race condition prevention: creating promise pattern prevents duplicate offscreen document creation"

# Metrics
duration: 3min
completed: 2026-01-27
---

# Phase 01 Plan 02: Service Worker + Offscreen Document Summary

**Message routing infrastructure with offscreen document lifecycle management for WASM TTS execution**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-27T04:25:41Z
- **Completed:** 2026-01-27T04:29:19Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Offscreen document manager with on-demand creation and race condition prevention
- Service worker message hub routing TTS messages to offscreen document
- Offscreen document message handler with placeholder TTS implementations
- Download progress persistence to chrome.storage.local

## Task Commits

Each task was committed atomically:

1. **Task 1: Create offscreen document manager** - `9cb37bb` (feat)
2. **Task 2: Implement service worker message hub** - `fbce25b` (feat)
3. **Task 3: Implement offscreen document message handler** - `146c4f4` (feat)

## Files Created/Modified

- `src/lib/offscreen-manager.ts` - Offscreen document lifecycle management (ensureOffscreenDocument, closeOffscreenDocument, isOffscreenDocumentActive)
- `src/background/service-worker.ts` - Message routing hub with forwardTo pattern for offscreen routing
- `src/offscreen/offscreen.ts` - Message handler with placeholder TTS operations

## Decisions Made

- **Intersection type for RoutableMessage:** TTSMessage is a union type (cannot use `extends`), so used intersection (`TTSMessage & { forwardTo?: 'offscreen' }`)
- **Service worker as pure router:** No TTS processing in service worker - all logic stays in offscreen document where WASM can run
- **Dual reasons for offscreen document:** AUDIO_PLAYBACK + WORKERS prevents Chrome from closing after 30 seconds

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed RoutableMessage type definition**
- **Found during:** Task 2 (Service worker implementation)
- **Issue:** Plan specified `interface RoutableMessage extends TTSMessage` but TTSMessage is a union type which cannot be extended
- **Fix:** Changed to intersection type: `type RoutableMessage = TTSMessage & { forwardTo?: 'offscreen' }`
- **Files modified:** src/background/service-worker.ts
- **Verification:** TypeScript compiles cleanly with `npx tsc --noEmit`
- **Committed in:** fbce25b (part of Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor type fix required for TypeScript correctness. No scope creep.

## Issues Encountered

None - plan executed with one minor type fix.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Message infrastructure complete, ready for TTS engine integration (Plan 03)
- Placeholder handlers in offscreen document ready to be replaced with kokoro-js implementation
- Service worker routing verified to work with offscreen document

---
*Phase: 01-tts-engine*
*Completed: 2026-01-27*
