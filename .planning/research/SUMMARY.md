# Project Research Summary

**Project:** Best TTS - Chrome Extension with Local Kokoro TTS
**Domain:** Chrome Extension with ML/WASM Workloads
**Researched:** 2026-01-27
**Confidence:** HIGH

## Executive Summary

This is a privacy-focused text-to-speech Chrome extension that runs Kokoro-82M TTS entirely in the browser using ONNX Runtime Web. The recommended approach is a multi-context architecture where the Manifest V3 service worker orchestrates messaging, an offscreen document hosts ONNX inference, content scripts handle page interaction, and a side panel provides the primary UI. The critical architectural decision is using offscreen documents for TTS execution - service workers cannot run WASM workloads due to their ephemeral lifecycle and lack of DOM access.

The key competitive advantage is high-quality, fully local TTS with no accounts or cloud dependencies. The stack centers on kokoro-js (Transformers.js-based library), quantized ONNX models (model_q8.onnx at 92MB), and Vite + CRXJS for modern extension development. Table stakes features include basic playback controls, voice selection, and webpage reading, while differentiators include offline support, text highlighting, and document library functionality.

The primary risks are memory constraints (model size + inference overhead), service worker lifecycle management (state loss on termination), and content script CSS conflicts. These are mitigated by using quantized models, offscreen documents for persistence, and Shadow DOM for UI isolation. The architecture must be correct from Phase 1 - wrong choices here force full rewrites.

## Key Findings

### Recommended Stack

The stack enables fully offline TTS in Chrome extensions by leveraging ONNX Runtime Web's WASM backend for CPU-based inference. The architecture is constrained by Manifest V3 requirements, particularly the ephemeral service worker which forces TTS workloads into offscreen documents.

**Core technologies:**
- **kokoro-js + Kokoro-82M ONNX (q8)**: Official JS library for browser-based Kokoro TTS inference, 92MB quantized model provides near-FP32 quality at 28% the size
- **ONNX Runtime Web (WASM)**: Cross-browser ML inference, WASM backend is most compatible, supports models up to ~200MB in memory
- **Vite + CRXJS + Manifest V3**: Modern extension build pipeline, CRXJS handles MV3 multi-context builds with HMR support
- **IndexedDB (via idb)**: Store documents and cache 92MB model files, unlimitedStorage permission required
- **Preact + Signals**: 3KB React-compatible UI for popup/sidebar/floating player, Signals for efficient state management
- **Offscreen Documents API**: Host ONNX inference and audio playback, persist while audio is playing (vs service worker 30s timeout)

### Expected Features

Research shows TTS extensions require basic playback controls, speed adjustment, and content extraction to meet user expectations. Speechify and Natural Reader dominate the market but require cloud processing and subscriptions. Our differentiator is high-quality local TTS with no accounts or data collection.

**Must have (table stakes):**
- Play/pause/stop controls with progress indicator - users expect this from any TTS tool
- Speed control (0.5x-2x) - essential for accessibility and power users
- Voice selection (3-5 voices minimum) - users need choice for listening preferences
- Read selected text - primary use case for quick content reading
- Read entire page with smart extraction - expected from modern TTS extensions
- Works on most websites - reliability is critical, CSP/iframe handling required

**Should have (competitive):**
- Text highlighting (word/sentence sync) - Speechify's signature feature, high complexity
- High-quality natural voices via Kokoro - our core differentiator vs browser TTS
- Offline/local processing - major privacy and performance advantage
- PDF and EPUB support - valuable for document reading, high complexity
- Document library with reading position memory - increases engagement
- Side panel UI with floating mini player - modern, persistent interface

**Defer (v2+):**
- Voice cloning - complex, niche, potential misuse concerns
- AI summarization - out of scope, requires LLM API
- Multi-device sync - violates local-only architecture principle
- Social features - unnecessary complexity for TTS use case

### Architecture Approach

