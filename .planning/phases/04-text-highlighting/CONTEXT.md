# Phase 04: Text Highlighting — CONTEXT.md

## Summary of Key Decisions

**Codex Feedback Incorporated:**

1. **[AGREE] items kept as-is:**
   - Sentence-level highlighting as primary granularity
   - CSS class toggling for highlighting
   - Content script owns highlight state
   - Speed change handling via `playbackRate` scaling

2. **[QUESTION] items - alternatives accepted:**
   - **DOM injection**: Changed from live page mutation to overlay/extracted container to avoid breaking page functionality
   - **Auto-scroll**: Added off-screen detection AND user scroll detection to prevent "tug-of-war"
   - **CSS isolation**: Tightened selector scope with data-attribute + unique container
   - **Extraction data format**: Fixed cross-context issue - DOM references stay in content script only

3. **[SUGGEST] item incorporated:**
   - **Playback tracking**: Drive highlights from content script events (`PLAY_AUDIO` message + `ended` event) instead of increasing service worker heartbeat frequency. Note: `timeupdate`/RAF are NOT used — sentence-level switching is purely event-driven.

4. **Codex gaps added:**
   - Cleanup on stop/unload (including text node restoration after `splitText()`)
   - Content-editable/form field protection
   - Language segmentation locale resolution (TTS language > page lang > navigator)
   - Double-wrap prevention for re-extraction
   - DOM-based text extraction (not `selection.toString()`) for accurate offset mapping

---

## Core Dependency Resolutions

### 1. Kokoro TTS Timing Data — RESOLVED

**Status:** Verified via `kokoro-js` API documentation.

**Finding:** `kokoro-js` does NOT provide word-level timing data. The streaming API returns `{ text, phonemes, audio }` per chunk — phoneme strings but no timestamps. The non-streaming `generate()` API returns only an audio blob.

**Decision:** Word-level highlighting is explicitly OUT OF SCOPE for Phase 4. We commit to **sentence-level highlighting only**:
- Each chunk from `splitIntoChunks()` (via `Intl.Segmenter`) maps 1:1 to a sentence span
- Highlight switches when `AUDIO_ENDED` fires for current chunk and next chunk begins
- No sub-sentence tracking needed — this eliminates estimation complexity entirely

**Rationale:** Sentence-level is sufficient for MVP and matches our chunking architecture. Word-level would require either:
- A separate forced alignment library (adds 10MB+ dependency, latency)
- Heuristic estimation (unreliable, poor UX)

Neither is worth the complexity. If word-level is desired post-v1, it should be a separate phase with proper alignment tooling (e.g., Whisper for post-hoc alignment).

### 2. Overlay vs Live DOM Highlighting — RESOLVED

**Status:** UX goals clarified.

**Concern:** Switching from live DOM mutation to overlay/extracted container may not satisfy "highlight the page text" expectations.

**Decision:** We support BOTH modes, with clear UX distinction:

| Mode | Trigger | Implementation | UX |
|------|---------|----------------|-----|
| **Overlay mode** | "Read Article" (Readability extraction) | Render extracted content in extension-controlled container (side panel or floating overlay). Highlight spans within our container. | Reader-mode experience. Clean, guaranteed highlighting. |
| **Selection mode** | "Read Selection" (user-selected text) | Wrap selected text in `<span>` elements on the live page. Use `Range` API to create non-destructive wrappers. | In-page highlighting. May conflict with page styles. |

**Selection mode constraints:**
- Only wrap TEXT NODES that intersect the selection Range — use `Range.intersectsNode(textNode)` to filter
- Use `document.createTreeWalker(NodeFilter.SHOW_TEXT)` to iterate text nodes in common ancestor
- **Filter each text node:** Only process if `selection.containsNode(textNode, true)` or manual Range intersection check
- For partial selection at boundaries, use `Range.cloneContents()` or `splitText()` to extract only selected portion
- Skip nodes inside `<script>`, `<style>`, `<textarea>`, `<input>`, `[contenteditable]`
- Store original `parentNode` and `nextSibling` for cleanup (unwrap on stop)

**Selection mode — sentence-aligned span wrapping:**

Text nodes rarely align to sentence boundaries. A single text node may contain multiple sentences, or a sentence may span multiple text nodes. To ensure `chunkIndex` matches span order:

1. **Extract DOM text with offset tracking:** Walk text nodes and build a mapping from character offsets to DOM positions
2. **Segment into sentences with boundary preservation:** Use `Intl.Segmenter` with `granularity: 'sentence'` — preserve exact segment boundaries (NO trim/filter)
3. **Build sentence-to-DOM mapping:** Map segment boundaries to DOM text node positions using the offset map
4. **Wrap sentence groups:** Each sentence may produce multiple spans if it crosses element boundaries

**CRITICAL: Whitespace and empty segment handling:**

