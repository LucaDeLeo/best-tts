# Phase 06: Document Support — Context

**Status:** Ready for planning

## Scope Clarification

**Milestone:** v1 Best TTS (Phases 1-8) — Kokoro TTS Chrome extension running entirely in browser

**Phase 06 Scope:** Document import and text extraction for PDF and text files

This phase delivers document support as part of the larger TTS extension. Phase 06 focuses specifically on:
- Importing PDF and text files via the extension UI
- Extracting readable text from those files
- Passing extracted text to the existing TTS pipeline (built in Phases 1-5)

The TTS engine (Kokoro) is already complete from Phase 1. This phase adds new input sources (documents) to feed that engine.

---

## Final Implementation Decisions

### 1. PDF Library Choice
**Decision:** PDF.js for PDF text extraction
**Rationale:** Battle-tested, fully offline, client-side JavaScript library. Mozilla-backed with active maintenance.
**Status:** LOCKED

### 2. PDF.js Loading Strategy
**Decision:** Offscreen document with complete file handling
**Rationale:** Offscreen document is required for PDF.js WASM/Worker execution in Manifest V3.

**Popup Lifecycle Mitigation:** To prevent extraction failures if popup closes:
- Popup checks `file.size` before reading (enables pre-read size warning)
- Popup reads file as ArrayBuffer after size check passes or user confirms
- ArrayBuffer is passed to service worker via `chrome.runtime.sendMessage`
- Service worker forwards ArrayBuffer to offscreen document
- All extraction happens in offscreen document — popup can close safely after sending
- Progress/completion messages flow back through service worker to any open UI

**Flow:** `Popup (file select) → Size check → ArrayBuffer → SW → Offscreen (extraction) → SW → UI`

The popup's only responsibility is file selection, size gating, and initial ArrayBuffer creation. Once the ArrayBuffer is sent to the service worker, the popup lifecycle is irrelevant.

**Large File Transfer Strategy:**

Chrome's `runtime.sendMessage` has practical limits (~64 MB per message, but structured clone doubles memory). For files approaching 50 MB:

1. **Primary approach (files ≤ 10 MB):** Read entire file via `file.arrayBuffer()`, send directly via `runtime.sendMessage`. Structured clone handles transfer. Single memory copy in popup is acceptable at this size.

2. **Streamed chunking approach (files > 10 MB):**
   - Popup uses `file.slice(start, end)` to read 5 MB Blob slices sequentially
   - Each slice is read via `slice.arrayBuffer()`, sent immediately, then released
   - Only one chunk (~5 MB) is held in popup memory at a time
   - Messages sent as `{ type: 'DOCUMENT_CHUNK', chunkIndex, totalChunks, data, extractionId }`
   - Offscreen document writes each chunk to IndexedDB as it arrives (key: `extractionId-chunkIndex`)
   - Final `DOCUMENT_CHUNK_COMPLETE` message triggers reassembly and extraction
   - After extraction, IndexedDB chunks are deleted

   **Popup flow (pseudocode):**
   ```javascript
   const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
   const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
   for (let i = 0; i < totalChunks; i++) {
     const slice = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
     const data = await slice.arrayBuffer();
     await chrome.runtime.sendMessage({ type: 'DOCUMENT_CHUNK', chunkIndex: i, totalChunks, data, extractionId });
     // data goes out of scope, eligible for GC
   }
   await chrome.runtime.sendMessage({ type: 'DOCUMENT_CHUNK_COMPLETE', extractionId });
   ```

3. **Offscreen reassembly:**
   - Chunks stored in IndexedDB avoid holding all data in JS heap during transfer
   - On `DOCUMENT_CHUNK_COMPLETE`, read all chunks from IndexedDB sequentially into a single ArrayBuffer
   - Pass reassembled ArrayBuffer to PDF.js or TextDecoder
   - Delete IndexedDB entries after extraction completes or fails

**Why `file.slice()` over `file.arrayBuffer()` + split:** Calling `file.arrayBuffer()` on a 50 MB file allocates 50 MB in popup memory before splitting. Using `file.slice()` reads directly from the File (which is backed by disk), so only one chunk is in memory at a time.

