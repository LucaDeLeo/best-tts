# Phase 1: TTS Engine - Research

**Researched:** 2026-01-27
**Domain:** Browser-based Text-to-Speech with Kokoro TTS in Chrome Extension (MV3)
**Confidence:** HIGH

## Summary

This phase implements the Kokoro TTS engine running entirely in the browser via ONNX Runtime Web (WASM), within a Chrome Manifest V3 extension. The research confirms that the locked-in stack decisions (kokoro-js, offscreen document, IndexedDB caching) are well-supported, with comprehensive documentation available.

The primary technical challenges are:
1. **MV3 CSP for WASM**: Requires `wasm-unsafe-eval` in manifest CSP
2. **Offscreen document lifecycle**: Must be intentionally created/closed for WASM inference and audio playback
3. **Model caching**: Transformers.js uses browser Cache API by default; custom IndexedDB caching may be needed for extension context
4. **Cross-origin isolation**: Multi-threaded WASM requires COOP/COEP headers, but extensions can force single-threaded mode as fallback

**Primary recommendation:** Use kokoro-js with `dtype: "q8"` and `device: "wasm"` in an offscreen document, implement custom IndexedDB caching for models, and configure single-threaded WASM to avoid cross-origin isolation complexity.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| kokoro-js | latest | High-level TTS API | Wraps Transformers.js, provides simple `KokoroTTS.from_pretrained()` API, handles model loading and inference |
| @huggingface/transformers | 3.x | ML inference runtime | Powers kokoro-js, mature browser support, handles ONNX model loading |
| onnxruntime-web | bundled | WASM/WebGPU inference | Industry standard for browser ML, included via transformers.js |
| @crxjs/vite-plugin | 2.3.x | Extension bundling | Modern MV3 tooling, HMR support, automatic manifest handling |
| vite | 5.x | Build tool | Fast dev server, modern bundling, excellent plugin ecosystem |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| idb-keyval | 6.x | IndexedDB wrapper | Simplifies IndexedDB for model cache persistence |
| vite-plugin-web-extension | 4.x | Alternative bundler | If CRXJS has issues with offscreen documents |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| kokoro-js | Raw onnxruntime-web | More control but 10x more setup code, must handle tokenization manually |
| IndexedDB | Cache API | Cache API is Chrome's recommended approach but less control over eviction |
| WASM backend | WebGPU backend | WebGPU is 3-5x faster but requires fp32 dtype and has browser support gaps |

**Installation:**
```bash
npm install kokoro-js idb-keyval
npm install -D @crxjs/vite-plugin vite typescript
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── background/
│   └── service-worker.ts    # Message hub, orchestrates offscreen document
├── offscreen/
│   ├── offscreen.html       # Minimal HTML for offscreen document
│   └── offscreen.ts         # TTS engine, model loading, audio playback
├── popup/
│   └── index.html           # Basic UI for Phase 1
├── lib/
│   ├── tts-engine.ts        # KokoroTTS wrapper with caching
│   ├── model-cache.ts       # IndexedDB model persistence
│   └── messages.ts          # Type-safe message definitions
└── manifest.json            # MV3 manifest with CSP
```

### Pattern 1: Offscreen Document for WASM + Audio
**What:** Run all WASM inference and audio playback in an offscreen document, not the service worker.
**When to use:** Always for this extension - service workers cannot access WebAssembly reliably or play audio.
**Example:**
```typescript
// Source: Chrome Developer Docs - Offscreen Documents
// service-worker.ts
const OFFSCREEN_PATH = 'offscreen/offscreen.html';
let creating: Promise<void> | null = null;

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });

  if (existingContexts.length > 0) return;

  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK, chrome.offscreen.Reason.WORKERS],
      justification: 'TTS inference via WASM and audio playback'
    });
    await creating;
    creating = null;
  }
}
```

### Pattern 2: Message-Based TTS Interface
**What:** Service worker sends TTS requests via chrome.runtime messaging; offscreen document processes and plays audio.
**When to use:** All TTS operations from popup or content scripts.
**Example:**
```typescript
// Source: Chrome Developer Docs - Message Passing
// offscreen.ts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  switch (message.type) {
    case 'tts-generate':
      handleGenerate(message.text, message.voice).then(sendResponse);
      return true; // Keep channel open for async response
    case 'tts-stop':
      stopPlayback();
      sendResponse({ success: true });
      break;
  }
});
```