The `selection.toString()` API normalizes whitespace and omits hidden text, which can cause offset drift vs. actual DOM text content. To avoid this:

1. **Do NOT use `selection.toString()`** for boundary computation
2. **Walk DOM text nodes directly** and concatenate their `textContent` to build the source string
3. **Track cumulative offsets** for each text node: `{ node, startOffset, endOffset }`
4. **Segment the DOM-derived string** — boundaries are now valid against the offset map

```typescript
interface TextNodeOffset {
  node: Text;
  startOffset: number;  // Cumulative offset in concatenated string
  endOffset: number;
}

interface SegmentBoundary {
  sentenceIndex: number;
  startOffset: number;  // In concatenated string
  endOffset: number;
  text: string;         // Original unsanitized segment (may include whitespace)
}

interface SentenceMapping {
  sentenceIndex: number;
  spans: HTMLSpanElement[];  // Multiple spans if sentence crosses elements
  text: string;              // Original segment text (NOT trimmed)
}

function buildTextNodeOffsetMap(range: Range): { text: string; offsets: TextNodeOffset[] } {
  const offsets: TextNodeOffset[] = [];
  let cumulativeOffset = 0;

  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (parent?.closest('script, style, textarea, input, [contenteditable]')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const textParts: string[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const nodeText = node.textContent || '';
    const start = cumulativeOffset;
    const end = start + nodeText.length;
    offsets.push({ node, startOffset: start, endOffset: end });
    textParts.push(nodeText);
    cumulativeOffset = end;
  }

  return { text: textParts.join(''), offsets };
}

function segmentWithBoundaries(text: string, locale: string): SegmentBoundary[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  const segments = [...segmenter.segment(text)];

  // Preserve ALL segments including whitespace-only — DO NOT filter
  // The TTS pipeline will filter, but we need offset alignment here
  return segments.map((seg, idx) => ({
    sentenceIndex: idx,
    startOffset: seg.index,
    endOffset: seg.index + seg.segment.length,
    text: seg.segment  // Keep original, no trim()
  }));
}
```

**Index alignment with TTS chunks:**

TTS chunks ARE filtered (empty/whitespace-only removed). DOM spans must align with the filtered indices:

```typescript
function createAlignedChunksAndMappings(
  segments: SegmentBoundary[],
  offsets: TextNodeOffset[],
  locale: string
): { chunks: string[]; mappings: SentenceMapping[] } {
  const chunks: string[] = [];
  const mappings: SentenceMapping[] = [];

  let ttsChunkIndex = 0;

  for (const segment of segments) {
    const trimmed = segment.text.trim();

    if (trimmed.length === 0) {
      // Skip empty segments for TTS, but DO NOT create spans
      // This ensures chunkIndex alignment
      continue;
    }

    // This segment will become TTS chunk at index `ttsChunkIndex`
    chunks.push(trimmed);

    // Create spans for this segment using original (untrimmed) boundaries
    const spans = wrapSegmentInSpans(segment, offsets, ttsChunkIndex);
    mappings.push({
      sentenceIndex: ttsChunkIndex,
      spans,
      text: trimmed  // Store trimmed for verification
    });

    ttsChunkIndex++;
  }

  return { chunks, mappings };
}
```

**Critical invariant:** The `sentenceIndex` in DOM spans matches the `chunkIndex` from TTS because both skip empty segments in lockstep. The DOM spans wrap the full segment text (including leading/trailing whitespace), but `mappings[i].text === chunks[i]` (both trimmed).

**Clarification: Span model (one vs. multiple spans per sentence):**

A sentence may produce MULTIPLE `<span>` elements when it crosses DOM element boundaries. Example:

```html
<!-- Original DOM -->
<p>First sentence. Second <a href="#">sentence with</a> a link.</p>

<!-- After wrapping -->
<p>
  <span data-besttts-sentence="0">First sentence.</span>
  <span data-besttts-sentence="1">Second </span><a href="#"><span data-besttts-sentence="1">sentence with</span></a><span data-besttts-sentence="1"> a link.</span>
</p>
```

Sentence 1 requires THREE spans because the text crosses an `<a>` boundary. The `spanGroups[][]` data structure captures this:

```typescript
spanGroups[0] = [span0];  // Single span for "First sentence."
spanGroups[1] = [span1a, span1b, span1c];  // Three spans for "Second sentence with a link."
```

When highlighting, ALL spans in a group are toggled together:

```typescript
// Highlight ON
for (const span of spanGroups[chunkIndex]) {
  span.classList.add('besttts-highlight-active');
}
// Highlight OFF
for (const span of spanGroups[chunkIndex]) {
  span.classList.remove('besttts-highlight-active');
}
```

This is NOT "one span per sentence" — it's "one or more spans per sentence, grouped by index."