**Why IndexedDB in offscreen:** Holding 10+ chunks in JS variables while waiting for more defeats the memory optimization. IndexedDB provides durable storage outside the JS heap. The reassembly step briefly holds the full file, but this happens in the offscreen document which has more memory headroom than the popup.

**Why not Transferable objects:** `runtime.sendMessage` doesn't support Transferable (only `postMessage` does). The service worker intermediary prevents direct transfer. Streamed chunking is the practical solution.

**Why not offscreen file reading:** Chrome's offscreen documents cannot access File objects from popup's `<input>`. The File must be read in the popup context.

**Status:** LOCKED

### 3. Text File Handling
**Decision:** Read text files as ArrayBuffer, decode in offscreen document
**Rationale:** Maintains consistency with the message protocol (all files sent as ArrayBuffer). Decoding happens in offscreen to keep popup lightweight and allow popup to close immediately.

**Flow:**
1. Popup reads file via `file.arrayBuffer()` (not `file.text()`)
2. ArrayBuffer sent to service worker → offscreen (same path as PDF)
3. Offscreen document decodes: `new TextDecoder('utf-8').decode(arrayBuffer)`
4. BOM detection: TextDecoder handles UTF-8 BOM automatically; for UTF-16, detect BOM bytes and use appropriate decoder

**Why not file.text():** While simpler, it returns a string which conflicts with the ArrayBuffer-only message protocol. Decoding in offscreen keeps all text processing centralized.
**Status:** LOCKED

### 4. File Import UI Location
**Decision:** File import in popup UI
**Rationale:** Consistent with current UX. Single `<input type="file">` with accept filter.
**Status:** LOCKED

### 5. Message Protocol
**Decision:** Single `EXTRACT_DOCUMENT` message type with `documentType` field
**Rationale:** Reduces message surface vs separate EXTRACT_PDF/EXTRACT_TEXT_FILE messages.
```typescript
type ExtractDocumentMessage = {
  type: 'EXTRACT_DOCUMENT';
  documentType: 'pdf' | 'txt' | 'md';
  data: ArrayBuffer;  // Not string — avoids message size limits
  filename: string;
};
```
**Status:** LOCKED

### 6. Soft Limits — Multi-Threshold Strategy
**Decision:** Combined soft limits with page count, byte size, AND extracted text length

**Thresholds (all soft — show warning, allow override):**
- **File size:** > 50 MB raw file size
- **Page count:** > 100 pages (PDF only)
- **Extracted text:** > 500,000 characters

**Rationale:** Page count alone doesn't protect against:
- Dense academic PDFs with 50 pages but massive text
- Complex PDFs with embedded resources consuming memory
- Malformed PDFs that parse slowly

The byte size provides an early gate before parsing. Extracted text length catches dense documents after extraction. All three together cover the failure modes.

**User flow with popup-closed handling:**

1. **File size warning (popup required):**
   - Check `file.size` BEFORE calling `file.arrayBuffer()` — no memory cost yet
   - If > 50 MB: Show warning in popup with "Continue anyway" / "Cancel"
   - User must respond before file is read into memory
   - If popup closes during warning: extraction is cancelled (user never confirmed)

2. **Page count warning (popup-independent):**
   - Triggered in offscreen after PDF metadata loaded (early in parse)
   - Service worker stores pending confirmation state: `{ extractionId, warningType: 'pageCount', pageCount }`
   - If popup is open: SW sends `EXTRACTION_WARNING` message, popup shows dialog
   - If popup is closed: Extraction pauses, warning state persisted in SW memory
   - When popup reopens OR user clicks extension icon: Check for pending warning, show dialog
   - User response sent to SW → forwarded to offscreen to continue/abort

3. **Extracted text length warning (popup-independent):**
   - Same flow as page count: offscreen detects, SW holds state, any UI can surface it
   - Extraction is paused (text extracted but not yet passed to TTS)
   - User confirmation resumes or aborts