Chrome MV3 extensions have three isolated JavaScript contexts plus offscreen documents. The service worker orchestrates but cannot run WASM (no DOM, ephemeral). Content scripts access page DOM but face CSP restrictions. Offscreen documents provide a controlled environment for heavy computation with DOM API access. The correct pattern is: service worker routes messages, offscreen document runs ONNX inference and plays audio, content scripts extract content and inject UI, side panel provides library and controls.

**Major components:**
1. **Service Worker** (orchestrator) - Message routing, lifecycle management, no WASM, uses chrome.storage.local for state
2. **Offscreen Document** (compute) - ONNX Runtime host, model loading from IndexedDB, TTS generation, Web Audio API playback
3. **Content Scripts** (page interaction) - Readability.js extraction, Shadow DOM floating player injection, text selection handling
4. **Side Panel** (primary UI) - Document library, playback controls, settings, persistent across navigation
5. **IndexedDB** (storage) - 92MB model caching, document library, reading position, settings (requires unlimitedStorage permission)

**Data flow:** User clicks play → Content script extracts text → Service worker forwards to offscreen → ONNX generates audio → Web Audio plays in offscreen/side panel → Playback state synced to UI

### Critical Pitfalls

1. **Service Worker State Loss** - MV3 service workers terminate after 30s inactivity, losing all in-memory state including loaded models. Prevention: Use offscreen documents for TTS (persist while audio plays), store state in chrome.storage.session, design service worker as stateless message router. This is architectural - wrong choice requires full rewrite.

2. **WASM Memory Limits** - 327MB fp32 model plus ONNX overhead exceeds available memory, causing tab crashes. Prevention: Use model_q8.onnx (92MB) not fp32, implement chunked sentence-by-sentence synthesis, call session.release() on pause, monitor performance.memory and warn at 80% threshold.

3. **Model Distribution** - Bundling 92MB model in extension fails Chrome Web Store review and creates massive downloads. Prevention: Lazy-load from HuggingFace CDN on first use, cache in IndexedDB with version hash, show download progress UI, provide pre-download option in settings.

4. **Audio Autoplay Restrictions** - AudioContext fails in service worker (no DOM access), autoplay policy blocks audio without user gesture, 30s silence closes offscreen document. Prevention: Create offscreen with AUDIO_PLAYBACK reason, resume AudioContext after user gesture, play inaudible tone between sentences to maintain stream.

5. **CSS Conflicts in Content Scripts** - Page CSS overrides floating player styles, extension CSS leaks into page, page JS can modify/remove extension elements. Prevention: Use closed Shadow DOM for all injected UI, build elements with DOM APIs (not innerHTML), test on aggressive sites (Gmail, Google Docs).

## Implications for Roadmap

Based on research, suggested phase structure prioritizes architecture correctness first (wrong choices force rewrites), then core TTS functionality, then UI polish and advanced features. The critical dependency is establishing the offscreen document + service worker communication pattern before building features.

### Phase 1: Core Infrastructure
**Rationale:** Establishes architectural foundation - offscreen document for TTS, service worker messaging, IndexedDB storage. This must be correct from the start; wrong choices here (e.g., running ONNX in service worker) force complete rewrites.

**Delivers:** Working message routing, offscreen document lifecycle management, IndexedDB schema with migrations, basic side panel shell

**Addresses:** Pitfall #1 (service worker state loss), Pitfall #10 (storage migrations)

**Research Flag:** Standard Chrome extension patterns, skip research-phase

### Phase 2: TTS Engine Integration
**Rationale:** Get audio generation working before building UI. Validates memory constraints and model loading strategy early when changes are cheap.

**Delivers:** Kokoro model loading from CDN, IndexedDB caching with progress UI, ONNX inference in offscreen document, basic text-to-audio pipeline

**Uses:** kokoro-js, ONNX Runtime Web, Cache API/IndexedDB

**Addresses:** Pitfall #2 (memory limits - use q8 model), Pitfall #3 (model distribution - lazy load), Pitfall #11 (text preprocessing)

**Research Flag:** Needs research-phase - kokoro-js API specifics, ONNX Runtime Web configuration for extensions, quantization options

### Phase 3: Basic Playback
**Rationale:** Complete vertical slice from content extraction to audio playback. Validates audio context management and autoplay handling.

