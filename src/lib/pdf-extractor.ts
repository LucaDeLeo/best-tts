/**
 * PDF text extraction using PDF.js.
 * Per CONTEXT.md Decision #1: PDF.js for PDF text extraction.
 *
 * This module runs in the offscreen document where PDF.js WASM/Worker can execute.
 * Per CONTEXT.md Memory Management: Lazy loading, cleanup after extraction.
 */

import * as pdfjs from 'pdfjs-dist';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api';

// Configure PDF.js worker path for extension context
// Uses external worker for better memory isolation
// Fallback to inline worker if external fails
try {
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('assets/pdf.worker.mjs');
} catch {
  // Inline worker fallback - PDF.js will use embedded worker
  console.warn('PDF.js: Using inline worker (external worker not available)');
}

/**
 * Result of PDF text extraction.
 */
export interface PdfExtractionResult {
  success: boolean;
  text?: string;
  title?: string;
  pageCount?: number;
  textLength?: number;
  error?: string;
  /** Set when extraction paused for page count warning (early pause per CONTEXT Decision #6) */
  pausedForPageCountWarning?: boolean;
}

/**
 * Callback for extraction progress updates.
 */
export type ProgressCallback = (progress: {
  stage: 'loading' | 'extracting';
  current: number;
  total: number;
}) => void;

/**
 * Callback for page count warning (early pause per CONTEXT Decision #6).
 * Called after PDF metadata load, before full extraction.
 * Return true to continue extraction, false to pause.
 */
export type PageCountWarningCallback = (pageCount: number, threshold: number) => Promise<boolean>;

/**
 * Options for PDF extraction.
 */
export interface PdfExtractionOptions {
  /** Callback for progress updates */
  onProgress?: ProgressCallback;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Page count threshold for warning (default: 100) */
  pageCountThreshold?: number;
  /** Callback when page count exceeds threshold. Return true to continue, false to pause. */
  onPageCountWarning?: PageCountWarningCallback;
}

/**
 * Extract text from a PDF document.
 *
 * Per CONTEXT.md Decision #9: Normalize PDF.js text output for coherent TTS.
 * Per CONTEXT.md Decision #10: Detect and surface error for encrypted PDFs.
 *
 * @param data ArrayBuffer containing PDF data
 * @param options Extraction options
 * @returns Extraction result with text, page count, and metadata
 */
export async function extractPdfText(
  data: ArrayBuffer,
  options: PdfExtractionOptions = {}
): Promise<PdfExtractionResult> {
  const {
    onProgress,
    signal,
    pageCountThreshold = 100,
    onPageCountWarning
  } = options;

  let pdfDocument: pdfjs.PDFDocumentProxy | null = null;

  try {
    // Check for cancellation before starting
    if (signal?.aborted) {
      return { success: false, error: 'Extraction cancelled' };
    }

    // Load PDF document
    onProgress?.({ stage: 'loading', current: 0, total: 1 });

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(data),
      // Disable features we don't need for text extraction
      disableFontFace: true,
      disableRange: true,
      disableStream: true,
    });

    // Handle password-protected PDFs
    // PDF.js calls onPassword when PDF is encrypted
    loadingTask.onPassword = (updateCallback: (password: string) => void, reason: number) => {
      // Reason 1 = needs password, Reason 2 = incorrect password
      // We don't support password input, so reject immediately
      loadingTask.destroy();
      throw new PasswordProtectedError();
    };

    pdfDocument = await loadingTask.promise;

    const pageCount = pdfDocument.numPages;
    onProgress?.({ stage: 'loading', current: 1, total: 1 });

    // Check for cancellation after loading
    if (signal?.aborted) {
      return { success: false, error: 'Extraction cancelled' };
    }

    // Get document metadata for title
    const metadata = await pdfDocument.getMetadata().catch(() => null);
    // PDF.js types info as Object; cast to access standard PDF metadata fields
    const info = metadata?.info as { Title?: string } | undefined;
    const title = info?.Title;

    // === EARLY PAGE COUNT WARNING (per CONTEXT.md Decision #6) ===
    // Check page count AFTER metadata load, BEFORE full extraction.
    // This avoids wasting work on oversized PDFs.
    if (pageCount > pageCountThreshold && onPageCountWarning) {
      const shouldContinue = await onPageCountWarning(pageCount, pageCountThreshold);
      if (!shouldContinue) {
        // Return early with page count info but no text (paused for warning)
        return {
          success: true,
          pageCount,
          title: title || undefined,
          pausedForPageCountWarning: true
        };
      }
    }

    // Check for cancellation after warning check
    if (signal?.aborted) {
      return { success: false, error: 'Extraction cancelled' };
    }

    // Extract text from all pages
    const pageTexts: string[] = [];

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      // Check for cancellation between pages
      if (signal?.aborted) {
        return { success: false, error: 'Extraction cancelled' };
      }

      onProgress?.({ stage: 'extracting', current: pageNum, total: pageCount });

      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Extract and normalize text from this page
      const pageText = normalizePageText(textContent.items);
      if (pageText) {
        pageTexts.push(pageText);
      }
    }

    // Join pages with double newlines (paragraph break)
    const fullText = pageTexts.join('\n\n');

    // Check if we got any text (image-based PDF check)
    if (!fullText.trim()) {
      return {
        success: false,
        error: 'This PDF appears to be image-based. No text could be extracted.',
        pageCount
      };
    }

    return {
      success: true,
      text: fullText,
      title: title || undefined,
      pageCount,
      textLength: fullText.length
    };

  } catch (error) {
    // Handle specific error types
    if (error instanceof PasswordProtectedError) {
      return {
        success: false,
        error: 'This PDF is password-protected. Please open an unprotected PDF.'
      };
    }

    // PDF.js throws PasswordException for encrypted files
    if (error instanceof Error && error.message.includes('password')) {
      return {
        success: false,
        error: 'This PDF is password-protected. Please open an unprotected PDF.'
      };
    }

    console.error('PDF extraction error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to extract PDF text'
    };

  } finally {
    // Cleanup: destroy PDF document to release memory
    // Per CONTEXT.md Memory Management: Call pdfDocument.destroy()
    if (pdfDocument) {
      await pdfDocument.destroy().catch(() => {});
    }
  }
}

