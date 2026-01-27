# Architecture Patterns: Chrome Extension with Local TTS via ONNX Runtime Web

**Domain:** Chrome Extension with Heavy WASM/ML Workloads
**Researched:** 2026-01-26
**Confidence:** MEDIUM-HIGH (verified against official Chrome and ONNX Runtime documentation)

## Executive Summary

Chrome extensions running heavy WASM workloads like ONNX Runtime require careful architectural decisions due to Manifest V3 constraints. The service worker cannot run WASM directly (no DOM, ephemeral lifecycle), so **offscreen documents** are the recommended approach for hosting ONNX inference. This architecture separates concerns: service worker for orchestration, offscreen document for computation, content scripts for page interaction, and sidebar/popup for UI.

## Recommended Architecture

```
+------------------+     +--------------------+     +------------------+
|   Content Script |<--->|   Service Worker   |<--->|   Offscreen Doc  |
|   (per page)     |     |   (orchestrator)   |     |   (ONNX/TTS)     |
+------------------+     +--------------------+     +------------------+
        |                         |                         |
        v                         v                         |
+------------------+     +--------------------+              |
| Floating Player  |     |   Side Panel UI    |              |
| (injected DOM)   |     |   (React/UI)       |              |
+------------------+     +--------------------+              |
                                  |                         v
                         +--------------------+     +------------------+
                         |    IndexedDB       |     |   Web Audio API  |
                         | (documents, model) |     |   (playback)     |
                         +--------------------+     +------------------+
```

### Component Boundaries

| Component | Responsibility | APIs Available | Communicates With |
|-----------|---------------|----------------|-------------------|
| **Service Worker** | Event handling, message routing, extension lifecycle | All chrome.* APIs, no DOM | All components |
| **Offscreen Document** | ONNX Runtime inference, model loading, TTS generation | DOM, WASM, WebGL/WebGPU, only chrome.runtime | Service Worker |
| **Content Script** | Page content extraction, floating player injection | Limited chrome.* (storage, runtime), page DOM | Service Worker |
| **Side Panel** | Main UI, document library, playback controls | All chrome.* APIs, DOM | Service Worker |
| **Popup** | Quick actions, settings access | All chrome.* APIs, DOM | Service Worker |

### Data Flow

```
1. User Action Flow:
   User clicks "Read" -> Content Script extracts text -> Service Worker receives
   -> Service Worker forwards to Offscreen -> ONNX generates audio
   -> Audio returned to Service Worker -> Forwarded to Side Panel/Content Script
   -> Web Audio API plays audio

2. Model Loading Flow:
   Extension installed -> Service Worker checks IndexedDB for model
   -> If missing, fetches from CDN/bundled -> Stores in IndexedDB
   -> On inference request, Offscreen loads from IndexedDB

3. Document Storage Flow:
   User imports PDF/EPUB -> Side Panel parses document
   -> Stores in IndexedDB with metadata -> Available in document library
```

## Why Offscreen Document (Not Service Worker or Content Script)

### Service Worker Limitations (Manifest V3)

From official Chrome documentation:
- "Service workers are ephemeral, which means they'll likely start, run, and terminate repeatedly"
- No DOM access - cannot run WASM that requires DOM APIs
- Cannot use `localStorage` or `sessionStorage`
- Timers (`setTimeout`, `setInterval`) terminate when worker shuts down
- Global variables don't persist across restarts

**Verdict:** Service worker CANNOT host ONNX Runtime directly.

### Content Script Limitations

- Runs in page context, affected by page's Content Security Policy (CSP)
- Many pages block WASM execution via CSP
- Cannot access cross-origin resources without CORS
- Isolated from extension's storage context

**Verdict:** Content script is unreliable for ONNX inference.

### Offscreen Document Advantages

From Chrome's Offscreen API documentation:
- "Offscreen documents are hidden HTML pages that extensions can create to access DOM APIs"
- Can spawn Web Workers for computation
- Static HTML bundled with extension (controlled environment)
- Supports DOM-dependent APIs that WASM may need
- Single instance limitation (only one offscreen doc at a time)
- Lifecycle managed by extension

**Verdict:** Offscreen document is the correct choice for ONNX Runtime.

### Official Offscreen Document Reasons

Chrome explicitly lists use cases for offscreen documents:
- Audio playback (relevant for TTS)
- DOM parsing
- Worker spawning (can use Web Workers inside offscreen doc)

## Component Deep Dives

### 1. Service Worker (Orchestrator)

**Role:** Central message hub, event handler, lifecycle manager

