# Technology Stack

**Project:** Best TTS - Chrome Extension with Local Kokoro TTS
**Researched:** 2026-01-26
**Overall Confidence:** HIGH

## Executive Summary

This stack enables a fully offline, privacy-focused TTS Chrome extension using Kokoro-82M running locally via ONNX Runtime Web. The architecture leverages the kokoro-js library (built on Transformers.js) for browser-based TTS inference, with WASM as the primary execution backend for broad compatibility.

---

## Recommended Stack

### TTS Engine

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| kokoro-js | latest | Kokoro TTS inference | Official JS library for Kokoro-82M ONNX models. Built on Transformers.js, provides `KokoroTTS.from_pretrained()` API with streaming support via `TextSplitterStream`. Supports dtype options (fp32, fp16, q8, q4) for memory/quality tradeoffs. | HIGH |
| onnx-community/Kokoro-82M-ONNX | - | ONNX model files | Pre-converted ONNX models in multiple quantizations. Use `model_q8.onnx` (92.4MB) for best size/quality balance, or `model_quantized.onnx` for even smaller footprint. | HIGH |
| onnxruntime-web | ^1.20.0 | ONNX execution | Underlies Transformers.js. Supports WASM (CPU), WebGPU (GPU), WebGL (legacy). WASM is default and most compatible. | HIGH |

**Model Size Options:**
| Model | Size | Use Case |
|-------|------|----------|
| model.onnx | 326 MB | Maximum quality, large download |
| model_fp16.onnx | 163 MB | Good quality, moderate size |
| model_q8.onnx | 92.4 MB | **Recommended** - Best balance |
| model_q4.onnx | 305 MB | 4-bit matmul (larger due to lookup tables) |
| model_q4f16.onnx | 154 MB | Mixed precision alternative |

**Rationale:** kokoro-js provides the cleanest API for browser TTS with Kokoro models. The q8 quantization delivers near-FP32 quality at ~28% the size, suitable for extension storage limits and reasonable download times.

### Chrome Extension Framework

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Manifest V3 | 3 | Extension manifest | **Required** - MV2 completely deprecated as of July 2025 (Chrome 138+). Service workers replace background pages. | HIGH |
| TypeScript | ^5.6.0 | Type safety | Essential for complex extension with multiple contexts (service worker, content scripts, UI). Catches messaging API errors at compile time. | HIGH |
| Vite | ^7.3.1 | Build tool | Fast HMR, ES modules, Rollup-based production builds. Node 20.19+ required. | HIGH |
| @crxjs/vite-plugin | ^2.0.0 | Vite + MV3 integration | Handles manifest generation, HMR for extensions, multi-entry builds. Standard choice for Vite-based Chrome extensions. | MEDIUM |

**Rationale:** Vite + CRXJS is the modern standard for Chrome extension development. Provides excellent DX with hot reload while handling MV3's complex multi-context build requirements.

### Storage & Database

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| IndexedDB | Native | Document library storage | Only browser storage option for large binary data (PDFs, EPUBs). No size limits like localStorage (5MB). | HIGH |
| idb | ^8.0.0 | IndexedDB wrapper | Promisified API, TypeScript support. Small (~2KB gzipped). Alternative: Dexie.js (~20KB) offers more features but overkill for this use case. | HIGH |
| chrome.storage.local | Native | Settings, preferences | MV3-native, syncs with Chrome account optionally. Use for small JSON data only. | HIGH |
| Cache API | Native | Model caching | Cache ONNX model files for offline use. Integrates with service worker lifecycle. | HIGH |

**Rationale:** IndexedDB via `idb` for documents; chrome.storage for settings; Cache API for model files. This separation matches data characteristics (size, access patterns, sync needs).

