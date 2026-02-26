# Code Review Issues

## Critical Issues

### 1. Dual playback path creates dead code and confusion
- **Files**: `service-worker.ts:791-832`
- **Status**: FIXED
- Removed dead TTS_GENERATE handling from `routeToOffscreen`. It now only forwards non-playback messages (TTS_INIT, TTS_LIST_VOICES, etc.) to offscreen.

### 2. Speed persistence is split between two storage locations
- **Files**: `popup.ts:659`, `settings-storage.ts`
- **Status**: FIXED
- All speed reads/writes now use unified `settings.speed` via `getSettings()`/`updateSettings()`. Removed all legacy `playbackSpeed` key usage from popup.ts and service-worker.ts.

### 3. TypeScript type errors in production code
- **Files**: `settings-storage.ts:69,135`
- **Status**: FIXED
- Cast `stored` to `Partial<Settings>` in `getSettings()`. Added `typeof` guard and explicit cast for `legacy.darkMode` in `migrateSettings()`. `tsc --noEmit` now passes clean.

### 4. Scroll listener memory leak in highlight-manager
- **Files**: `highlight-manager.ts:109-121`
- **Status**: FIXED
- Added `scrollHandler` field to `ScrollContext` interface. `createScrollContext` stores the handler reference, `destroyScrollContext` now properly removes the event listener.

### 5. `void generateChunk` is a no-op lint suppression
- **Files**: `service-worker.ts:1002`
- **Status**: FIXED
- Removed dead `void generateChunk` statement.

## Significant Bugs

### 6. `handlePlayItem` in sidepanel is a TODO stub with `alert()`
- **Files**: `sidepanel.ts:399-419`
- **Status**: FIXED
- Now sends `TTS_GENERATE` to service worker with library content and context for autosave. Shows inline status messages instead of `alert()`. Added `showStatusMessage()` helper.

### 7. Autosave `currentChunks` is always empty
- **Files**: `content-script.ts:117`
- **Status**: FIXED
- Service worker now sends `chunkText` (first 100 chars) in each `PLAY_AUDIO` message. Content script tracks `currentChunkText` from each message instead of relying on a pre-populated chunks array. Removed the `currentChunks` array entirely.

### 8. `StatusUpdateMessage` type doesn't match actual payload
- **Files**: `content-script.ts:575-592`, `messages.ts:169-174`
- **Status**: FIXED
- Added `isGenerating`, `isPaused`, `currentChunkIndex`, `totalChunks`, `playbackSpeed` to `StatusUpdateMessage.status` interface. Removed all unsafe `as` casts from content-script.ts.

### 9. `resetPlaybackState` doesn't preserve speed
- **Files**: `playback-state.ts:72-75`
- **Status**: FIXED
- Now preserves `playbackSpeed` across resets by saving it before spreading `initialState`.

### 10. Extraction port timeout never clears on success
- **Files**: `popup.ts:1056-1058`
- **Status**: FIXED
- Timeout is now stored in `timeoutId` and cleared via `clearTimeout` on both success (message received) and disconnect.

## Architecture & Design Issues

### 11. `formatVoiceName` is duplicated
- **Files**: `popup.ts:468-496`, `sidepanel.ts:658-677`
- **Status**: FIXED
- Extracted `formatVoiceName()` and `GRADE_A_VOICES` to `voice-storage.ts`. Both popup.ts and sidepanel.ts now import from the shared module. Removed local copies.

### 12. `sendToServiceWorker` is duplicated identically
- **Files**: `popup.ts:834-850`, `sidepanel.ts:130-146`
- **Status**: FIXED
- Extracted to `lib/messaging.ts`. Both popup.ts and sidepanel.ts import from the shared module. Removed local copies.

### 13. Grade A voice list is duplicated and hardcoded
- **Files**: `popup.ts:428`, `sidepanel.ts:466`
- **Status**: FIXED
- `GRADE_A_VOICES` constant now lives in `voice-storage.ts` and is imported by both consumers. Fixed as part of Issue #11.

### 14. `<all_urls>` makes specific host_permissions redundant
- **Files**: `manifest.json:8-13`
- **Status**: FIXED
- Removed redundant specific HuggingFace/jsdelivr URLs since `<all_urls>` already covers them. Needed for content script injection on any page.

### 15. Both `idb` and `idb-keyval` packages included
- **Files**: `package.json:28-29`
- **Status**: FIXED
- Replaced `idb-keyval` usage in `model-cache.ts` with `chrome.storage.local` (data was already simple JSON). Removed `idb-keyval` from package.json.

## Minor Issues

### 16. No error boundary on DOM element queries in popup
- **Files**: `popup.ts:22-93`
- **Status**: FIXED
- Added `$()` helper that throws descriptive `Missing DOM element: #id` errors. All DOM queries in popup.ts now go through this helper instead of raw `!` assertions.

### 17. Console logs in production code
- **Files**: `content-script.ts:18`, `offscreen.ts:21`, `sidepanel.ts:15`, `service-worker.ts:84`
- **Status**: FIXED
- Removed startup `console.log` calls from content-script, offscreen, sidepanel, service-worker, and popup.

### 18. `handleRenameFolder` uses `prompt()`, delete uses `confirm()`
- **Files**: `sidepanel.ts:372,383,422`
- **Status**: DEFERRED
- Native `prompt()`/`confirm()` work correctly in extension side panels (unlike content scripts). While custom inline dialogs would be better UX, this is a cosmetic improvement that doesn't affect functionality.

### 19. Base64 encoding is inefficient for large audio
- **Files**: `offscreen.ts:441-443`
- **Status**: FIXED
- Replaced `reduce + String.fromCharCode` pattern (O(n^2) string concatenation) with chunked `arrayBufferToBase64()` helper using 8KB slices. Applied to both chunk generation and voice preview.

### 20. CSP `wasm-unsafe-eval` not documented
- **Files**: `manifest.json:33`
- **Status**: FIXED
- Added `_comment_csp` field in manifest.json explaining why `wasm-unsafe-eval` is required (ONNX Runtime WASM inference for Kokoro TTS).
