# Features Research: TTS Chrome Extensions

**Research Date:** 2026-01-27
**Domain:** Text-to-Speech Chrome Extensions (Speechify, Natural Reader, Read Aloud)
**Confidence:** HIGH (based on Speechify Chrome Web Store listing, TechCrunch coverage, product reviews)

---

## Table Stakes Features

Features users expect from any TTS extension. Missing these = users leave immediately.

| Feature | Complexity | Dependencies | Notes |
|---------|------------|--------------|-------|
| **Play/Pause/Stop controls** | Low | Audio playback | Basic transport controls |
| **Speed control (0.5x-2x)** | Low | Audio playback | Must feel natural at high speeds |
| **Voice selection** | Medium | TTS engine | At least 3-5 distinct voices |
| **Read selected text** | Low | Content script | User highlights, clicks play |
| **Read entire page** | Medium | Content extraction | Smart extraction required |
| **Keyboard shortcuts** | Low | Extension APIs | Space=play/pause is expected |
| **Progress indicator** | Low | Audio/text sync | Show how far through content |
| **Works on most websites** | High | Content script isolation | Must handle CSP, iframes |

## Differentiators

Features that set apart premium TTS extensions. Our advantage: **local/offline + privacy**.

| Feature | Complexity | Dependencies | Competitive Advantage |
|---------|------------|--------------|----------------------|
| **Text highlighting (word/sentence)** | High | Text-audio sync | Speechify's signature feature |
| **High-quality natural voices** | High | Kokoro TTS | Our differentiator vs browser TTS |
| **Offline/local processing** | High | WASM TTS | **Major differentiator** - privacy-first |
| **PDF support** | High | PDF.js | Table stakes for Speechify, differentiator for us |
| **EPUB support** | High | EPUB parser | Less common, valuable for book readers |
| **Google Docs integration** | Medium | Google Docs API/DOM | Speechify does this well |
| **Document library** | Medium | IndexedDB | Save articles for later |
| **Reading position memory** | Medium | Storage | Resume where you left off |
| **Side panel UI** | Medium | Chrome Side Panel API | Modern, persistent interface |
| **Floating mini player** | High | Shadow DOM injection | Works across all pages |
| **Skip by sentence/paragraph** | Medium | Text chunking | Fine-grained navigation |
| **Speed up to 4x** | Medium | Audio processing | Power users want this |
| **Dark mode** | Low | CSS | Expected in 2025 |
| **No account required** | Low | Architecture | **Major differentiator** - instant use |

## Anti-Features

Things to deliberately NOT build. Either harmful, complex with low value, or against project goals.

| Anti-Feature | Why NOT to Build | Risk if Built |
|--------------|------------------|---------------|
| **Cloud TTS APIs** | Violates privacy-first goal | Data sent to servers, costs money |
| **User accounts** | Adds complexity, no sync needed | Privacy concern, friction |
| **Voice cloning** | Complex, niche use case | Scope creep, potential misuse |
| **AI summarization** | Out of scope for TTS | Feature creep, needs LLM API |
| **Speech-to-text / dictation** | Different product category | Scope creep |
| **Social features** | Sharing, comments irrelevant | Unnecessary complexity |
| **Analytics / tracking** | Violates privacy goal | User trust issue |
| **Premium voice paywalls** | Local models are free | Monetization not a goal |
| **Multi-device sync** | Requires cloud infrastructure | Violates local-only principle |
| **Browser TTS fallback** | Quality too low | Poor user experience |

## Feature Dependencies

```
┌─────────────────────────────────────────────────────────────┐
│                    CORE DEPENDENCIES                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TTS Engine (Kokoro ONNX)                                   │
│       │                                                     │
│       ├──► Audio Playback                                   │
│       │         │                                           │
│       │         ├──► Play/Pause/Stop                        │
│       │         ├──► Speed Control                          │
│       │         ├──► Keyboard Shortcuts                     │
│       │         └──► Progress Indicator                     │
│       │                                                     │
│       └──► Text-Audio Sync                                  │
│                 │                                           │
│                 ├──► Word Highlighting                      │
│                 ├──► Sentence Highlighting                  │
│                 └──► Skip by Sentence                       │
│                                                             │
│  Content Extraction                                         │
│       │                                                     │
│       ├──► Webpage Reader Mode                              │
│       ├──► PDF Parser (PDF.js)                              │
│       ├──► EPUB Parser                                      │
│       └──► Google Docs DOM Reader                           │
│                                                             │
│  Storage (IndexedDB)                                        │
│       │                                                     │
│       ├──► Model Cache                                      │
│       ├──► Document Library                                 │
│       └──► Reading Position                                 │
│                                                             │
│  UI Components                                              │
│       │                                                     │
│       ├──► Floating Player (Shadow DOM)                     │
│       ├──► Side Panel                                       │
│       └──► Settings Page                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Build Order Recommendation

Based on dependencies:

1. **Phase 1: TTS Core** - Kokoro ONNX in offscreen document, basic audio output
2. **Phase 2: Basic Playback** - Play/pause/stop, speed control, keyboard shortcuts
3. **Phase 3: Content Extraction** - Reader mode for webpages, selected text
4. **Phase 4: Text Highlighting** - Sync audio position with text display
5. **Phase 5: UI Shell** - Floating player, side panel structure
6. **Phase 6: Document Support** - PDF, EPUB, Google Docs
7. **Phase 7: Library** - Save documents, reading position memory
8. **Phase 8: Polish** - Dark mode, settings, voice selection UI

## Competitive Analysis Summary

| Feature | Speechify | Natural Reader | Read Aloud | **Best TTS (Ours)** |
|---------|-----------|----------------|------------|---------------------|
| Quality voices | Cloud AI | Cloud AI | Browser TTS | Local Kokoro |
| Offline support | No | No | Yes (low quality) | **Yes (high quality)** |
| Privacy | Cloud processing | Cloud processing | Local | **Fully local** |
| Account required | Yes | Yes | No | **No** |
| PDF support | Yes | Yes | Limited | Yes |
| Text highlighting | Yes | Yes | No | Yes |
| Price | $139/year | $60/year | Free | **Free** |

**Our unique position:** High-quality TTS that's completely local, free, and private. No other extension offers this combination.

---

## Quality Gate

- [x] Categories are clear (table stakes vs differentiators vs anti-features)
- [x] Complexity noted for each feature
- [x] Dependencies between features identified
- [x] Build order derived from dependencies
- [x] Competitive positioning identified