/**
 * Custom error for password-protected PDFs.
 */
class PasswordProtectedError extends Error {
  constructor() {
    super('PDF is password-protected');
    this.name = 'PasswordProtectedError';
  }
}

/**
 * Type guard for TextItem (vs TextMarkedContent).
 */
function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return 'str' in item;
}

/**
 * Normalize text items from a PDF page for coherent TTS.
 *
 * Per CONTEXT.md Decision #9:
 * - Join text items with proper spacing
 * - Collapse multiple whitespace to single space
 * - Preserve paragraph breaks (double newline)
 * - Handle hyphenated line breaks
 *
 * @param items Raw text items from PDF.js
 * @returns Normalized text string
 */
function normalizePageText(items: (TextItem | TextMarkedContent)[]): string {
  if (items.length === 0) return '';

  const textParts: string[] = [];
  let lastY: number | null = null;
  let lastEndX: number | null = null;
  let currentLine: string[] = [];

  for (const item of items) {
    if (!isTextItem(item) || !item.str) continue;

    const { str, transform } = item;
    // transform[5] is the Y coordinate, transform[4] is the X coordinate
    const y = transform[5];
    const x = transform[4];
    const width = item.width || 0;

    // Detect line break (significant Y change)
    const isNewLine = lastY !== null && Math.abs(y - lastY) > 5;

    if (isNewLine) {
      // Flush current line
      if (currentLine.length > 0) {
        const lineText = currentLine.join('');

        // Handle hyphenated line breaks
        // If line ends with hyphen and next line starts lowercase, join without hyphen
        if (lineText.endsWith('-') && textParts.length > 0) {
          // Will be handled when processing next line
          textParts.push(lineText);
        } else {
          textParts.push(lineText);
        }

        currentLine = [];
      }
    }

    // Add space between items if there's a gap
    if (currentLine.length > 0 && lastEndX !== null) {
      const gap = x - lastEndX;
      // If gap is significant (more than ~0.3 of average character width), add space
      if (gap > 2) {
        currentLine.push(' ');
      }
    }

    currentLine.push(str);
    lastY = y;
    lastEndX = x + width;
  }

  // Flush remaining line
  if (currentLine.length > 0) {
    textParts.push(currentLine.join(''));
  }

  // Post-process: join lines and handle hyphenation
  let text = '';
  for (let i = 0; i < textParts.length; i++) {
    const part = textParts[i];

    // Handle hyphenation: if previous line ended with hyphen and this starts lowercase
    if (i > 0 && text.endsWith('-')) {
      const nextChar = part.charAt(0);
      if (nextChar && nextChar === nextChar.toLowerCase() && nextChar !== nextChar.toUpperCase()) {
        // Remove trailing hyphen and join directly
        text = text.slice(0, -1) + part;
        continue;
      }
    }

    // Add space between lines (unless starting paragraph)
    if (text && !text.endsWith('\n')) {
      text += ' ';
    }
    text += part;
  }

  // Collapse multiple spaces to single space
  text = text.replace(/  +/g, ' ');

  // Trim whitespace from lines
  text = text.split('\n').map(line => line.trim()).join('\n');

  return text.trim();
}

/**
 * Check if extraction result exceeds text length threshold.
 * Used for soft limit warning check.
 */
export function exceedsTextLengthThreshold(textLength: number, threshold: number): boolean {
  return textLength > threshold;
}