### Pattern 3: Singleton TTS Engine with Progress Callback
**What:** Load model once, reuse for all generations, report download progress.
**When to use:** Model initialization in offscreen document.
**Example:**
```typescript
// Source: Context7 - kokoro-js documentation
// tts-engine.ts
import { KokoroTTS } from 'kokoro-js';

class TTSEngine {
  private static instance: KokoroTTS | null = null;
  private static loading: Promise<KokoroTTS> | null = null;

  static async getInstance(onProgress?: (progress: any) => void): Promise<KokoroTTS> {
    if (this.instance) return this.instance;
    if (this.loading) return this.loading;

    this.loading = KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: onProgress
    });

    this.instance = await this.loading;
    this.loading = null;
    return this.instance;
  }
}
```

### Anti-Patterns to Avoid
- **Running WASM in service worker:** Service workers have limited WASM support and terminate unpredictably. Always use offscreen document.
- **Loading model on every generation:** Model loading takes 5-15 seconds. Use singleton pattern and cache in memory.
- **Closing offscreen document immediately after playback:** Keep it open while extension is active to avoid reload delays.
- **Using `chrome.storage.local` for model files:** Storage API has ~5MB limit per item; use IndexedDB for large model files.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Model loading & tokenization | Custom ONNX loading code | kokoro-js | Handles tokenizer, phonemizer, model sharding automatically |
| IndexedDB storage | Raw IndexedDB API | idb-keyval | Cleaner async/await API, handles edge cases |
| Download progress tracking | Custom fetch wrapper | Transformers.js progress_callback | Built into model loading, fires for each file |
| Audio blob creation | Manual WAV encoding | audio.toBlob() | kokoro-js returns RawAudio with toBlob() method |
| Voice list management | Hardcoded voice array | tts.list_voices() | kokoro-js provides dynamic voice listing |

**Key insight:** kokoro-js abstracts the entire TTS pipeline. Attempting to use raw ONNX Runtime means implementing tokenization, phonemization, and audio post-processing manually - hundreds of lines of error-prone code.

## Common Pitfalls

### Pitfall 1: Missing WASM CSP Directive
**What goes wrong:** Extension fails to load WASM modules, console shows "Refused to compile or instantiate WebAssembly module"
**Why it happens:** MV3 default CSP blocks WASM compilation
**How to avoid:** Add `wasm-unsafe-eval` to manifest CSP:
```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  }
}
```
**Warning signs:** Console errors mentioning CSP or WASM compilation

### Pitfall 2: WASM Files Not Found
**What goes wrong:** "Failed to fetch" errors for .wasm files during model loading
**Why it happens:** ONNX Runtime looks for WASM files relative to the script, but extension bundling changes paths
**How to avoid:** Configure WASM paths explicitly before loading:
```typescript
import * as ort from 'onnxruntime-web';
ort.env.wasm.wasmPaths = chrome.runtime.getURL('assets/');
```
**Warning signs:** 404 errors for files like `ort-wasm-simd.wasm`

### Pitfall 3: Multi-threaded WASM Fails
**What goes wrong:** SharedArrayBuffer errors, WASM multi-threading doesn't work
**Why it happens:** Multi-threaded WASM requires cross-origin isolation (COOP/COEP headers), which extensions don't fully support
**How to avoid:** Force single-threaded mode:
```typescript
import * as ort from 'onnxruntime-web';
ort.env.wasm.numThreads = 1;
```
**Warning signs:** Console errors about SharedArrayBuffer or crossOriginIsolated being false

### Pitfall 4: Audio Playback Blocked
**What goes wrong:** Audio doesn't play, or plays only after user interaction
**Why it happens:** Browser autoplay policies require user gesture to start audio
**How to avoid:**
1. Use offscreen document with `AUDIO_PLAYBACK` reason
2. Ensure user interaction (button click) triggers the TTS request chain
3. Don't auto-play on extension install or page load
**Warning signs:** Audio context in "suspended" state, play() promise rejections