**Overlay mode implementation:**
- Readability extraction already returns plain text (Phase 3)
- Render in side panel or dedicated overlay div with our controlled CSS
- Full highlighting control — no page CSS conflicts

**Default behavior:** Overlay mode for article extraction, Selection mode for text selection. User can toggle in settings (future phase) if they prefer always-overlay.

### 3. Audio/Timing Bridge Architecture — RESOLVED

**Status:** Architecture confirmed compatible.

**Concern:** "drive highlights from content script timeupdate/RAF" assumes audio element and timing are available in content script; if playback lives in service worker/offscreen document, this won't work.

**Finding:** Per Phase 2 CONTEXT.md, **audio playback already lives in the content script**:
- Offscreen document only handles TTS generation (returns base64 audio)
- Service worker orchestrates chunks and forwards audio to content script
- Content script creates `HTMLAudioElement`, calls `play()`, handles events

**Highlighting integration:**
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────────────┐
│  Service Worker │────▶│  Content Script  │────▶│  Highlight Manager (new)    │
│  - chunk index  │     │  - HTMLAudioElement   │  - sentence spans (DOM refs) │
│  - playback     │     │  - currentTime   │     │  - current highlight index   │
│    orchestration│     │  - events        │     │  - CSS class toggling        │
└─────────────────┘     └──────────────────┘     └─────────────────────────────┘
```

**Content script owns everything needed for highlighting:**
- `currentAudio.currentTime` and `currentAudio.duration` (already tracked)
- `AUDIO_ENDED` event (already fires, triggers next chunk)
- DOM access for span creation and class toggling

**Highlight switching mechanism — event-driven, NOT poll-driven:**

There was ambiguity about whether highlights are driven by `timeupdate`/`requestAnimationFrame` or `ended` events. **Decision: `ended` events only.**

Rationale:
- **Sentence-level highlighting** means we switch highlights between sentences, not within them
- `timeupdate` and RAF would be needed for word-level or sub-sentence highlighting (not in scope)
- The `ended` event fires exactly when we need to switch: when the current chunk's audio finishes
- RAF/timeupdate would add unnecessary CPU overhead with no visual benefit for sentence-level

**Why not `timeupdate`/RAF:**
- `timeupdate` fires ~4 times/second, RAF fires ~60 times/second — massive overhead for no benefit
- We don't have word-level timestamps to map `currentTime` to sub-sentence positions
- Sentence-level means the highlight stays static for the entire chunk duration

**When RAF/timeupdate would be needed (OUT OF SCOPE):**
- Word-level or karaoke-style highlighting would require tracking `currentTime` against word timestamps
- That would use RAF to smoothly interpolate highlight positions within a sentence
- This is explicitly out of scope per the Kokoro timing resolution

**No cross-context timing bridge needed.** The content script receives:
1. `PLAY_AUDIO` message with `chunkIndex` from service worker
2. Content script immediately highlights `spanGroups[chunkIndex]`
3. Audio plays in content script context
4. On `ended` event, highlight stays until next `PLAY_AUDIO` arrives
5. Service worker sends next chunk; content script highlights next span (removing previous)

**Heartbeat remains at 2s** (for popup progress bar only). Highlight switching is purely event-driven (`PLAY_AUDIO` message arrival).

### 4. Locale for Sentence Segmentation — RESOLVED

**Status:** Strategy defined.

**Concern:** Locale is hard-coded to `navigator.language`, but TTS voice/language may differ. If user selects a different TTS language, segmentation rules (which vary by language) would mismatch.

**Decision:** Use TTS language setting as the segmentation locale, with fallback chain.

**Locale resolution:**

```typescript
function getSegmentationLocale(): string {
  // Priority order:
  // 1. Explicitly selected TTS voice language (from extension settings)
  // 2. Page's declared language (html lang attribute)
  // 3. Navigator language (browser locale)
  // 4. Fallback to 'en' (most permissive segmentation)

  const ttsLanguage = getStoredTtsLanguage();  // From extension storage
  if (ttsLanguage) return ttsLanguage;

  const pageLanguage = document.documentElement.lang;
  if (pageLanguage) return pageLanguage;

  return navigator.language || 'en';
}