**Pending Warning UI:**
- Extension badge shows "!" when warning pending
- Any popup open checks `chrome.runtime.sendMessage({ type: 'GET_PENDING_WARNING' })` on load
- Floating player (if visible) can also surface warnings via same message

**Timeout for pending warnings:** If no UI responds within 5 minutes, extraction is auto-cancelled to prevent indefinite resource holding.

**Status:** LOCKED

### 7. OCR Support
**Decision:** No OCR in Phase 6
**Rationale:** Out of scope. Image-based PDFs show "Image-based PDF not supported — no text found" message.
**Status:** LOCKED

### 8. File Persistence
**Decision:** No persistence in Phase 6 (deferred to Phase 7 Library)
**Rationale:** Phase 6 is extraction only. Library storage is Phase 7 scope.
**Status:** LOCKED

### 9. PDF Text Normalization
**Decision:** Normalize PDF.js text output for coherent TTS
**Rationale:** PDF.js returns fragmented text items. Raw concatenation produces poor TTS output.
**Normalization steps:**
- Join text items with proper spacing
- Collapse multiple whitespace to single space
- Preserve paragraph breaks (double newline)
- Handle hyphenated line breaks
**Status:** LOCKED

### 10. Encrypted PDF Detection
**Decision:** Detect and surface clear error for encrypted/password-protected PDFs
**Rationale:** PDF.js throws on password-protected PDFs. Catch and show user-friendly message.
**Error message:** "This PDF is password-protected. Please open an unprotected PDF."
**Status:** LOCKED

### 11. Cancellation Support
**Decision:** Support cancellation for long extractions
**Rationale:** Users may close popup or explicitly cancel. Extraction should be abortable.
**Implementation:**
- Service worker tracks active extraction ID
- `CANCEL_EXTRACTION` message type stops current extraction
- Offscreen document checks abort flag between pages
**Status:** LOCKED

### 12. Metadata Surfacing
**Decision:** Show page count when PDF extraction completes
**Rationale:** Helpful user feedback with low effort.
**Status:** LOCKED

---

## Memory Management Strategy

### Shared Offscreen Document Risk
**Risk:** Kokoro TTS (WASM/ONNX) and PDF.js share one offscreen document. Combined memory may exceed limits.

**Mitigation Strategy:**
1. **Lazy loading:** Only load PDF.js when document extraction is requested (not preloaded)
2. **Sequential operation:** Don't run PDF extraction while TTS is generating (queue if needed)
3. **Cleanup after extraction:** Call `pdfDocument.destroy()` and release ArrayBuffer references after extraction completes
4. **Memory monitoring:** Log `performance.memory.usedJSHeapSize` (if available) before/after extraction
5. **Fallback plan:** If combined memory causes crashes in testing, split into separate offscreen documents:
   - `offscreen-tts.html` for Kokoro
   - `offscreen-pdf.html` for PDF.js
   - Service worker routes messages to appropriate document

**Testing requirement:** During implementation, test with:
- Large PDF (50+ pages) immediately after TTS generation
- Multiple TTS generations then PDF extraction
- Monitor for OOM crashes or performance degradation

**Status:** LOCKED (mitigation approach confirmed, fallback documented)

---

## Uncertainties Requiring Research

### PDF.js Worker Configuration
**Question:** Inline worker (larger bundle) vs external worker file (CSP/manifest complexity)?
**Research needed:** Test both approaches during 06-01 implementation
**Default approach:** Start with inline worker, switch to external if bundle size is problematic
**Status:** NEEDS RESEARCH (will resolve in 06-01)

---

## Success Criteria Mapping

From ROADMAP Phase 6:
1. ✓ User can open a PDF file and have it read aloud → File import + extraction + existing TTS
2. ✓ Text extraction works on standard text-based PDFs → PDF.js with normalization
3. ✓ User can open plain text files (.txt, .md) for reading → ArrayBuffer + TextDecoder in offscreen
4. ✓ Import UI is accessible from extension popup → Popup file input

---

## Auto-Discuss Metadata

