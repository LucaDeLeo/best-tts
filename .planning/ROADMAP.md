# Roadmap: Best TTS

## Overview

This roadmap delivers a privacy-focused Chrome extension for high-quality text-to-speech using the Kokoro TTS engine running entirely locally. The journey starts with establishing the TTS engine infrastructure (the hardest technical problem), then builds playback controls, content extraction, and text highlighting. Finally, it adds document support, a library system, and polished UI. Each phase delivers a verifiable capability that builds toward a Speechify-quality experience with full offline support.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- 🚧 **v1 Best TTS** Phases 1-8

- [x] **Phase 1: TTS Engine** - Kokoro TTS running in browser via ONNX Runtime Web
- [x] **Phase 2: Basic Playback** - Play/pause, speed control, and keyboard shortcuts
- [x] **Phase 3: Content Extraction** - Read selected text and full webpages
- [x] **Phase 4: Text Highlighting** - Sync text display with audio playback
- [x] **Phase 5: Floating Player** - Mini player UI on any webpage
- [x] **Phase 6: Document Support** - Import and read PDFs and text files
- [x] **Phase 7: Library** - Save, organize, and resume documents
- [x] **Phase 8: Side Panel & Polish** - Full UI, settings, dark mode

## Phase Details

### Phase 1: TTS Engine
**Goal**: User can generate speech from text using Kokoro TTS running entirely in the browser
**Depends on**: Nothing (first phase)
**Requirements**: TTS-01, TTS-02, TTS-03, TTS-04
**Success Criteria** (what must be TRUE):
  1. User can trigger TTS generation for a text string and hear audio output
  2. User can select from at least 3 different Kokoro voices
  3. User sees download progress when models are fetched on first use
  4. TTS works without network connection after initial model download
  5. Models persist in IndexedDB across browser sessions
**Plans**: 4 plans in 4 waves (sequential)

Plans:
- [x] 01-01-PLAN.md — Project setup, manifest, message contracts
- [x] 01-02-PLAN.md — Service worker + offscreen document infrastructure
- [x] 01-03-PLAN.md — TTS engine with Kokoro model loading and playback
- [x] 01-04-PLAN.md — Popup UI for text input, voice selection, controls

**Research**: Completed (01-RESEARCH.md)
**Completed**: 2026-01-27

### Phase 2: Basic Playback
**Goal**: User has full control over audio playback with responsive controls
**Depends on**: Phase 1
**Requirements**: PLAY-01, PLAY-02, PLAY-03, PLAY-04, PLAY-05
**Success Criteria** (what must be TRUE):
  1. User can play, pause, and stop audio with immediate response
  2. User can adjust speed from 0.5x to 4x with audible change
  3. User can skip forward/back by sentence using buttons or keyboard
  4. User sees progress indicator showing current position in content
  5. Keyboard shortcuts work (space=play/pause, arrows=skip, +/-=speed)
**Plans**: 4 plans in 4 waves (sequential)

Plans:
- [x] 02-01-PLAN.md — Message types and PlaybackState in service worker
- [x] 02-02-PLAN.md — Text chunking with Intl.Segmenter and chunk-based generation
- [x] 02-03-PLAN.md — Content script for audio playback with heartbeat
- [x] 02-04-PLAN.md — Popup UI with playback controls and keyboard shortcuts

**Research Flag**: Standard Web Audio patterns, skip research-phase
**Context**: Completed (CONTEXT.md - architecture moved audio playback to content script)
**Completed**: 2026-01-27

### Phase 3: Content Extraction
**Goal**: User can read any webpage content aloud with intelligent text extraction
**Depends on**: Phase 2
**Requirements**: CONT-01, CONT-02
**Success Criteria** (what must be TRUE):
  1. User can select text on any webpage and play it aloud
  2. Extension extracts article content from webpages (bypassing ads, navigation)
  3. Reader mode extraction works on major news/blog sites
  4. Extraction fails gracefully with user-friendly message on complex pages
**Plans**: 4 plans in 4 waves (sequential)

Plans:
- [x] 03-01-PLAN.md — Readability dependency and content extractor module
- [x] 03-02-PLAN.md — Context menu integration and service worker handlers
- [x] 03-03-PLAN.md — Content script extraction message handlers
- [x] 03-04-PLAN.md — Popup integration with extraction UI

**Research Flag**: Standard Readability patterns, skip research-phase
**Context**: Completed (CONTEXT.md - context menu for full-page, SPA stabilization strategy)
**Completed**: 2026-01-27

### Phase 4: Text Highlighting
**Goal**: User sees text highlighted in sync with audio for easy reading
**Depends on**: Phase 3
**Requirements**: CONT-03, CONT-04
**Success Criteria** (what must be TRUE):
  1. Current word or sentence is visually highlighted during playback
  2. Highlighting follows along at all playback speeds (0.5x to 4x)
  3. Page scrolls automatically to keep highlighted text visible
  4. Highlighting works on extracted article content
**Plans**: 5 plans in 4 waves

Plans:
- [x] 04-01-PLAN.md — Highlight manager core, types, and CSS injection
- [x] 04-02-PLAN.md — Overlay mode highlighting for extracted articles
- [x] 04-03-PLAN.md — Selection mode highlighting with DOM wrapping
- [x] 04-04-PLAN.md — Content script integration with playback
- [x] 04-05-PLAN.md — Service worker flow and end-to-end wiring