// Usage in segmentation
const locale = getSegmentationLocale();
const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
```

**Why TTS language takes priority:**

- The TTS engine will pronounce the text according to its language model
- Sentence boundaries should match how the TTS will chunk the audio
- If a user reads English content with a French voice, French segmentation rules are more appropriate (the TTS will pause at French-style sentence boundaries)

**Mitigation for mismatched content:**

If the page content language differs significantly from the TTS voice (e.g., Chinese text with English voice), segmentation may be suboptimal. This is acceptable:

- The TTS output will likely be poor anyway (wrong pronunciation)
- Sentence-level granularity is forgiving — off-by-one sentence boundaries are minor UX issues
- User can select appropriate TTS voice for the content

**Intl.Segmenter fallback:**

`Intl.Segmenter` is supported in all modern browsers (Chrome 87+, Firefox 125+, Safari 14.1+). For older browsers:

```typescript
function segmentSentences(text: string, locale: string): SegmentBoundary[] {
  if ('Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
    return [...segmenter.segment(text)].map((seg, idx) => ({
      sentenceIndex: idx,
      startOffset: seg.index,
      endOffset: seg.index + seg.segment.length,
      text: seg.segment
    }));
  }

  // Fallback: regex-based splitting (less accurate for non-Latin scripts)
  // Matches: . ! ? followed by space/newline or end-of-string
  const regex = /[^.!?]*[.!?]+[\s\n]*/g;
  const boundaries: SegmentBoundary[] = [];
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = regex.exec(text)) !== null) {
    boundaries.push({
      sentenceIndex: idx++,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
      text: match[0]
    });
  }

  // Handle trailing text without terminal punctuation
  const lastEnd = boundaries.length > 0
    ? boundaries[boundaries.length - 1].endOffset
    : 0;
  if (lastEnd < text.length) {
    boundaries.push({
      sentenceIndex: idx,
      startOffset: lastEnd,
      endOffset: text.length,
      text: text.slice(lastEnd)
    });
  }

  return boundaries;
}
```

**Note:** The regex fallback is intentionally simple. Complex scripts (Chinese, Japanese, Thai) have nuanced sentence boundary rules that regex cannot handle. For those, `Intl.Segmenter` support is required, and the extension should display a warning if unavailable.

### 5. Dynamic DOM/SPA Mutations During Playback — RESOLVED

**Status:** Strategy defined.

**Concern:** Route changes or reflows can invalidate span mappings; cleanup on unload is noted but mid-play DOM mutations aren't addressed.

**Decision:** Defensive mutation handling with graceful degradation:

**A. Detection — MutationObserver on highlighted container:**
```typescript
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (highlightedSpansRemoved(mutation)) {
      handleHighlightInvalidation();
    }
  }
});

// Observe only the relevant subtree, not entire document
observer.observe(highlightContainer, {
  childList: true,
  subtree: true
});
```

**B. `highlightedSpansRemoved()` check:**
- Track highlighted spans in a `WeakSet<Element>`
- On mutation, check if `removedNodes` intersects our span set
- Also check if any span's `isConnected` becomes false

**C. `handleHighlightInvalidation()` behavior:**
1. **Graceful degradation:** Continue audio playback (don't interrupt listening)
2. **Visual feedback:** Remove stale highlight classes (spans may be detached)
3. **State update:** Set `highlightingAvailable = false` for this session
4. **No re-extraction:** Don't attempt to re-wrap mid-playback — too disruptive
5. **User messaging (optional):** Subtle indicator in popup: "Highlighting unavailable (page changed)"

**D. SPA navigation handling:**
- Listen to `popstate` and `hashchange` events
- On navigation: call `cleanupHighlighting()` before DOM changes
- If playback active during navigation: stop playback OR continue audio-only (user preference, future phase)

**E. Cleanup on unload/stop:**

**CRITICAL: Text node restoration after `splitText()`**

When we call `splitText()` to split a text node at sentence boundaries, we permanently mutate the DOM — the original node becomes two separate nodes. Simply unwrapping spans does NOT restore the original structure. Scripts that hold references to the original text nodes will break.

**Full cleanup strategy:**

```typescript
interface SplitNodeRecord {
  originalNode: Text;           // The node BEFORE any splits (may no longer exist)
  originalText: string;         // Full text content before splitting
  resultingNodes: Text[];       // All nodes created by splitting (in order)
  parentElement: Element;       // Parent to re-insert merged node into
  nextSibling: Node | null;     // Sibling for positioning
}

// Track all splits during wrapping
const splitRecords: SplitNodeRecord[] = [];

function cleanupHighlighting(): void {
  // 1. Remove highlight classes
  document.querySelectorAll('[data-besttts-sentence]').forEach(span => {
    span.classList.remove('besttts-highlight-active');
  });

  // 2. Unwrap spans (move children out, remove span)
  document.querySelectorAll('[data-besttts-sentence]').forEach(span => {
    const parent = span.parentNode;
    while (span.firstChild) {
      parent?.insertBefore(span.firstChild, span);
    }
    parent?.removeChild(span);
  });

  // 3. Re-merge split text nodes to restore original DOM structure
  // Process in reverse order to avoid invalidating sibling references
  for (const record of splitRecords.slice().reverse()) {
    mergeTextNodes(record);
  }
  splitRecords.length = 0;  // Clear for next session

  // 4. Normalize parent containers (merge adjacent text nodes)
  // This catches any nodes we missed and ensures clean DOM
  document.querySelectorAll('[data-besttts-container]').forEach(container => {
    container.normalize();
  });

  // 5. Remove container markers
  document.querySelectorAll('[data-besttts-container]').forEach(el => {
    el.removeAttribute('data-besttts-container');
  });

  // 6. Remove injected style tag
  document.getElementById('besttts-highlight-styles')?.remove();

  // 7. Disconnect observer
  mutationObserver?.disconnect();
}