```typescript
// Simplified message routing pattern
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'EXTRACT_TEXT':
      // Forward to content script
      break;
    case 'GENERATE_SPEECH':
      // Ensure offscreen doc exists, forward request
      ensureOffscreenDocument().then(() => {
        chrome.runtime.sendMessage({ type: 'TTS_REQUEST', text: message.text });
      });
      break;
    case 'TTS_COMPLETE':
      // Forward audio to requester
      break;
  }
  return true; // Keep channel open for async response
});
```

**Key Patterns:**
- Use `chrome.storage.local` instead of global variables
- Use Alarms API instead of `setTimeout` for persistence
- Always check/create offscreen document before inference
- Implement keep-alive mechanism during long operations

### 2. Offscreen Document (ONNX Runtime Host)

**Role:** ML model loading, inference execution, audio generation

```html
<!-- offscreen.html -->
<!DOCTYPE html>
<html>
<head>
  <script type="module" src="offscreen.js"></script>
</head>
<body></body>
</html>
```

```typescript
// offscreen.js - TTS inference
import * as ort from 'onnxruntime-web';

let session: ort.InferenceSession | null = null;

async function loadModel() {
  // Load from IndexedDB or extension bundle
  const modelBuffer = await loadModelFromIndexedDB();
  session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'], // or 'webgpu' for GPU acceleration
  });
}

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'TTS_REQUEST') {
    if (!session) await loadModel();
    const audio = await runInference(message.text);
    chrome.runtime.sendMessage({ type: 'TTS_COMPLETE', audio });
  }
});
```

**ONNX Runtime Configuration:**

From official ONNX Runtime Web docs:
- `env.wasm.numThreads`: Default 0 (auto-detect, typically half of CPU cores, min 4)
- Multi-threading requires `crossOriginIsolated` mode and specific HTTP headers
- `env.wasm.proxy`: Offloads to Web Worker for UI responsiveness
- `env.wasm.wasmPaths`: Override WASM file locations for bundling

**CRITICAL: Cross-Origin Isolation for Multi-Threading**

Multi-threaded WASM requires:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

In Chrome extensions, offscreen documents are extension pages (`chrome-extension://` scheme), which have more relaxed security. However, multi-threading may still be limited. **Recommendation:** Test single-threaded first, add multi-threading as optimization.

### 3. Content Script (Page Interaction)

**Role:** Extract page content, inject floating player UI

```typescript
// content.js
// Text extraction
function extractReadableContent(): string {
  // Use Readability.js or similar for clean extraction
  const article = new Readability(document.cloneNode(true)).parse();
  return article?.textContent ?? '';
}

// Floating player injection using Shadow DOM
function injectFloatingPlayer() {
  const shadowHost = document.createElement('div');
  shadowHost.id = 'tts-player-root';
  const shadow = shadowHost.attachShadow({ mode: 'closed' });

  // Create player elements using DOM APIs (not innerHTML for security)
  const container = document.createElement('div');
  container.className = 'player-container';

  const playButton = document.createElement('button');
  playButton.textContent = 'Play';
  playButton.addEventListener('click', handlePlay);

  container.appendChild(playButton);
  shadow.appendChild(container);

  // Add styles via adoptedStyleSheets or style element
  const style = document.createElement('style');
  style.textContent = '.player-container { position: fixed; bottom: 20px; right: 20px; }';
  shadow.appendChild(style);

  document.body.appendChild(shadowHost);
}

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PAGE_TEXT') {
    sendResponse({ text: extractReadableContent() });
  }
});
```

**Floating Player Pattern:**
- Use Shadow DOM for style isolation
- Inject as fixed-position element
- Communicate playback state via messaging
- Handle page navigation gracefully

### 4. Side Panel (Primary UI)

**Role:** Document library, playback controls, settings

```typescript
// sidepanel.js
// Open side panel programmatically
chrome.sidePanel.setOptions({ enabled: true });

// Document library from IndexedDB
async function loadDocumentLibrary() {
  const db = await openDB('tts-documents', 1);
  return db.getAll('documents');
}

// Playback controls communicate with offscreen/content script
function handlePlay(documentId: string) {
  chrome.runtime.sendMessage({
    type: 'PLAY_DOCUMENT',
    documentId,
  });
}
```

**Side Panel Features (Chrome API):**
- Persistent alongside page content
- Full extension API access
- Can show different content per site via `setOptions()`
- Stays open when navigating tabs

### 5. IndexedDB (Storage Layer)

**Role:** Store documents, cache model files

