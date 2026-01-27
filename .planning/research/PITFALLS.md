# Domain Pitfalls: Chrome Extension TTS with Local WASM/ONNX

**Domain:** Chrome extension with local TTS (Kokoro via ONNX Runtime Web/WASM)
**Researched:** 2026-01-26
**Confidence:** MEDIUM (verified against official Chrome docs, MDN, ONNX docs)

---

## Critical Pitfalls

Mistakes that cause rewrites, major failures, or fundamental architecture changes.

---

### Pitfall 1: Service Worker Termination Kills TTS State

**What goes wrong:** The Manifest V3 service worker is terminated after 30 seconds of inactivity (or 5 minutes of continuous work). Any in-memory state - including loaded ONNX models, playback position, audio buffers, and synthesis queues - is lost completely.

**Why it happens:** Developers coming from Manifest V2 (persistent background pages) or traditional web apps assume background state persists. Chrome's ephemeral service worker model is fundamentally different.

**Consequences:**
- Model must be re-loaded from storage on every wake-up (327MB for fp32, 86-163MB for quantized)
- Cold-start latency of 2-5+ seconds before TTS can begin
- Users experience "dead" periods where clicking play does nothing
- Playback position lost mid-sentence
- Memory pressure from repeated model loading

**Prevention:**
1. **Use offscreen documents for TTS engine** - Offscreen documents persist while playing audio (auto-close only after 30s silence). Move ONNX Runtime and audio playback here.
2. **Store state in chrome.storage.session** - Playback position, current document ID, queue state. 10MB limit, in-memory, clears on browser restart.
3. **Implement warm-up on user interaction** - Pre-load model when user opens extension popup, not on first play click.
4. **Design for stateless service worker** - Service worker should only route messages; never hold TTS state.

**Detection (warning signs):**
- Architecture shows ONNX model loading in service worker
- Global variables storing playback state in background.js
- No offscreen document in the design
- Users report "first click does nothing" bugs

**Phase to address:** Phase 1 (Architecture foundation) - This is architectural; wrong choice requires full rewrite.

**Sources:**
- [Chrome Service Worker Lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) - HIGH confidence
- [Chrome Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen) - HIGH confidence

---

### Pitfall 2: WASM Memory Limits and Model Size

**What goes wrong:** The 327MB Kokoro fp32 model, plus ONNX Runtime overhead, plus audio buffers, exceeds available memory. Browser tabs crash, extension becomes unresponsive, or WASM allocation fails silently.

**Why it happens:**
- WebAssembly memory is allocated in 64KB pages, grows on demand
- Browser tabs share memory with other processes
- Mobile/low-memory devices have stricter limits
- No clear error when approaching limits - just OOM crashes

**Consequences:**
- Extension crashes on low-memory devices
- Tab crashes when synthesizing long documents
- Memory leaks compound over time
- Users blame the extension for "breaking Chrome"

**Prevention:**
1. **Use quantized models aggressively** - Use model_q8f16.onnx (86MB) or model_quantized.onnx (92MB), NOT fp32. Quality difference is minimal for TTS.
2. **Implement chunked synthesis** - Synthesize one sentence at a time, release memory between chunks. Never load entire document into synthesis queue.
3. **Explicit memory cleanup** - Call `session.release()` on ONNX session when pausing. Nullify audio buffers after playback.
4. **Monitor memory with Performance API** - Track `performance.memory.usedJSHeapSize` (Chrome-only), warn users at 80% threshold.
5. **Test on constrained devices** - Use Chrome DevTools Memory tab, set memory limits, test on Chromebooks.

**Detection (warning signs):**
- Design uses fp32/fp16 models without justification
- No mention of memory management in architecture
- Synthesis processes entire document at once
- No explicit session cleanup code

**Phase to address:** Phase 2 (TTS Integration) - Model selection and memory management strategy.

**Sources:**
- [Kokoro ONNX Model Variants](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) - model_q8f16.onnx is 86MB vs 326MB fp32 - HIGH confidence
- [MDN WebAssembly.Memory](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory) - HIGH confidence

---

### Pitfall 3: Model File Distribution and Loading

**What goes wrong:** Bundling 86-327MB model files in the extension package fails Chrome Web Store review, creates massive download sizes, or breaks extension updates.

**Why it happens:**
- Chrome Web Store has size limits and review policies for large files
- Users expect extensions to install in seconds, not minutes
- Extension updates re-download entire package
- ONNX Runtime expects models at specific paths