function mergeTextNodes(record: SplitNodeRecord): void {
  // Check if nodes are still in DOM and adjacent
  const connectedNodes = record.resultingNodes.filter(n => n.isConnected);
  if (connectedNodes.length === 0) return;

  // Verify they're all siblings in the same parent
  const parent = connectedNodes[0].parentNode;
  if (!parent) return;

  // Collect text and remove all but first
  let mergedText = '';
  for (const node of connectedNodes) {
    mergedText += node.textContent || '';
  }

  // Keep first node, update its content, remove others
  connectedNodes[0].textContent = mergedText;
  for (let i = 1; i < connectedNodes.length; i++) {
    connectedNodes[i].remove();
  }
}

// Attach to unload
window.addEventListener('beforeunload', cleanupHighlighting);
// Also call on STOP_PLAYBACK message
```

**Note:** Full text node restoration is best-effort. If the page has modified nodes during playback, we gracefully skip those records. The `normalize()` call on containers ensures adjacent text nodes get merged even if our tracking missed something.

**F. Re-extraction after navigation:**
- If user navigates away and back, or to a new article, they must re-trigger extraction
- Previous span mappings are invalid; start fresh
- This is acceptable UX — user understands "new page = new extraction"

---

## Implementation Notes

### Sentence-to-Span Mapping — Single Source of Truth

**Critical design constraint:** The `chunkIndex` from TTS playback MUST match the `sentenceIndex` in DOM spans. Both are derived from the same source text using the same segmentation.

**Single source of truth architecture:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CONTENT SCRIPT                                      │
│                                                                             │
│  1. Extract text ──▶ sourceText (string)                                   │
│                           │                                                 │
│                           ▼                                                 │
│  2. Segment ────────▶ Intl.Segmenter('sentence')                           │
│                           │                                                 │
│           ┌───────────────┼───────────────┐                                │
│           ▼               ▼               ▼                                │
│     sentences[]     chunkTexts[]    spanMappings[]                         │
│     (for display)   (to TTS)        (DOM references)                       │
│                                                                             │
│  INVARIANT: sentences[i] === chunkTexts[i] === spanMappings[i].text       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
interface HighlightState {
  sourceText: string;                    // Original extracted text
  sentences: string[];                   // TTS chunks (trimmed, non-empty)
  spanGroups: HTMLSpanElement[][];       // spanGroups[i] = spans for sentence i
  currentIndex: number;                  // Currently highlighted sentence
  observer: MutationObserver | null;
  scrollContext: ScrollContext;          // Overlay or window scroll context
  isValid: boolean;                      // False if DOM mutations invalidated spans
  splitRecords: SplitNodeRecord[];       // For cleanup/restoration
}

// Called ONCE at extraction time — generates both chunk list AND span mappings
function initializeHighlighting(sourceText: string, mode: 'overlay' | 'selection'): {
  state: HighlightState;
  chunks: string[];  // Send to TTS pipeline
} {
  // 1. Get locale from TTS settings (NOT hard-coded navigator.language)
  const locale = getSegmentationLocale();

  // 2. Segment text into sentences WITH boundary tracking (no trim/filter yet)
  const segments = segmentSentences(sourceText, locale);

  // 3. Create DOM spans and aligned chunks (filter happens here, in lockstep)
  let spanGroups: HTMLSpanElement[][];
  let chunks: string[];
  let splitRecords: SplitNodeRecord[] = [];

  if (mode === 'overlay') {
    // Overlay mode: simple, no DOM mutation concerns
    const result = createOverlaySpansAligned(segments);
    spanGroups = result.spanGroups;
    chunks = result.chunks;
  } else {
    // Selection mode: complex, needs offset tracking
    const result = createSelectionSpansAligned(segments, sourceText);
    spanGroups = result.spanGroups;
    chunks = result.chunks;
    splitRecords = result.splitRecords;  // Track for cleanup
  }

  // 4. Create scroll context
  const scrollContext = mode === 'overlay'
    ? createScrollContext(document.getElementById('besttts-overlay-container')!)
    : createScrollContext(window);

  const state: HighlightState = {
    sourceText,
    sentences: chunks,  // Store the trimmed/filtered chunks
    spanGroups,
    currentIndex: -1,
    observer: null,
    scrollContext,
    isValid: true,
    splitRecords
  };

  // 5. Return chunks for TTS — SAME array, guaranteed alignment
  return { state, chunks };
}

// Helper for overlay mode — simpler path
function createOverlaySpansAligned(segments: SegmentBoundary[]): {
  spanGroups: HTMLSpanElement[][];
  chunks: string[];
} {
  const container = document.getElementById('besttts-overlay-container')!;
  const spanGroups: HTMLSpanElement[][] = [];
  const chunks: string[] = [];

  let chunkIndex = 0;
  for (const segment of segments) {
    const trimmed = segment.text.trim();
    if (trimmed.length === 0) continue;  // Skip empty

    chunks.push(trimmed);

    const span = document.createElement('span');
    span.setAttribute('data-besttts-sentence', String(chunkIndex));
    span.textContent = segment.text;  // Keep original whitespace in display
    container.appendChild(span);

    spanGroups.push([span]);
    chunkIndex++;
  }

  return { spanGroups, chunks };
}
```