```typescript
// db.ts
import { openDB } from 'idb';

const DB_NAME = 'best-tts';
const DB_VERSION = 1;

export async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Document store
      const docStore = db.createObjectStore('documents', { keyPath: 'id' });
      docStore.createIndex('createdAt', 'createdAt');

      // Model cache store
      db.createObjectStore('models', { keyPath: 'name' });

      // Settings store
      db.createObjectStore('settings', { keyPath: 'key' });
    },
  });
}
```

**Storage Strategy for Large Models:**

From Chrome storage documentation:
- Extensions can request `"unlimitedStorage"` permission
- IndexedDB supports Blobs directly (no base64 encoding needed)
- Kokoro ONNX quantized model: ~86-92 MB (q8 or q4f16)
- Store model as Blob, load into ArrayBuffer for ONNX Runtime

```typescript
// Model caching
async function cacheModel(modelUrl: string) {
  const response = await fetch(modelUrl);
  const blob = await response.blob();

  const db = await openDB(DB_NAME, DB_VERSION);
  await db.put('models', { name: 'kokoro', data: blob, version: '1.0' });
}

async function loadCachedModel(): Promise<ArrayBuffer> {
  const db = await openDB(DB_NAME, DB_VERSION);
  const record = await db.get('models', 'kokoro');
  return record.data.arrayBuffer();
}
```

### 6. Audio Playback (Web Audio API)

**Role:** Play generated TTS audio

Audio can be played from:
1. **Side Panel** - Best for UI-controlled playback
2. **Offscreen Document** - Allowed per Chrome API ("audio playback" is listed reason)
3. **Content Script** - Works but affected by page's audio policies

**Recommendation:** Play from Side Panel for consistent UX, fall back to offscreen for background playback.

```typescript
// Audio playback in side panel
async function playAudio(audioData: Float32Array, sampleRate: number) {
  const audioContext = new AudioContext();
  const buffer = audioContext.createBuffer(1, audioData.length, sampleRate);
  buffer.copyToChannel(audioData, 0);

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.start();

  return new Promise((resolve) => {
    source.onended = resolve;
  });
}
```

## Communication Patterns

### Message Types

```typescript
// types.ts
type Message =
  | { type: 'EXTRACT_TEXT'; tabId: number }
  | { type: 'TEXT_EXTRACTED'; text: string; source: string }
  | { type: 'GENERATE_SPEECH'; text: string; voice: string }
  | { type: 'SPEECH_GENERATED'; audio: Float32Array; sampleRate: number }
  | { type: 'PLAY_AUDIO' }
  | { type: 'PAUSE_AUDIO' }
  | { type: 'SEEK_AUDIO'; position: number }
  | { type: 'MODEL_LOADING'; progress: number }
  | { type: 'MODEL_READY' }
  | { type: 'ERROR'; message: string; code: string };
```

### Long-Lived Connections

For streaming audio or progress updates, use `chrome.runtime.connect()`:

```typescript
// content.js - maintain connection for playback state
const port = chrome.runtime.connect({ name: 'playback' });
port.onMessage.addListener((msg) => {
  if (msg.type === 'PLAYBACK_PROGRESS') {
    updateProgressUI(msg.position, msg.duration);
  }
});
```

### Message Size Limits

Chrome messages have a 64 MiB limit. For large audio buffers:
- Option A: Send as transferable ArrayBuffer
- Option B: Store in IndexedDB, send reference ID
- Option C: Stream in chunks

**Recommendation:** For TTS audio (typically seconds of speech), direct transfer works. For long documents, store and reference.

## Patterns to Follow

### Pattern 1: Lazy Model Loading

**What:** Don't load the model until first inference request
**When:** Always - model is 80+ MB, shouldn't block extension startup

```typescript
let modelPromise: Promise<ort.InferenceSession> | null = null;

async function getModel(): Promise<ort.InferenceSession> {
  if (!modelPromise) {
    modelPromise = loadModel();
  }
  return modelPromise;
}
```

### Pattern 2: Offscreen Document Lifecycle Management

**What:** Create offscreen document on-demand, close when idle
**When:** To manage memory and comply with single-instance limit

```typescript
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK', 'WORKERS'],
    justification: 'TTS inference using ONNX Runtime Web',
  });
}
```

### Pattern 3: Shadow DOM for Injected UI

**What:** Use Shadow DOM for floating player to isolate styles
**When:** Always when injecting UI into arbitrary web pages

