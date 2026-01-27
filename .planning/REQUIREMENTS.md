# Requirements: Best TTS

**Defined:** 2026-01-27
**Core Value:** Read any text on the web or in documents with high-quality local TTS that works offline and keeps all data private.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### TTS Engine

- [ ] **TTS-01**: Extension runs Kokoro TTS engine locally via ONNX Runtime Web (WASM)
- [ ] **TTS-02**: User can select from multiple Kokoro voice options (minimum 3 voices)
- [ ] **TTS-03**: Voice models are downloaded on first use and cached in IndexedDB
- [ ] **TTS-04**: TTS works completely offline after initial model download

### Playback Controls

- [ ] **PLAY-01**: User can play, pause, and stop audio playback
- [ ] **PLAY-02**: User can adjust playback speed from 0.5x to 4x
- [ ] **PLAY-03**: User can skip forward/back by sentence or paragraph
- [ ] **PLAY-04**: User can see progress indicator showing position in content
- [ ] **PLAY-05**: User can control playback via keyboard shortcuts (space=play/pause, arrows=skip)

### Content Extraction

- [ ] **CONT-01**: User can select text on any webpage and play it aloud
- [ ] **CONT-02**: Extension can auto-extract article content from webpages (reader mode)
- [ ] **CONT-03**: Current word or sentence is highlighted during playback
- [ ] **CONT-04**: Highlighting stays in sync with audio across different playback speeds

### Document Support

- [ ] **DOC-01**: User can import and read PDF files
- [ ] **DOC-02**: PDF text extraction works on text-based PDFs
- [ ] **DOC-03**: User can import and read plain text files (.txt, .md)

### User Interface

- [ ] **UI-01**: Floating mini player appears on webpages during playback
- [ ] **UI-02**: Side panel provides full library and settings interface
- [ ] **UI-03**: Dark mode theme is available and persists
- [ ] **UI-04**: Settings page allows configuration of voice, speed, and shortcuts
- [ ] **UI-05**: UI components are isolated from page styles (Shadow DOM)

### Library

- [ ] **LIB-01**: User can save webpages and documents to local library
- [ ] **LIB-02**: Reading position is remembered and can be resumed
- [ ] **LIB-03**: User can organize library items with folders or tags
- [ ] **LIB-04**: Library data is stored locally in IndexedDB (no cloud)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Documents

- **DOC-04**: User can import and read EPUB files
- **DOC-05**: Extension can read Google Docs directly
- **DOC-06**: OCR support for scanned PDFs

### Advanced

- **ADV-01**: Export audio as MP3 file
- **ADV-02**: Bookmark specific positions within documents
- **ADV-03**: Search within library

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Cloud TTS APIs | Violates privacy-first goal, requires payment |
| User accounts | No sync needed, adds friction and privacy concerns |
| Voice cloning | Complex, niche use case, potential misuse |
| Speech-to-text / dictation | Different product category, scope creep |
| AI summarization | Requires LLM API, out of scope for TTS tool |
| Cross-device sync | Requires cloud infrastructure, violates local-only |
| Analytics / tracking | Violates privacy goal |
| Premium voice paywalls | Local models are free, monetization not a goal |
| Browser TTS fallback | Quality too low, undermines core value |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TTS-01 | Phase 1: TTS Engine | Pending |
| TTS-02 | Phase 1: TTS Engine | Pending |
| TTS-03 | Phase 1: TTS Engine | Pending |
| TTS-04 | Phase 1: TTS Engine | Pending |
| PLAY-01 | Phase 2: Basic Playback | Pending |
| PLAY-02 | Phase 2: Basic Playback | Pending |
| PLAY-03 | Phase 2: Basic Playback | Pending |
| PLAY-04 | Phase 2: Basic Playback | Pending |
| PLAY-05 | Phase 2: Basic Playback | Pending |
| CONT-01 | Phase 3: Content Extraction | Pending |
| CONT-02 | Phase 3: Content Extraction | Pending |
| CONT-03 | Phase 4: Text Highlighting | Pending |
| CONT-04 | Phase 4: Text Highlighting | Pending |
| UI-01 | Phase 5: Floating Player | Pending |
| UI-05 | Phase 5: Floating Player | Pending |
| DOC-01 | Phase 6: Document Support | Pending |
| DOC-02 | Phase 6: Document Support | Pending |
| DOC-03 | Phase 6: Document Support | Pending |
| LIB-01 | Phase 7: Library | Pending |
| LIB-02 | Phase 7: Library | Pending |
| LIB-03 | Phase 7: Library | Pending |
| LIB-04 | Phase 7: Library | Pending |
| UI-02 | Phase 8: Side Panel & Polish | Pending |
| UI-03 | Phase 8: Side Panel & Polish | Pending |
| UI-04 | Phase 8: Side Panel & Polish | Pending |

**Coverage:**
- v1 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0

---
*Requirements defined: 2026-01-27*
*Last updated: 2026-01-27 after roadmap creation*