**Why this matters:**
- Previously, chunking happened in TTS context and spanning happened in content script, with no guarantee they'd segment identically
- Now, content script does ONE segmentation and sends chunks to TTS
- `chunkIndex` from `PLAY_AUDIO` message directly indexes into `spanGroups[]`
- No normalization differences, no off-by-one errors

On `PLAY_AUDIO` message:
```typescript
function onPlayAudio(chunkIndex: number, state: HighlightState): void {
  // Remove previous highlight (may be multiple spans per sentence)
  if (state.currentIndex >= 0 && state.spanGroups[state.currentIndex]) {
    for (const span of state.spanGroups[state.currentIndex]) {
      span.classList.remove('besttts-highlight-active');
    }
  }

  // Add new highlight
  state.currentIndex = chunkIndex;
  if (state.isValid && state.spanGroups[chunkIndex]) {
    for (const span of state.spanGroups[chunkIndex]) {
      span.classList.add('besttts-highlight-active');
    }

    // Auto-scroll to first span of the sentence (with user-scroll detection)
    maybeScrollToSpan(state.spanGroups[chunkIndex][0], state.scrollContext);
  }
}
```

### CSS Isolation

Inject a `<style>` tag with scoped selectors:
```css
/* Injected into page <head> */
[data-besttts-sentence].besttts-highlight-active {
  background-color: rgba(255, 230, 0, 0.4) !important;
  border-radius: 2px !important;
  box-decoration-break: clone !important;
}

/* Dark mode support via media query */
@media (prefers-color-scheme: dark) {
  [data-besttts-sentence].besttts-highlight-active {
    background-color: rgba(255, 200, 0, 0.3) !important;
  }
}
```

The `[data-besttts-sentence]` attribute scope prevents conflicts with page CSS.

### Auto-Scroll with User Override

Auto-scroll must work in BOTH contexts:
- **Selection mode:** Page scroll (`window`)
- **Overlay mode:** Container scroll (side panel or overlay div)

```typescript
interface ScrollContext {
  container: HTMLElement | Window;  // Window for selection mode, element for overlay
  userScrolledRecently: boolean;
  scrollTimeout: ReturnType<typeof setTimeout> | null;
}

function createScrollContext(container: HTMLElement | Window): ScrollContext {
  const ctx: ScrollContext = {
    container,
    userScrolledRecently: false,
    scrollTimeout: null
  };

  // Attach listener to the CORRECT scroll target
  const scrollTarget = container === window ? window : container;

  scrollTarget.addEventListener('scroll', () => {
    ctx.userScrolledRecently = true;
    if (ctx.scrollTimeout) clearTimeout(ctx.scrollTimeout);
    ctx.scrollTimeout = setTimeout(() => {
      ctx.userScrolledRecently = false;
    }, 3000); // Resume auto-scroll after 3s of no user scrolling
  }, { passive: true });

  return ctx;
}

function maybeScrollToSpan(span: HTMLElement, ctx: ScrollContext): void {
  if (ctx.userScrolledRecently) return; // User is in control

  const rect = span.getBoundingClientRect();

  if (ctx.container === window) {
    // Selection mode: check against viewport
    const isOffScreen = rect.top < 0 || rect.bottom > window.innerHeight;
    if (isOffScreen) {
      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } else {
    // Overlay mode: check against container bounds
    const containerEl = ctx.container as HTMLElement;
    const containerRect = containerEl.getBoundingClientRect();
    const isOffScreen = rect.top < containerRect.top || rect.bottom > containerRect.bottom;
    if (isOffScreen) {
      // scrollIntoView works, but ensure we're scrolling the container, not the page
      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

// Usage:
// Selection mode: createScrollContext(window)
// Overlay mode: createScrollContext(document.getElementById('besttts-overlay-container')!)
```

**Key difference:** In overlay mode, `scrollIntoView` will scroll the nearest scrollable ancestor (our container), not the page. The container must have `overflow-y: auto` or `scroll` for this to work.

---