### Content Extraction

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @mozilla/readability | ^0.5.0 | Article extraction | Battle-tested (Firefox Reader Mode). Extracts main content, removes ads/nav. | HIGH |
| DOMPurify | ^3.2.0 | HTML sanitization | Security-critical for injected content. Prevents XSS from extracted HTML. | HIGH |
| pdf.js | ^4.8.0 | PDF parsing | Mozilla's PDF renderer. Extract text layer for TTS. Can render pages to canvas if needed. | HIGH |
| epub.js | ^0.3.93 | EPUB parsing | Standard EPUB library. Access chapters, metadata, text content. | MEDIUM |

**Rationale:** Readability is the gold standard for web article extraction. DOMPurify is non-negotiable for security. pdf.js and epub.js are the dominant libraries in their respective domains.

### UI Framework

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Preact | ^10.25.0 | UI components | React API at 3KB. Perfect for extension UIs (popup, sidebar, floating player). Signals for state. | HIGH |
| @preact/signals | ^2.0.0 | Reactive state | Fine-grained reactivity without virtual DOM diffing overhead. Better than useState for cross-component state. | HIGH |
| Tailwind CSS | ^4.0.0 | Styling | Utility-first, purges unused styles. Ideal for extension where bundle size matters. | HIGH |

**Alternatives Considered:**
- **React**: 40KB+ is too heavy for extension popup/sidebar
- **Solid**: Similar size to Preact but less ecosystem maturity
- **Vanilla JS**: Fine for simple UIs, but this project needs component composition

**Rationale:** Preact + Signals provides React DX at a fraction of the size. Tailwind ensures minimal CSS in production through tree-shaking.

### Audio Processing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Web Audio API | Native | Audio playback | Native browser API. Required for audio scheduling, volume control, playback rate. | HIGH |
| AudioWorklet | Native | Audio processing | Process audio off main thread. Use for real-time effects if needed (speed adjustment without pitch shift). | MEDIUM |

**Rationale:** Native APIs are sufficient. Kokoro outputs 24kHz WAV which Web Audio API handles natively.

### Development & Testing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Vitest | ^3.0.0 | Unit/integration tests | Vite-native, fast, Jest-compatible API. | HIGH |
| Playwright | ^1.50.0 | E2E extension testing | Best Chrome extension testing support. Can load unpacked extensions. | HIGH |
| ESLint | ^9.0.0 | Linting | Flat config, TypeScript support. | HIGH |
| Prettier | ^3.4.0 | Formatting | Standard formatter. | HIGH |

---

## Architecture Notes

### Chrome Extension Contexts

MV3 has three isolated JavaScript contexts:

1. **Service Worker** (background.js)
   - No DOM access
   - Handles: Model loading, TTS inference, chrome.* APIs
   - Wake on events, sleep when idle

2. **Content Scripts** (content.js)
   - DOM access to web pages
   - Handles: Content extraction, text selection, floating UI injection
   - Sandboxed from page scripts

3. **Extension Pages** (popup.html, sidebar.html)
   - Full DOM + chrome.* APIs
   - Handles: Settings UI, document library, player controls

**Critical:** ONNX inference should run in an **Offscreen Document** (MV3 feature) rather than service worker due to WASM memory requirements and potential timeout issues.

### Offscreen Document Strategy

```javascript
// manifest.json
{
  "permissions": ["offscreen"],
  "background": {
    "service_worker": "background.js"
  }
}

// background.js - Create offscreen document for TTS
chrome.offscreen.createDocument({
  url: 'offscreen.html',
  reasons: ['AUDIO_PLAYBACK', 'LOCAL_STORAGE'],
  justification: 'TTS inference and audio playback'
});
```

The offscreen document runs Kokoro inference and plays audio, communicating with the service worker via messaging.

### Model Loading Strategy