**Consequences:**
- Rejection from Chrome Web Store
- 5-star to 1-star reviews due to download size
- Failed updates when model format changes
- Offline-first promise broken (model not available offline after install)

**Prevention:**
1. **Lazy-load models from CDN** - Download models on first use, not at install. Use Hugging Face or custom CDN.
2. **Store models in IndexedDB** - After download, persist in IndexedDB for offline access. Check for existing model before download.
3. **Implement download progress UI** - Show download progress on first use. "Downloading TTS engine (86MB)..."
4. **Version models separately from extension** - Extension updates don't re-download model. Include model version hash in storage.
5. **Provide "pre-download" option** - Let users download model while browsing settings, not blocking first play.

**Detection (warning signs):**
- Model files in extension package `/models/` directory
- No IndexedDB or CacheStorage usage in design
- No download progress UI planned
- Extension size > 10MB in manifest

**Phase to address:** Phase 2 (TTS Integration) - Model loading architecture decision.

**Sources:**
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) - 10MB limit for chrome.storage.local - HIGH confidence
- [IndexedDB Usage](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) - HIGH confidence
- [Web Storage Limits](https://web.dev/articles/storage-for-the-web) - Chrome allows 60% of disk - MEDIUM confidence

---

### Pitfall 4: Audio Playback Context and Autoplay Restrictions

**What goes wrong:** AudioContext is created in service worker (not allowed), or audio fails to play because autoplay policy requires user gesture, or audio cuts out when tab is backgrounded.

**Why it happens:**
- Service workers have no access to AudioContext
- Chrome's autoplay policy blocks audio without user interaction
- Background tabs have throttled/suspended audio
- Offscreen document audio auto-closes after 30s silence

**Consequences:**
- No audio output at all (AudioContext not allowed)
- Play button appears to do nothing (autoplay blocked, no error shown)
- Audio stops when user switches tabs
- Audio cuts out during natural pauses between sentences

**Prevention:**
1. **Audio playback in offscreen document** - Create offscreen document with `AUDIO_PLAYBACK` reason. AudioContext works here.
2. **Resume AudioContext after user gesture** - First play click must call `audioContext.resume()`. Check `audioContext.state === 'suspended'`.
3. **Keep audio stream active** - Play inaudible tone between sentences to prevent 30s silence auto-close. Or re-create offscreen document before each synthesis.
4. **Handle tab visibility changes** - Listen for `visibilitychange`, implement reconnection logic.
5. **Pre-generate next chunk** - While playing current sentence, synthesize next in buffer. Reduces gaps.

**Detection (warning signs):**
- `new AudioContext()` in service worker code
- No handling of AudioContext `state` property
- No offscreen document with AUDIO_PLAYBACK reason
- Gaps > 1 second between sentences in design

**Phase to address:** Phase 2 (TTS Integration) and Phase 3 (Audio Playback).

**Sources:**
- [Chrome Offscreen API - Audio Reasons](https://developer.chrome.com/docs/extensions/reference/api/offscreen) - AUDIO_PLAYBACK has 30s silence limit - HIGH confidence
- [Web Audio Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) - autoplay policy - HIGH confidence
- [Chrome Autoplay Policy](https://developer.chrome.com/blog/autoplay/) - MEDIUM confidence

---

### Pitfall 5: Content Script CSS/JS Conflicts with Page

**What goes wrong:** Extension's floating player UI breaks on certain websites. Page's CSS overrides extension styles. Page's JavaScript interferes with extension DOM elements. Extension's global styles leak into page.

**Why it happens:**
- Content scripts share DOM with page, not JavaScript scope
- CSS cascade applies to all stylesheets, including extension's
- Some sites use aggressive CSS resets or `!important` rules
- Extension UI elements are visible to page's JS and can be modified

**Consequences:**
- Floating player invisible, mispositioned, or unstyled on some sites
- User rage when extension "breaks" their favorite site
- Accessibility issues from style conflicts
- Page JS removes or modifies extension elements

**Prevention:**
1. **Use Shadow DOM for all UI** - Create closed Shadow DOM for player/sidebar. Page CSS cannot penetrate. Use `host.attachShadow({ mode: 'closed' })` and build UI inside the shadow root with safe DOM methods.
2. **Namespace all CSS selectively** - If not using Shadow DOM, prefix all classes: `.best-tts-player` not `.player`.
3. **Reset styles within container** - Include CSS reset scoped to extension root element.
4. **Avoid `!important`** - It creates arms race with page. Shadow DOM makes this unnecessary.
5. **Handle dynamic page changes** - MutationObserver to re-inject UI if page removes it.
6. **Test on aggressive sites** - Gmail, Google Docs, Facebook - sites known for style conflicts.

**Detection (warning signs):**
- CSS file with generic class names (.button, .container, .player)
- No Shadow DOM mentioned in architecture
- No MutationObserver for UI persistence
- UI elements created without isolation

**Phase to address:** Phase 3 (UI Components) - Decide Shadow DOM strategy upfront.

**Sources:**
- [Chrome Content Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) - isolated world explanation - HIGH confidence
- [MDN Content Scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts) - isolation pitfalls - HIGH confidence

---

## Moderate Pitfalls

Mistakes that cause delays, technical debt, or degraded user experience.

---

### Pitfall 6: IndexedDB Transaction Lifetime Gotcha

**What goes wrong:** IndexedDB transactions become inactive unexpectedly. Operations fail with `TRANSACTION_INACTIVE_ERR`. Data appears to save but doesn't persist.

**Why it happens:** IndexedDB transactions auto-close when the event loop is empty of pending requests. Any `await` that doesn't continue a transaction causes it to become inactive.

**Prevention:**
- Keep all transaction operations synchronous within the transaction
- Do not await external operations mid-transaction
- Complete the transaction first, then perform other async work
- Use wrapper libraries like idb that handle this correctly

**Phase to address:** Phase 4 (Document Library) - IndexedDB design.

**Sources:**
- [MDN IndexedDB Usage](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) - transaction lifetime - HIGH confidence

---

### Pitfall 7: Message Passing Size Limits and Serialization

**What goes wrong:** Large audio buffers or document content fail to pass between service worker and content script. Messages silently drop or throw cryptic errors.

**Why it happens:**
- Chrome messages have 64MB limit
- Messages must be JSON-serializable (no ArrayBuffer, typed arrays need conversion)
- `undefined` becomes `null` during serialization

**Consequences:**
- Audio data transfer fails for long content
- Typed arrays corrupted during transfer
- Functions or DOM elements cause silent failures

**Prevention:**
1. **Stream audio, don't pass buffers** - Generate audio in offscreen document, play directly there. Don't transfer audio data via messages.
2. **Use Transferable objects** - For large ArrayBuffers, use postMessage with transfer list (content scripts to offscreen).
3. **Chunk large data** - Split documents > 10MB into chunks.
4. **Validate serialization** - Test `JSON.parse(JSON.stringify(data))` before sending.

**Phase to address:** Phase 2 (TTS Integration) - Message architecture.

**Sources:**
- [Chrome Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) - 64MB limit, JSON serialization - HIGH confidence

---

### Pitfall 8: Content Extraction Fragility

**What goes wrong:** Reader mode extraction works on some sites but fails spectacularly on others. SPAs don't trigger extraction on navigation. Dynamic content loads after extraction completes.

**Why it happens:**
- Web pages are infinitely variable
- Many sites lazy-load content
- SPAs change content without page reload
- Paywalls, overlays, and modals interfere

**Prevention:**
1. **Use proven extraction library** - Readability.js (Firefox's reader mode) or Mercury Parser. Don't roll your own.
2. **Wait for content stability** - Don't extract immediately on load. Wait for DOM to stabilize (MutationObserver with debounce).
3. **Handle SPA navigation** - Listen for `popstate`, History API, and url changes. Re-extract on navigation.
4. **Provide manual selection** - Let users highlight text to read when auto-extraction fails.
5. **Graceful degradation** - If extraction fails, offer to read visible text or user selection.

**Phase to address:** Phase 3 (Content Extraction).

**Sources:**
- Readability.js (Mozilla) - MEDIUM confidence (need to verify current version)

---

### Pitfall 9: PDF and EPUB Content Access

**What goes wrong:** PDF.js works in extension but is massive (500KB+). EPUBs require unzipping which service workers can't do reliably. Google Docs uses custom rendering that breaks extraction.

**Why it happens:**
- PDFs are complex binary format requiring heavy parser
- EPUBs are ZIP files with HTML inside
- Google Docs uses canvas rendering, not DOM text

**Prevention:**
1. **PDF.js in offscreen document** - Load PDF.js only when needed, in offscreen document with DOM access.
2. **JSZip for EPUBs** - Use lightweight ZIP library. Extract in chunks to avoid memory spikes.
3. **Google Docs: use clipboard API** - Users Cmd+A, Cmd+C, extension reads from clipboard. Or use Google Docs API with auth.
4. **Defer PDF/EPUB to post-MVP** - Complex features. Focus on web pages first.

**Phase to address:** Phase 5+ (Post-MVP) - These are complex addons.

**Sources:**
- Training data knowledge - LOW confidence, verify PDF.js and JSZip current state

---

### Pitfall 10: Extension Update Breaks User State

**What goes wrong:** Extension update clears IndexedDB, changes storage schema, or resets user settings. Users lose their document library or preferences.

**Why it happens:**
- IndexedDB version upgrades require explicit migration
- Storage schema changes without migration code
- Testing doesn't cover upgrade paths

**Prevention:**
1. **Version your storage schema** - Store schema version, write migrations.
2. **Never delete stores without migration** - Copy data to new format before deleting old.
3. **Test upgrade paths** - Install old version, add data, upgrade, verify data.
4. **Backup mechanism** - Export/import settings and library to JSON.

**Phase to address:** Phase 1 (Architecture) - Design with migrations from start.

**Sources:**
- [IndexedDB version changes](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) - onblocked, onversionchange - HIGH confidence

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable without major refactoring.

---

### Pitfall 11: Poor Text Preprocessing for TTS

**What goes wrong:** TTS reads URLs character by character. Abbreviations pronounced wrong. Numbers read as digits. Emojis cause failures.

**Prevention:**
- Normalize URLs to "link" or skip
- Expand common abbreviations (Dr. -> Doctor)
- Format numbers (2024 -> "twenty twenty-four")
- Strip or describe emojis
- Handle special characters (& -> "and")

**Phase to address:** Phase 2 (TTS Integration) - Text preprocessing layer.

---

### Pitfall 12: No Loading/Progress States

**What goes wrong:** Model downloading shows blank screen. Long synthesis shows no progress. Users think extension is broken.

**Prevention:**
- Download progress indicator
- "Synthesizing..." for chunks > 500ms
- Skeleton UI while loading
- Error states with retry actions

**Phase to address:** Phase 3 (UI Components).

---

### Pitfall 13: Voice Selection Without Preview

**What goes wrong:** Users pick voices blindly. No sample audio before committing. Confusion between voice variants.

**Prevention:**
- 3-5 second preview per voice
- Group voices by language/accent
- Persist last-used voice

**Phase to address:** Phase 3 (Settings UI).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Architecture foundation | Service worker state loss (#1) | Use offscreen documents from start |
| TTS Integration | Memory limits (#2), Model loading (#3) | Use quantized models, lazy-load from CDN |
| Audio Playback | Autoplay restrictions (#4) | AudioContext in offscreen doc, handle suspend |
| UI Components | CSS conflicts (#5) | Shadow DOM for all injected UI |
| Content Extraction | Fragile extraction (#8) | Use Readability.js, provide manual fallback |
| Document Library | IndexedDB transactions (#6) | Keep transactions short, don't await mid-transaction |
| PDF/EPUB Support | Heavy dependencies (#9) | Defer to post-MVP, load in offscreen doc |
| Updates/Migrations | Breaking user data (#10) | Version schema, test upgrade paths |

---

## Confidence Summary

| Pitfall | Confidence | Verification |
|---------|------------|--------------|
| Service worker termination | HIGH | Official Chrome docs |
| WASM memory limits | MEDIUM | MDN + ONNX docs, no extension-specific docs |
| Model distribution | HIGH | Chrome storage docs + HuggingFace model sizes |
| Audio playback | HIGH | Official Chrome offscreen + Web Audio docs |
| CSS conflicts | HIGH | Official Chrome + MDN content script docs |
| IndexedDB transactions | HIGH | MDN IndexedDB docs |
| Message size limits | HIGH | Official Chrome messaging docs |
| Content extraction | MEDIUM | Based on training knowledge, verify libraries |
| PDF/EPUB | LOW | Training knowledge only, needs verification |
| Extension updates | HIGH | MDN IndexedDB version change docs |

---

## Sources

**Official Chrome Documentation:**
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://developer.chrome.com/docs/extensions/reference/api/offscreen
- https://developer.chrome.com/docs/extensions/reference/api/storage
- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers

**MDN Web Docs:**
- https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices
- https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts

**Model/Library Documentation:**
- https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
- https://onnxruntime.ai/docs/tutorials/web/
- https://huggingface.co/hexgrad/Kokoro-82M

**Storage Limits:**
- https://web.dev/articles/storage-for-the-web