**Delivers:** Web Audio API playback in offscreen document, play/pause/stop controls, speed control (0.5x-2x), keyboard shortcuts (space bar), progress indicator

**Uses:** Web Audio API, offscreen document AUDIO_PLAYBACK

**Addresses:** Pitfall #4 (audio autoplay restrictions), table stakes features

**Research Flag:** Standard Web Audio patterns, skip research-phase

### Phase 4: Content Extraction
**Rationale:** Enable reading webpages. Must handle selected text (simple) and full page extraction (complex with Readability.js).

**Delivers:** Selected text reading, Readability.js integration for article extraction, content script messaging, graceful fallback for failed extraction

**Uses:** @mozilla/readability, DOMPurify

**Addresses:** Pitfall #8 (extraction fragility), table stakes features

**Research Flag:** Standard Readability patterns, skip research-phase

### Phase 5: Floating Player UI
**Rationale:** Provides persistent playback controls across all pages. Must use Shadow DOM from the start to avoid CSS conflict rewrites.

**Delivers:** Shadow DOM floating player injection, style isolation, playback state sync, position persistence across navigation

**Uses:** Shadow DOM (closed mode), Preact for components

**Addresses:** Pitfall #5 (CSS conflicts - Shadow DOM mandatory), differentiator feature

**Research Flag:** Needs research-phase - Shadow DOM + Preact integration patterns, MutationObserver strategies

### Phase 6: Text Highlighting
**Rationale:** Signature feature that differentiates from browser TTS. High complexity, requires text-audio synchronization.

**Delivers:** Word or sentence highlighting during playback, scroll-to-active-text, highlight color customization