```typescript
function createIsolatedUI() {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });

  // Build UI using DOM APIs for security
  const container = document.createElement('div');
  container.className = 'player';

  // Add child elements via appendChild, not innerHTML
  const button = document.createElement('button');
  button.textContent = 'Play';
  container.appendChild(button);

  shadow.appendChild(container);
  return host;
}
```

### Pattern 4: Progressive Audio Generation

**What:** Generate and stream audio in chunks for long text
**When:** Documents longer than a few paragraphs

```typescript
async function* generateAudioChunks(text: string, chunkSize: number) {
  const sentences = splitIntoSentences(text);

  for (let i = 0; i < sentences.length; i += chunkSize) {
    const chunk = sentences.slice(i, i + chunkSize).join(' ');
    const audio = await runInference(chunk);
    yield { audio, index: i, total: sentences.length };
  }
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Running ONNX in Service Worker

**What:** Attempting to load ONNX Runtime in service worker
**Why bad:** Service workers have no DOM, WASM support is limited, and they're ephemeral
**Instead:** Use offscreen document

### Anti-Pattern 2: Bundling Model in Extension Package

**What:** Including the 80+ MB model in the extension download
**Why bad:** Chrome Web Store has size limits, slow initial install, poor UX
**Instead:** Download on first use, cache in IndexedDB

### Anti-Pattern 3: Global Variables in Service Worker

**What:** Storing state in service worker global scope
**Why bad:** Service workers are ephemeral - state lost on restart
**Instead:** Use `chrome.storage.local` or IndexedDB

### Anti-Pattern 4: Synchronous Model Loading

**What:** Loading model on extension startup
**Why bad:** Blocks extension functionality, wastes resources if TTS not used
**Instead:** Lazy load on first TTS request

### Anti-Pattern 5: Injecting UI Without Shadow DOM

**What:** Directly appending styled elements to page DOM
**Why bad:** Page styles will break your UI, your styles may break the page
**Instead:** Use Shadow DOM with closed mode

## Build Order Implications

Based on component dependencies:

### Phase 1: Core Infrastructure
1. **Service Worker** - Message routing skeleton
2. **IndexedDB Setup** - Storage layer
3. **Basic Side Panel** - UI shell

*Dependencies: None external, establishes communication backbone*

### Phase 2: TTS Engine
4. **Offscreen Document** - ONNX Runtime host
5. **Model Loading** - IndexedDB caching, lazy loading
6. **Basic Inference** - Text to audio pipeline

*Dependencies: Phase 1 messaging infrastructure*

### Phase 3: Content Interaction
7. **Content Script** - Text extraction (Readability.js)
8. **Floating Player** - Shadow DOM injection
9. **Audio Playback** - Web Audio API integration

*Dependencies: Phase 2 for audio generation*

### Phase 4: Enhanced Features
10. **Document Library** - PDF/EPUB parsing, IndexedDB storage
11. **Voice Selection** - Multiple Kokoro voices
12. **Playback Controls** - Speed, pause, seek

*Dependencies: Phases 1-3 complete*

## Scalability Considerations

| Concern | Local Extension | Optimization Path |
|---------|-----------------|-------------------|
| Model Size | 86-163 MB cached | Use quantized (q8/q4) models |
| Inference Speed | Varies by device | WebGPU if supported, optimize chunk size |
| Memory Usage | Model stays loaded | Unload model after idle timeout |
| Storage | ~200MB total | Auto-cleanup old documents |
| First-time Setup | Download model | Show progress UI, allow background download |

## Sources

- **Chrome Offscreen Documents API** (HIGH confidence): https://developer.chrome.com/docs/extensions/reference/api/offscreen
- **Chrome Service Workers** (HIGH confidence): https://developer.chrome.com/docs/extensions/develop/concepts/service-workers
- **Chrome Messaging** (HIGH confidence): https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- **Chrome Side Panel API** (HIGH confidence): https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- **Chrome Content Scripts** (HIGH confidence): https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- **ONNX Runtime Web** (HIGH confidence): https://onnxruntime.ai/docs/tutorials/web/
- **ONNX Runtime Web Configuration** (HIGH confidence): https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
- **Kokoro ONNX Model** (HIGH confidence): https://huggingface.co/onnx-community/Kokoro-82M-ONNX
- **Chrome Extension Storage** (HIGH confidence): https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- **Cross-Origin Isolation** (HIGH confidence): https://web.dev/articles/cross-origin-isolation-guide
- **Transformers.js Extension Example** (MEDIUM confidence): https://github.com/huggingface/transformers.js/tree/main/examples/extension
- **IndexedDB API** (HIGH confidence): https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- **Web Audio API** (HIGH confidence): https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