- **Rounds:** 6 (including 3 fix rounds)
- **Codex Available:** yes
- **Uncertainties Resolution:** PDF.js worker config (deferred to implementation)
- **Timestamp:** 2026-01-27T10:15:00Z (original), 2026-01-27T11:30:00Z (fix round 5), 2026-01-27T12:00:00Z (fix round 6)

<details>
<summary>Codex Review (Round 2)</summary>

Below is a concise review of each decision plus gaps.

**Decisions**
- PDF library choice: [AGREE] PDF.js is the right client-side choice; battle-tested and fully offline.
- PDF.js loading strategy (offscreen): [QUESTION] Offscreen is fine, but be sure the popup isn't required to stay open. If the popup reads the file and closes mid-read, extraction could abort. Alternative: pass the File/ArrayBuffer to offscreen and do all reading/extraction there, so popup lifecycle doesn't matter.
- Text file handling (FileReader): [QUESTION] FileReader is async (not sync). Consider `file.text()` for simplicity and to avoid encoding surprises; also handle BOM/encoding fallback for .txt/.md.
- File import UI location (popup): [AGREE] Meets criteria; consistent with current UX.
- File input mechanism (<input type="file">): [AGREE] Standard and offline-friendly.
- PDF text flow (popup → SW → offscreen → SW): [AGREE] Matches architecture; just ensure large payloads are passed as ArrayBuffer or Blob, not huge strings, to avoid message limits.
- File size limits (soft 10MB): [QUESTION] PDF size is a poor proxy for extraction cost. Alternative: soft limit by page count or extracted text length; show warning after N pages or >X chars.
- OCR for scanned PDFs: [AGREE] Out of scope; show "image-based PDF not supported" when text extraction returns empty.
- New message types (EXTRACT_PDF, EXTRACT_TEXT_FILE): [SUGGEST] Fine, but consider a single `EXTRACT_DOCUMENT` with subtype to reduce message surface.
- Storage for imported files (no persistence): [AGREE] Phase 7 territory.

**Uncertainties**
- PDF.js worker config: [AGREE] This is a real risk. You'll likely need `GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(...)` and a packaged worker file. Inline worker can bloat bundle; external worker needs CSP/manifest wiring.

**Additional recommendations**
- [SUGGEST] Handle encrypted/password PDFs: detect and surface a clear "password required / unsupported" error.
- [SUGGEST] Add a cancellation path for long extractions (user closes popup or taps "Stop").
- [SUGGEST] Normalize PDF text extraction (spacing, line breaks) — PDF.js can return fragmented items; a simple join can produce unreadable TTS.
- [SUGGEST] Surface basic metadata (page count) when extraction completes; helpful feedback with low effort.
- [SUGGEST] Consider memory impact if Kokoro + PDF.js share the same offscreen document; monitor total WASM/JS heap.

**Gap**
- The proposal is for "Document Support," but your stated milestone goal is "Kokoro TTS in browser." If Phase 06 is actually TTS, this plan is for a different phase. Clarify which milestone we're reviewing (the decision list doesn't match the stated goal).

</details>

<details>
<summary>Fix Round (Round 4) — Issues Addressed</summary>

**Issue 1: Misaligned goals**
- FIXED: Added "Scope Clarification" section explicitly stating Phase 06 is Document Support within the v1 Best TTS milestone. Clarified that TTS engine is already complete (Phase 1) and Phase 6 adds new input sources.

**Issue 2: Popup lifecycle risk**
- FIXED: Updated "PDF.js Loading Strategy" decision with explicit popup lifecycle mitigation. Popup only handles file selection and ArrayBuffer creation. All extraction happens in offscreen document. Popup can close after sending ArrayBuffer to service worker.

**Issue 3: Page-count soft limit alone insufficient**
- FIXED: Changed to "Multi-Threshold Strategy" with three combined soft limits: file size (50MB), page count (100 pages), AND extracted text length (500K chars). Each catches different failure modes.

**Issue 4: Shared offscreen memory risk unmitigated**
- FIXED: Added full "Memory Management Strategy" section with:
  - 5-point mitigation approach (lazy loading, sequential operation, cleanup, monitoring, fallback)
  - Explicit fallback plan to split into separate offscreen documents if needed
  - Testing requirements for implementation phase