## Phase 4 Scope Summary

**In scope:**
- Sentence-level highlighting (1:1 with audio chunks)
- Overlay mode highlighting (extracted content in our container)
- Selection mode highlighting (wrap text nodes on live page)
- Auto-scroll with user-scroll detection
- Cleanup on stop/unload/navigation
- Graceful degradation on DOM mutations

**Out of scope (future phases):**
- Word-level highlighting (requires alignment tooling)
- Karaoke-style progressive highlighting within sentences
- Custom highlight colors (user preference)
- Highlight persistence across sessions

---

## Auto-Discuss Metadata

- **Rounds:** 5
- **Codex Available:** yes
- **Uncertainties Resolution:** all resolved
- **Timestamp:** 2026-01-27T08:00:00Z

<details>
<summary>Codex Review (Round 2)</summary>

**Key Issues**
- The "structured extraction result" with `domRef` can't be sent to the service worker (DOM nodes aren't structured-cloneable); keep DOM references in the content script or store stable selectors/IDs instead.
- Word-level timing is a core dependency for several decisions; without confirming Kokoro's actual outputs, the plan could drift into complex estimation work with low UX payoff.

**Per-decision review**
- [1] **[UNCERTAIN]** Kokoro timing output is the pivotal unknown; I wouldn't commit to word-level timing until you verify the actual `kokoro-js`/ONNX output format. If absent, I'd explicitly scope word-level to "best effort" estimation.
- [2] **[AGREE]** Sentence-level first is aligned with chunks and milestone; word-level as optional enhancement is sensible.
- [3] **[QUESTION]** Injecting spans into the live DOM is reliable but risky on complex pages (event handlers, selectors, layout). Alternative: wrap only in the extracted overlay container (if you already render your own content) or use a cloned Readability container to avoid mutating the page.
- [4] **[AGREE]** Class toggling on spans is simplest and consistent with an MVP.
- [5] **[QUESTION]** `scrollIntoView` is fine, but only trigger when the active span is off-screen (or near edges) to avoid "fighting" user scroll; debounce alone can still feel janky.
- [6] **[SUGGEST]** Rather than ramping the heartbeat to 100ms (service worker chatter), drive highlights off `audio` events/`requestAnimationFrame` in the content script while playing; only send coarse updates to the SW.
- [7] **[AGREE]** Content script should own highlighting and DOM mapping.
- [8] **[QUESTION]** `!important` with broad selectors can still clash; consider a data-attribute + inline style or `style` tag scoped to a unique container. Keep it opt-in to avoid surprising site CSS.
- [9] **[QUESTION]** Returning `{ domRef }` from extraction breaks cross-context messaging. Alternative: keep `segments` in the content script only, or serialize stable identifiers (dataset IDs, DOM paths) instead.
- [10] **[AGREE]** For estimated timing, scale by `playbackRate` or recompute `secondsPerWord = audio.duration / wordCount` at runtime; for real timings, mapping to `currentTime` is enough.

**Gaps Claude missed**
- Cleanup/unwind: how to remove injected spans and styles on stop/unload.
- Off-screen detection + user-initiated scrolling: avoid auto-scroll "tug-of-war."
- Language segmentation: `Intl.Segmenter` availability and fallback for non-English.
- Content-editable/interactive pages: avoid mutating form fields and controls.
- Mutation handling for Readability vs selection paths: ensure you don't double-wrap text on re-extract.

</details>

<details>
<summary>Codex Review (Round 3) — Sprint Fix Issues</summary>

**Issues Raised:**
1. Unresolved core dependency: Kokoro timing output is unknown; word-level highlighting decisions depend on it.
2. Possible goal misalignment: switching to overlay/extracted container may not satisfy "highlight the page text" expectations.
3. Architectural assumption: "drive highlights from content script timeupdate/RAF" assumes audio lives in content script.
4. Missing consideration: dynamic DOM/SPAs during playback can invalidate span mappings.

**Resolutions Applied:**
1. **RESOLVED:** Verified `kokoro-js` API — no word-level timing. Explicitly scoped to sentence-level only. Word-level is OUT OF SCOPE.
2. **RESOLVED:** Defined dual-mode approach — Overlay mode for article extraction, Selection mode for user-selected text. Both modes supported with clear UX distinction.
3. **RESOLVED:** Confirmed audio playback already lives in content script per Phase 2 architecture. No cross-context bridge needed.
4. **RESOLVED:** Added MutationObserver strategy, graceful degradation, cleanup functions, and SPA navigation handling.

</details>

<details>
<summary>Codex Review (Round 4) — Sprint Fix Issues</summary>