```javascript
// Use Cache API for model persistence
const cache = await caches.open('kokoro-models');
const modelUrl = 'https://huggingface.co/onnx-community/Kokoro-82M-ONNX/resolve/main/model_q8.onnx';

// Check cache first
let response = await cache.match(modelUrl);
if (!response) {
  response = await fetch(modelUrl);
  await cache.put(modelUrl, response.clone());
}

// Load from cache
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX', {
  dtype: 'q8',
  // Custom fetch to use cached model
});
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| TTS Engine | kokoro-js | Web Speech API | Web Speech is cloud-based, not local. Quality varies by OS. No voice consistency. |
| TTS Engine | kokoro-js | piper-wasm | Piper has fewer voices, less natural prosody than Kokoro. |
| TTS Engine | kokoro-js | espeak-ng-wasm | Very robotic voice quality. Not suitable for long-form reading. |
| Build Tool | Vite + CRXJS | webpack | Slower, more complex config. CRXJS simplifies MV3 builds. |
| Build Tool | Vite + CRXJS | Plasmo | Opinionated framework, less control. Lock-in concern. |
| UI | Preact | React | 40KB vs 3KB. Extension popups need fast load. |
| UI | Preact | Svelte | Build output larger than Preact for small components. |
| IndexedDB | idb | Dexie.js | Dexie is 20KB vs idb 2KB. Extra features not needed here. |
| IndexedDB | idb | localForage | localForage abstracts storage backend; we specifically need IndexedDB features. |

---

## Installation

```bash
# Core dependencies
npm install kokoro-js @preact/signals preact idb @mozilla/readability dompurify pdfjs-dist epubjs

# Dev dependencies
npm install -D vite @crxjs/vite-plugin typescript vitest playwright eslint prettier tailwindcss @types/chrome
```

### package.json Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:e2e": "playwright test",
    "lint": "eslint src/",
    "format": "prettier --write src/"
  }
}
```

### vite.config.ts

```typescript
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import preact from '@preact/preset-vite';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [
    preact(),
    crx({ manifest }),
  ],
  build: {
    rollupOptions: {
      input: {
        offscreen: 'src/offscreen/index.html',
      },
    },
  },
});
```

---

## Version Constraints & Compatibility

| Technology | Min Version | Max Version | Notes |
|------------|-------------|-------------|-------|
| Chrome | 138+ | - | MV3 required, MV2 disabled |
| Node.js | 20.19 | - | Vite 7 requirement |
| onnxruntime-web | 1.18 | - | WebGPU support improved in 1.18+ |

---

## Performance Considerations

### Model Loading Time
- First load: 5-15s (download ~90MB model)
- Cached load: 1-3s (from Cache API)
- Warm inference: <100ms for short sentences

### Memory Usage
- q8 model in memory: ~150-200MB
- Extension limit: None explicit, but Chrome may kill high-memory extensions
- Recommendation: Unload model when not in active use

### Battery Impact
- WASM inference is CPU-intensive
- Consider: Pause/stop TTS when tab hidden
- Consider: User preference for quality vs battery

---

## Sources

### HIGH Confidence (Official Documentation)
- Chrome Developer Docs - MV3 Migration: https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline
- ONNX Runtime Web: https://onnxruntime.ai/docs/get-started/with-javascript/web.html
- Kokoro-82M ONNX Models: https://huggingface.co/onnx-community/Kokoro-82M-ONNX
- Transformers.js: https://huggingface.co/docs/transformers.js/index
- Vite Documentation: https://vite.dev/guide/
- Kokoro Official Repo: https://github.com/hexgrad/kokoro

### MEDIUM Confidence (Official but Less Detail)
- WebML Community Kokoro Demo: https://huggingface.co/spaces/webml-community/kokoro-web

### Verified Claims
- MV2 fully deprecated July 24, 2025 (Chrome 138+) - Chrome docs
- Kokoro q8 model size 92.4MB - HuggingFace model card
- ONNX Runtime Web supports WASM, WebGPU, WebGL - Official docs
- Vite current version 7.3.1 - Official docs
- kokoro-js uses Transformers.js internally - HuggingFace docs
