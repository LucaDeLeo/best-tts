# Best TTS

## What This Is

A Chrome extension that provides high-quality text-to-speech for any webpage or document, running entirely locally with no cloud dependencies. It's a privacy-focused, fully offline alternative to Speechify — using the Kokoro TTS engine to read web articles, PDFs, EPUBs, Google Docs, and plain text files aloud with natural-sounding voices.

## Core Value

Read any text on the web or in documents with high-quality local TTS that works offline and keeps all data private.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Read any webpage aloud using smart content extraction (reader mode)
- [ ] Highlight current sentence/word as text is read
- [ ] Playback speed control (0.5x to 4x)
- [ ] Skip forward/back by sentence or paragraph
- [ ] Keyboard shortcuts for play/pause, skip, speed
- [ ] Import and read PDF files (with text extraction)
- [ ] Import and read EPUB files
- [ ] Read Google Docs directly
- [ ] Import and read plain text / markdown files
- [ ] Library to save and organize documents
- [ ] Floating player bar for quick playback on any page
- [ ] Sidebar panel for library management and settings
- [ ] Kokoro TTS engine running locally in browser (WASM/ONNX)
- [ ] Download voice models on first use, cache in IndexedDB
- [ ] Multiple Kokoro voices to choose from
- [ ] Dark mode support
- [ ] Persist reading position across sessions

### Out of Scope

- Cloud APIs or external TTS services — local only for privacy
- User accounts or authentication — no cloud, no accounts
- Cross-device sync — local storage only
- Voice cloning — adds complexity, not core to reading experience
- Speech-to-text / dictation — out of scope for v1
- AI summarization — out of scope for v1
- Mobile app — Chrome extension only for v1

## Context

**Reference project:** OpenWebTTS (in ./OpenWebTTS/) is a Flask-based TTS server with similar goals. It demonstrates:
- Smart webpage content extraction (reader mode algorithm)
- PDF/EPUB/DOCX parsing with text chunking
- Multiple TTS engine integrations
- Library management with local storage

**Target experience:** Speechify Chrome extension, which has:
- 1M+ users, polished UX
- Floating player with text highlighting
- Library with document management
- Premium voices (we'll use Kokoro instead)

**Technical approach:** Chrome extension with:
- Manifest V3 (service worker, content scripts)
- Kokoro TTS via ONNX Runtime Web (WASM)
- IndexedDB for document library and model cache
- Side panel API for library UI
- Content script for floating player and text highlighting

## Constraints

- **Platform**: Chrome extension (Manifest V3) — must work within extension APIs
- **TTS Engine**: Kokoro only — single engine simplifies architecture
- **Runtime**: Browser WASM — models must run in ONNX Runtime Web
- **Storage**: IndexedDB — no external storage, ~50MB+ for cached voice models
- **Privacy**: Fully offline — no network requests for TTS or analytics

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Kokoro over Piper | Higher quality voices, user preference | — Pending |
| Local-only storage | Privacy-first, no sync complexity | — Pending |
| No voice cloning | Keeps scope focused on core TTS experience | — Pending |
| Floating player + sidebar | Best of both: quick access and full library | — Pending |

---
*Last updated: 2026-01-26 after initialization*