**Addresses:** Differentiator feature (Speechify's signature)

**Research Flag:** Needs research-phase - audio timecode alignment strategies, DOM text position mapping, performance optimization for long documents

### Phase 7: Document Library
**Rationale:** Increases user engagement by enabling saved reading queue. Builds on established IndexedDB patterns from Phase 1.

**Delivers:** Save articles/content to library, reading position memory, resume where left off, library UI in side panel

**Uses:** IndexedDB (documents store), chrome.storage for settings

**Addresses:** Pitfall #6 (IndexedDB transaction lifetime), differentiator feature

**Research Flag:** Standard CRUD patterns, skip research-phase

### Phase 8: PDF/EPUB Support
**Rationale:** Valuable for book/document readers but high complexity. Defer until core experience is solid.

**Delivers:** PDF.js text extraction, EPUB parsing with epub.js, document import UI, format-specific handling

**Uses:** PDF.js (500KB+), epub.js, JSZip

**Addresses:** Pitfall #9 (heavy dependencies - load in offscreen), differentiator feature

**Research Flag:** Needs research-phase - PDF.js extension integration, EPUB text extraction strategies, memory management for large documents

### Phase 9: Voice Selection & Settings
**Rationale:** Polish phase after core functionality works. Multiple Kokoro voices require model management strategy.

**Delivers:** 3-5 Kokoro voice options, voice preview audio, settings persistence, dark mode, voice switching without reload

**Addresses:** Table stakes feature (voice selection), polish (dark mode)

**Research Flag:** Standard settings UI patterns, skip research-phase

### Phase Ordering Rationale

- **Architecture first (Phase 1):** Wrong offscreen document strategy forces rewrites. Must establish message routing and storage patterns before building features.

- **TTS before UI (Phases 2-3):** Validate memory constraints and model loading early when pivots are cheap. No point building UI if inference fails on low-memory devices.

- **Vertical slice (Phases 3-4):** Complete content → TTS → playback pipeline validates architecture choices and provides working MVP.

- **Shadow DOM immediately (Phase 5):** Injecting UI without Shadow DOM causes CSS conflicts that require rewrites. Must be correct from first implementation.

- **Complex features last (Phases 6, 8):** Text highlighting and PDF/EPUB are high-complexity, low-dependency features. Can be deferred or cut without breaking core experience.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 2 (TTS Engine):** kokoro-js API usage patterns in extensions, ONNX Runtime Web memory tuning, quantization trade-offs - domain-specific, needs research-phase
- **Phase 5 (Floating Player):** Shadow DOM + Preact integration, cross-page state persistence, MutationObserver strategies - custom pattern, needs research-phase
- **Phase 6 (Text Highlighting):** Audio-text synchronization strategies, DOM position mapping, performance optimization - specialized domain, needs research-phase
- **Phase 8 (PDF/EPUB):** PDF.js extension integration, EPUB parsing performance, memory management - complex dependencies, needs research-phase

Phases with standard patterns (skip research-phase):

- **Phase 1 (Infrastructure):** Chrome extension messaging, IndexedDB, service workers - well-documented official patterns
- **Phase 3 (Playback):** Web Audio API - standard browser API with extensive documentation
- **Phase 4 (Content Extraction):** Readability.js - mature library with clear usage patterns
- **Phase 7 (Document Library):** CRUD operations on IndexedDB - standard data management patterns
- **Phase 9 (Settings):** Settings UI - conventional form patterns

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official Chrome docs, ONNX Runtime docs, verified HuggingFace model specs. All technologies are production-ready with active maintenance. |
| Features | HIGH | Based on Speechify Chrome Web Store listing, TechCrunch coverage, competitive analysis. Clear market validation for feature set. |
| Architecture | HIGH | Official Chrome extension documentation for MV3, offscreen documents, service workers. ONNX Runtime Web tutorials cover extension usage. |
| Pitfalls | MEDIUM-HIGH | Service worker and offscreen document pitfalls verified in official Chrome docs. Memory limits partially inferred (no extension-specific WASM limits documented). PDF/EPUB complexity based on general knowledge. |

**Overall confidence:** HIGH

The core architectural decisions (offscreen documents for TTS, quantized models, IndexedDB caching) are validated by official documentation and existing Transformers.js extension examples. The primary uncertainties are performance characteristics (inference speed, memory usage) which require empirical testing but won't change the architectural approach.

### Gaps to Address

- **Device performance variability:** Research shows model size and memory constraints but not actual inference speeds across device tiers. Mitigation: Test on low-end Chromebooks during Phase 2, establish minimum specs.

- **kokoro-js API stability:** Library is relatively new (Kokoro released late 2024). Mitigation: Review HuggingFace community examples, consider forking if breaking changes expected.

- **Text-audio synchronization approach:** Text highlighting requires timestamp alignment but research didn't surface proven strategies for Kokoro specifically. Mitigation: Research-phase in Phase 6 before implementation.

- **Chrome Web Store review policies:** Unclear if 92MB CDN download triggers review scrutiny. Mitigation: Review Chrome Web Store policies during Phase 2 before committing to distribution strategy.

- **Multi-threading WASM performance:** ONNX Runtime Web supports multi-threading but requires cross-origin isolation headers. Offscreen documents may not support this. Mitigation: Test single-threaded first (Phase 2), investigate multi-threading as optimization if needed.

## Sources

### Primary (HIGH confidence)
- Chrome Developer Documentation - MV3, Service Workers, Offscreen API, Storage, Messaging, Content Scripts
- ONNX Runtime Web Documentation - Configuration, environment flags, WASM backend
- HuggingFace - Kokoro-82M ONNX models, kokoro-js library, model sizes and quantization options
- MDN Web Docs - IndexedDB, Web Audio API, WebAssembly, Shadow DOM
- Vite + CRXJS Documentation - Build configuration for MV3 extensions

### Secondary (MEDIUM confidence)
- HuggingFace WebML Kokoro Demo - Browser-based inference example
- Transformers.js Extension Example - Architecture patterns for ML in extensions
- Speechify Chrome Web Store Listing - Feature comparison, user expectations
- TechCrunch Coverage - Market validation for TTS extensions

### Tertiary (LOW confidence)
- PDF.js and epub.js size/complexity - General knowledge, verify during Phase 8 planning
- Exact inference speeds - Requires empirical testing on target devices

---
*Research completed: 2026-01-27*
*Ready for roadmap: yes*