**Context**: Completed (CONTEXT.md - sentence-level highlighting, dual-mode architecture)
**Completed**: 2026-01-27

### Phase 5: Floating Player
**Goal**: User has persistent playback controls accessible on any webpage
**Depends on**: Phase 4
**Requirements**: UI-01, UI-05
**Success Criteria** (what must be TRUE):
  1. Floating mini player appears when playback starts
  2. Player UI is visually isolated from page styles (no CSS conflicts)
  3. User can minimize/dismiss player when not needed
  4. Player persists across page navigation within same tab
**Plans**: 5 plans in 3 waves

Plans:
- [x] 05-01-PLAN.md — Shadow DOM component with styles and basic structure
- [x] 05-02-PLAN.md — Control buttons and keyboard shortcuts
- [x] 05-03-PLAN.md — STATUS_UPDATE subscription and state sync
- [x] 05-04-PLAN.md — Dismiss/minimize behavior and visibility control
- [x] 05-05-PLAN.md — Navigation persistence and state rehydration

**Research**: Completed (05-RESEARCH.md)
**Context**: Completed (CONTEXT.md)
**Completed**: 2026-01-27

### Phase 6: Document Support
**Goal**: User can import and read PDF and text files
**Depends on**: Phase 5
**Requirements**: DOC-01, DOC-02, DOC-03
**Success Criteria** (what must be TRUE):
  1. User can open a PDF file and have it read aloud
  2. Text extraction works on standard text-based PDFs
  3. User can open plain text files (.txt, .md) for reading
  4. Import UI is accessible from extension popup or side panel
**Plans**: 5 plans in 3 waves

Plans:
- [x] 06-01-PLAN.md — PDF.js dependency, message types, offscreen handler shell
- [x] 06-02-PLAN.md — PDF extraction with normalization and error handling
- [x] 06-03-PLAN.md — Text file extraction with encoding detection
- [x] 06-04-PLAN.md — Popup UI for file import with size warnings
- [x] 06-05-PLAN.md — Service worker handlers, cancellation, pending warnings

**Context**: Completed (CONTEXT.md - chunked uploads, soft limits, offscreen extraction)
**Completed**: 2026-01-27

### Phase 7: Library
**Goal**: User can save content and resume reading across sessions
**Depends on**: Phase 6
**Requirements**: LIB-01, LIB-02, LIB-03, LIB-04
**Success Criteria** (what must be TRUE):
  1. User can save any webpage or document to library for later
  2. Reading position is remembered and resume works correctly
  3. User can organize library items with folders or tags
  4. All library data is stored locally (no cloud, works offline)
**Plans**: 5 plans in 3 waves

Plans:
- [x] 07-01-PLAN.md — Library storage module (types, IDB setup, CRUD)
- [x] 07-02-PLAN.md — Save to library (context menu, popup button)
- [x] 07-03-PLAN.md — Autosave and resume position with fallback chain
- [x] 07-04-PLAN.md — Folder management (create, rename, delete, move items)
- [x] 07-05-PLAN.md — Library UI (recent items, full library panel)

**Context**: Completed (CONTEXT.md - split storage, idb wrapper, resume safety, folders-only)
**Completed**: 2026-01-27

### Phase 8: Side Panel & Polish
**Goal**: User has polished, complete UI with full settings control
**Depends on**: Phase 7
**Requirements**: UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. Side panel provides full library view and settings interface
  2. Dark mode is available and setting persists
  3. Settings page allows configuration of voice, speed, and shortcuts
  4. Voice selection UI shows all available voices with preview option
**Plans**: 7 plans in 3 waves

Plans:
- [x] 08-01-PLAN.md — Side panel infrastructure (manifest, build, entry files)
- [x] 08-02-PLAN.md — Shared CSS architecture with theme variables
- [x] 08-03-PLAN.md — Settings storage consolidation with migration
- [x] 08-04-PLAN.md — Side panel library tab (full library, folder management)
- [x] 08-05-PLAN.md — Side panel settings tab (voice, speed, theme, shortcuts)
- [x] 08-06-PLAN.md — Voice preview feature (audio playback in side panel)
- [x] 08-07-PLAN.md — Popup enhancement (side panel button, theme support)

**Research Flag**: Standard settings UI patterns, skip research-phase
**Context**: Completed (CONTEXT.md - side panel API, settings consolidation, voice preview)
**Completed**: 2026-01-27

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. TTS Engine | 4/4 | ✓ Complete | 2026-01-27 |
| 2. Basic Playback | 4/4 | ✓ Complete | 2026-01-27 |
| 3. Content Extraction | 4/4 | ✓ Complete | 2026-01-27 |
| 4. Text Highlighting | 5/5 | ✓ Complete | 2026-01-27 |
| 5. Floating Player | 5/5 | ✓ Complete | 2026-01-27 |
| 6. Document Support | 5/5 | ✓ Complete | 2026-01-27 |
| 7. Library | 5/5 | ✓ Complete | 2026-01-27 |
| 8. Side Panel & Polish | 7/7 | ✓ Complete | 2026-01-27 |

---
*Roadmap created: 2026-01-27*
*Last updated: 2026-01-27 — v1 Best TTS Complete (All 8 phases)*