</details>

<details>
<summary>Fix Round (Round 5) — Additional Issues Addressed</summary>

**Issue 1: Text file handling inconsistent with message protocol**
- Problem: Decision #3 used `file.text()` (returns string) but Decision #5 message protocol requires `ArrayBuffer`
- FIXED: Changed to `file.arrayBuffer()` in popup, with `TextDecoder` decoding in offscreen document. Maintains protocol consistency and centralizes text processing.

**Issue 2: Large ArrayBuffer messaging risks**
- Problem: Sending 50 MB ArrayBuffers via `runtime.sendMessage` risks hitting message limits and causes memory duplication via structured clone
- FIXED: Added "Large File Transfer Strategy" to Decision #2:
  - Files ≤ 10 MB: Direct send
  - Files > 10 MB: Chunked transfer (5 MB chunks) with reassembly in offscreen
  - Documented why Transferable objects aren't usable (SW intermediary)
  - Documented why offscreen can't read File directly (context limitation)
- REVISED (Round 6): Fixed chunking approach to use `file.slice()` instead of splitting a full ArrayBuffer. The original approach still loaded the entire file into popup memory before chunking, defeating the purpose. Now only one 5 MB chunk is in popup memory at a time. Also clarified that offscreen uses IndexedDB for chunk storage during transfer, then reassembles once all chunks arrive.

**Issue 3: Soft limit warnings with closed popup**
- Problem: Page count and extracted text warnings require user confirmation, but popup may be closed
- FIXED: Added comprehensive "Pending Warning UI" flow to Decision #6:
  - Service worker holds pending warning state
  - Extension badge shows "!" indicator
  - Any UI (popup, floating player) can surface pending warnings on open
  - 5-minute timeout auto-cancels to prevent resource leaks

**Issue 4: File size warning timing conflict**
- Problem: "Warning before extraction begins" conflicted with "popup reads file as ArrayBuffer immediately"
- FIXED: Clarified in Decision #2 and #6 that `file.size` is checked BEFORE `file.arrayBuffer()` is called. Size check has zero memory cost. User must confirm before file is read into memory.

</details>

<details>
<summary>Fix Round (Round 6) — Chunking Strategy Corrections</summary>

**Issue 1: Chunking doesn't avoid popup memory load**
- Problem: The previous chunking plan called `file.arrayBuffer()` first (loading entire file into popup memory), THEN split the ArrayBuffer into chunks. This doesn't actually avoid the structured-clone memory duplication issue — the full file is already in memory before chunking begins.
- FIXED: Changed to use `file.slice(start, end)` to read chunks directly from the File object. File objects are backed by disk, so `slice()` doesn't load data into memory until `arrayBuffer()` is called on the slice. Only one 5 MB chunk is in popup memory at any time.

**Issue 2: Internal inconsistency in chunk reassembly**
- Problem: The previous plan said offscreen "reassembles chunks before processing" AND "processes chunks sequentially, not holding all in memory simultaneously." These statements are contradictory — you can't reassemble without holding all chunks.
- FIXED: Clarified the actual approach:
  1. Chunks arrive and are immediately written to IndexedDB (not held in JS heap)
  2. On `DOCUMENT_CHUNK_COMPLETE`, chunks are read from IndexedDB and concatenated into a single ArrayBuffer
  3. The reassembly step does briefly hold the full file in the offscreen document's memory, but this is acceptable because: (a) offscreen has more memory headroom than popup, and (b) the popup memory pressure during transfer is eliminated
  4. IndexedDB chunks are deleted after extraction completes or fails

**Rationale for IndexedDB intermediate storage:** Without IndexedDB, the offscreen document would need to hold all chunks in a JS array while waiting for more chunks to arrive. With 10 chunks of 5 MB each, that's 50 MB in the JS heap during transfer. IndexedDB moves this to browser-managed storage outside the heap, reducing GC pressure and OOM risk.

</details>