**Issues Raised:**
1. Sentence span mapping conflicts with selection-mode wrapping: 1:1 chunk↔sentence span assumes text nodes align to sentence boundaries (they don't). Need explicit sentence-level splitting of text nodes using `Intl.Segmenter` + `splitText()`.
2. Auto-scroll/user-scroll detection is window-based only. Overlay mode scrolls in its own container, so listeners must attach to the correct scroll target.
3. Selection mode TreeWalker/Range handling underspecified: must use `Range.intersectsNode()` to avoid wrapping text outside the selection.
4. Highlight/index alignment assumed but not pinned: chunking and DOM spanning could use different text or normalization, causing `chunkIndex` mismatch.

**Resolutions Applied:**
1. **RESOLVED:** Added detailed sentence-aligned span wrapping algorithm. Text nodes are split at sentence boundaries using `splitText()`. Multiple spans can belong to the same sentence (via `spanGroups[][]`). Both TTS chunking and highlighting use the SAME `Intl.Segmenter` call on the SAME source text.
2. **RESOLVED:** Introduced `ScrollContext` interface with container-aware scroll handling. Overlay mode attaches listeners to the overlay container; selection mode attaches to `window`. `maybeScrollToSpan()` checks bounds against the correct viewport.
3. **RESOLVED:** Added `Range.intersectsNode()` filter in TreeWalker. Only text nodes that intersect the selection range are processed. Partial selection at boundaries handled via `splitText()`.
4. **RESOLVED:** Established single source of truth architecture. Content script performs ONE segmentation and passes the resulting chunks to TTS. `initializeHighlighting()` returns both `HighlightState` (DOM refs) and `chunks[]` (for TTS). Invariant: `chunks[i]` === `state.sentences[i]` === text in `state.spanGroups[i]`.

</details>

<details>
<summary>Codex Review (Round 5) — Sprint Fix Issues</summary>

**Issues Raised:**
1. Sentence segmentation trims and filters segments (`trim()` + remove empties). That changes text lengths, which breaks selection-mode `splitText()` boundary mapping and can violate the stated invariant `chunks[i] === span text`. Offsets will drift on leading/trailing whitespace and blank segments.
2. Selection-mode mapping assumes `selection.toString()` is a faithful linearization of DOM text. It normalizes whitespace and omits hidden text, while Range boundaries are DOM-based. Using that string to compute boundaries can mis-split nodes and highlight the wrong spans.
3. Cleanup only unwraps spans; it does not re-merge text nodes created by `splitText()` or restore original node identity. This contradicts "non-destructive wrappers" and can leave the page permanently mutated.
4. Inconsistent highlight driver: states "drive highlights from timeupdate/RAF" but then defines switching only on `ended` events.
5. Inconsistent span model: "each sentence gets a single span" conflicts with "multiple spans per sentence if a sentence crosses elements."
6. Locale choice is hard-coded to `navigator.language`, but TTS voice/language may differ.

**Resolutions Applied:**
1. **RESOLVED:** Redesigned segmentation to preserve boundaries. `segmentSentences()` returns `SegmentBoundary[]` with exact `startOffset`/`endOffset`. Filtering (empty segment removal) happens in `createAlignedChunksAndMappings()` which processes both chunks and spans in lockstep. DOM spans wrap the full segment (including whitespace), but `mappings[i].text === chunks[i]` (both trimmed) for verification. Offset tracking uses DOM-derived text, not filtered output.

2. **RESOLVED:** Selection mode now walks DOM text nodes directly via `buildTextNodeOffsetMap()` instead of using `selection.toString()`. This builds a cumulative offset map from actual `textContent` values, ensuring segment boundaries map correctly to DOM positions. The concatenated string used for segmentation comes from DOM, not from the Selection API's normalized representation.

3. **RESOLVED:** Added `SplitNodeRecord` tracking during wrapping. Cleanup now includes `mergeTextNodes()` which re-combines split text nodes using their stored content. Added `container.normalize()` as a safety net. Full cleanup restores original DOM structure as closely as possible (best-effort for mutated nodes).

4. **RESOLVED:** Clarified that highlight switching is ONLY event-driven via `PLAY_AUDIO` message arrival and `ended` events. Explicitly stated that `timeupdate`/RAF are NOT used for sentence-level highlighting — they would only be needed for word-level (out of scope). Removed the ambiguous "timeupdate/RAF" language from the summary.

5. **RESOLVED:** Added explicit "Span model clarification" section. A sentence may produce MULTIPLE spans when crossing element boundaries (e.g., `<a>`, `<em>` tags). The `spanGroups[][]` structure captures this — outer array is sentences, inner array is spans for that sentence. All spans in a group are toggled together. This is NOT "one span per sentence."

6. **RESOLVED:** Added section "Locale for Sentence Segmentation" with `getSegmentationLocale()` function. Priority order: TTS voice language > page `lang` attribute > `navigator.language` > 'en' fallback. Includes `Intl.Segmenter` fallback regex for older browsers with explicit warning about complex script limitations.

</details>
