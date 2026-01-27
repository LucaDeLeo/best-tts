---
phase: 06
plan: 02
subsystem: document-extraction
tags: [pdf, pdfjs, extraction, text-normalization]
dependency-graph:
  requires: [06-01]
  provides: [pdf-extraction, text-normalization]
  affects: [06-04, 06-05]
tech-stack:
  added: [pdfjs-dist]
  patterns: [lazy-loading, memory-cleanup, abort-signal]
key-files:
  created:
    - src/lib/pdf-extractor.ts
  modified:
    - vite.config.ts
    - src/offscreen/offscreen.ts
    - src/lib/document-types.ts
decisions:
  - id: 06-02-01
    decision: External PDF.js worker with inline fallback
    rationale: Better memory isolation, graceful degradation
metrics:
  duration: 3 min
  completed: 2026-01-27
---

# Phase 06 Plan 02: PDF Extraction Summary

PDF.js text extraction with normalization, encrypted PDF detection, and early page count warning.

## Completed Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Configure Vite to copy PDF.js worker | b2e4c5c | vite.config.ts |
| 2 | Create PDF extractor module | cbda149 | src/lib/pdf-extractor.ts |
| 3 | Integrate PDF extraction in offscreen | 30eb5c1 | src/offscreen/offscreen.ts, src/lib/document-types.ts |

## Implementation Details

### PDF.js Worker Configuration
- External worker copied to `dist/assets/pdf.worker.mjs`
- Chrome runtime URL used for extension context
- Inline fallback if external worker unavailable
- Worker provides better memory isolation for large PDFs

### Text Extraction Flow
1. Load PDF with `getDocument()` (fonts/streaming disabled)
2. Get page count from metadata (early check)
3. If page count > threshold, trigger warning callback
4. Extract text items per page via `getTextContent()`
5. Normalize text for coherent TTS output
6. Cleanup: call `pdfDocument.destroy()` to release memory

### Text Normalization (per CONTEXT.md Decision #9)
- Join text items with proper spacing (gap-based detection)
- Handle hyphenated line breaks (join lowercase continuations)
- Collapse multiple whitespace to single space
- Preserve page boundaries (double newline)

### Error Handling
- **Encrypted PDFs:** Detected via `onPassword` callback, returns user-friendly message
- **Image-based PDFs:** Empty text result triggers "no text found" error
- **Cancellation:** AbortSignal checked between pages

### Progress Broadcasting
- Loading stage: 0-100% during PDF load
- Extracting stage: 0-100% as pages are processed
- Messages sent via `chrome.runtime.sendMessage` (may fail if popup closed)

## Key Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| 06-02-01 | External worker with inline fallback | Memory isolation for PDF.js, graceful degradation |

## Deviations from Plan

None - plan executed exactly as written.

## Testing Notes

- pdf.worker.mjs (2.2 MB) copied to dist/assets
- offscreen bundle increased from ~3.7 MB to ~4.3 MB (PDF.js included)
- TypeScript compiles without errors
- Build completes successfully

## Next Phase Readiness

Ready for 06-03 (Text File Extraction) or 06-04 (Import UI).

The following are now available:
- `extractPdfText(data, options)` function in pdf-extractor.ts
- PDF extraction case in offscreen handler
- `EXTRACTION_THRESHOLDS.PAGE_COUNT` for warning threshold
- `pausedForPageCountWarning` field in extraction results