### Pitfall 5: Offscreen Document Closed Prematurely
**What goes wrong:** TTS works once, then stops working; "No offscreen document" errors
**Why it happens:** With `AUDIO_PLAYBACK` reason, Chrome closes the document 30 seconds after audio stops
**How to avoid:**
1. Use multiple reasons: `[AUDIO_PLAYBACK, WORKERS]`
2. Keep a heartbeat or don't close manually
3. Re-create document on each TTS request (slower but reliable)
**Warning signs:** Intermittent failures, works after extension reload

### Pitfall 6: Model Download State Lost
**What goes wrong:** User closes popup during download, loses progress information
**Why it happens:** Popup lifecycle is independent of background download
**How to avoid:** Track download state in chrome.storage.local:
```typescript
// Store progress
chrome.storage.local.set({ downloadProgress: { file: 'model.onnx', percent: 45 } });
// Popup reads on open
const { downloadProgress } = await chrome.storage.local.get('downloadProgress');
```
**Warning signs:** Progress bar resets to 0% when reopening popup

## Code Examples

Verified patterns from official sources:

### Initialize Kokoro TTS in Browser
```typescript
// Source: Context7 - kokoro-js documentation
import { KokoroTTS } from 'kokoro-js';

const model_id = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const tts = await KokoroTTS.from_pretrained(model_id, {
  dtype: 'q8',      // 92MB model, good quality/size balance
  device: 'wasm',   // Universal browser support
});

// List available voices
const voices = tts.list_voices();
console.log('Available voices:', voices);
// Output: ["af_heart", "af_bella", "am_michael", "bf_emma", "bm_george", ...]

// Generate speech
const audio = await tts.generate('Hello, world!', {
  voice: 'af_heart',  // Grade A voice - highest quality
});

// Play in browser
const blob = audio.toBlob();
const url = URL.createObjectURL(blob);
const audioElement = new Audio(url);
audioElement.play();
```

### Manifest V3 Configuration for WASM + Offscreen
```json
// Source: Chrome Developer Docs - CSP and Offscreen API
{
  "manifest_version": 3,
  "name": "Best TTS",
  "version": "1.0.0",
  "permissions": [
    "offscreen",
    "storage"
  ],
  "host_permissions": [
    "https://huggingface.co/*",
    "https://cdn.jsdelivr.net/*"
  ],
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  },
  "action": {
    "default_popup": "src/popup/index.html"
  }
}
```

### Offscreen Document Setup
```html
<!-- offscreen/offscreen.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body>
  <script type="module" src="offscreen.ts"></script>
</body>
</html>
```

```typescript
// offscreen/offscreen.ts
// Source: Chrome Developer Docs - Offscreen Documents
import { KokoroTTS } from 'kokoro-js';
import * as ort from 'onnxruntime-web';

// Configure WASM paths for extension context
ort.env.wasm.wasmPaths = chrome.runtime.getURL('assets/');
ort.env.wasm.numThreads = 1; // Avoid cross-origin isolation issues

let tts: KokoroTTS | null = null;
let currentAudio: HTMLAudioElement | null = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  handleMessage(message).then(sendResponse);
  return true; // Keep channel open for async
});

async function handleMessage(message: any) {
  switch (message.type) {
    case 'init':
      return initTTS(message.onProgress);
    case 'generate':
      return generateAndPlay(message.text, message.voice);
    case 'stop':
      return stopPlayback();
    case 'list-voices':
      return listVoices();
  }
}

async function initTTS(progressCallback?: (p: any) => void) {
  if (tts) return { success: true, cached: true };

  tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (progress) => {
      // Forward progress to service worker
      chrome.runtime.sendMessage({
        type: 'download-progress',
        progress
      });
    }
  });

  return { success: true, cached: false };
}

async function generateAndPlay(text: string, voice: string) {
  if (!tts) await initTTS();

  const audio = await tts!.generate(text, { voice });
  const blob = audio.toBlob();
  const url = URL.createObjectURL(blob);

  // Stop any current playback
  if (currentAudio) {
    currentAudio.pause();
    URL.revokeObjectURL(currentAudio.src);
  }

  currentAudio = new Audio(url);
  await currentAudio.play();

  return { success: true };
}

function stopPlayback() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  return { success: true };
}

function listVoices() {
  if (!tts) return { voices: [] };
  return { voices: tts.list_voices() };
}
```

### IndexedDB Model Cache (Custom Implementation)
```typescript
// Source: Chrome Developer Docs - Cache Models in Browser
// lib/model-cache.ts
import { get, set, del } from 'idb-keyval';

const CACHE_KEY_PREFIX = 'tts-model-';

export async function getCachedModel(filename: string): Promise<ArrayBuffer | null> {
  try {
    return await get(CACHE_KEY_PREFIX + filename);
  } catch {
    return null;
  }
}

export async function setCachedModel(filename: string, data: ArrayBuffer): Promise<void> {
  await set(CACHE_KEY_PREFIX + filename, data);
}

export async function clearModelCache(): Promise<void> {
  // Clear all cached models
  // Implementation depends on idb-keyval version
}

export async function getCacheSize(): Promise<number> {
  // Estimate storage usage
  const estimate = await navigator.storage.estimate();
  return estimate.usage || 0;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Background pages (MV2) | Service worker + offscreen document (MV3) | 2023 | Must use offscreen for WASM/DOM |
| Native messaging for TTS | In-browser WASM TTS | 2024 | Fully self-contained extension |
| Large model downloads | Quantized models (q8, q4) | 2024 | 92MB vs 326MB for same quality |
| Manual ONNX setup | kokoro-js wrapper | 2024 | 5 lines vs 100+ lines of code |

**Deprecated/outdated:**
- `chrome.tts` API: Only system voices, not custom TTS
- Background pages: Replaced by service workers in MV3
- `webkitAudioContext`: Use standard `AudioContext`

## Open Questions

Things that couldn't be fully resolved:

1. **Exact WASM file paths after CRXJS bundling**
   - What we know: ONNX Runtime needs `.wasm` files accessible
   - What's unclear: Exact output paths from CRXJS build
   - Recommendation: Test in dev, may need vite config for static assets

2. **Transformers.js default caching in extension context**
   - What we know: Uses Cache API by default, may not persist in extension
   - What's unclear: Whether extension-specific IndexedDB wrapper is needed
   - Recommendation: Test default behavior first, implement custom cache if needed

3. **Chrome Web Store review for large CDN downloads**
   - What we know: Extension downloads ~92MB model from Hugging Face
   - What's unclear: Whether CWS reviewers flag this as suspicious
   - Recommendation: Clear privacy policy, explain in listing why models are downloaded

4. **Device performance variability**
   - What we know: WASM inference is CPU-intensive
   - What's unclear: Performance on low-end devices
   - Recommendation: Add loading states, consider smaller q4 model option

## Sources

### Primary (HIGH confidence)
- Context7 /websites/npmjs_package_kokoro-js - API usage, voice listing, model options
- Context7 /websites/developer_chrome_extensions - Offscreen document lifecycle, messaging
- Context7 /websites/developer_chrome_extensions_reference_manifest - CSP configuration
- Context7 /websites/onnxruntime_ai - WASM configuration, threading, paths

### Secondary (MEDIUM confidence)
- Chrome Developer Docs - Cache models in browser (https://developer.chrome.com/docs/ai/cache-models)
- Hugging Face onnx-community/Kokoro-82M-v1.0-ONNX - Model variants and sizes
- GitHub microsoft/onnxruntime discussion #23063 - MV3 WASM challenges

### Tertiary (LOW confidence)
- GitHub rhulha/StreamingKokoroJS - Browser implementation patterns
- Chrome Web Store "Kokoro Speak" extension - Proof of concept exists
- Various Medium articles on browser AI inference - General patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - kokoro-js and ONNX Runtime are well-documented
- Architecture: HIGH - Offscreen document pattern is official Chrome guidance
- Pitfalls: HIGH - Based on official docs and multiple verified sources
- Model caching: MEDIUM - May need testing in extension context

**Research date:** 2026-01-27
**Valid until:** 2026-02-27 (30 days - stable libraries, slow-moving space)
