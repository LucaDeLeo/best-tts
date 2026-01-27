/**
 * Content extraction utilities for extracting text from webpages.
 * Supports both text selection extraction and full-page article extraction.
 */

import { Readability } from '@mozilla/readability';

// Configuration constants
const STABILIZATION_DELAY = 300;  // No mutations for 300ms = stable
const MAX_WAIT_TIME = 3000;       // 3 second ceiling for SPA stabilization
const MIN_CONTENT_LENGTH = 100;   // Minimum chars for valid article content

/**
 * Result from article extraction.
 */
export interface ArticleResult {
  success: boolean;
  title?: string;
  content?: string;
  url?: string;
  error?: string;
}

/**
 * Get user's currently selected text from the page.
 * Handles regular text selection, form field selections, and contenteditable elements.
 *
 * @returns The selected text trimmed, or null if no text is selected.
 */
export function getSelectedText(): string | null {
  // First try window.getSelection() for regular text
  const selection = window.getSelection();
  if (selection && selection.toString().trim()) {
    return selection.toString().trim();
  }

  // Handle form field selections (input/textarea)
  const activeEl = document.activeElement;
  if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) {
    const { selectionStart, selectionEnd, value } = activeEl;
    if (selectionStart !== null && selectionEnd !== null && selectionStart !== selectionEnd) {
      return value.substring(selectionStart, selectionEnd).trim();
    }
  }

  // Handle contenteditable
  if (activeEl instanceof HTMLElement && activeEl.isContentEditable) {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      return selection.toString().trim();
    }
  }

  return null;
}

/**
 * Wait for SPA content to stabilize before extraction.
 * Uses MutationObserver to detect when DOM mutations stop, indicating
 * that dynamic content has finished loading.
 *
 * @returns Promise that resolves when content is stable (no mutations for STABILIZATION_DELAY)
 *          or MAX_WAIT_TIME has elapsed.
 */
export function waitForContentStabilization(): Promise<void> {
  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;
    let totalWaitTimeout: ReturnType<typeof setTimeout>;

    const observer = new MutationObserver(() => {
      // Reset timeout on each mutation
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        observer.disconnect();
        clearTimeout(totalWaitTimeout);
        resolve();
      }, STABILIZATION_DELAY);
    });

    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Initial delay check (might already be stable)
    timeout = setTimeout(() => {
      observer.disconnect();
      clearTimeout(totalWaitTimeout);
      resolve();
    }, STABILIZATION_DELAY);

    // Hard ceiling - don't wait forever
    totalWaitTimeout = setTimeout(() => {
      observer.disconnect();
      clearTimeout(timeout);
      resolve();
    }, MAX_WAIT_TIME);
  });
}

/**
 * Extract article content from the current page using Readability.
 * Waits for SPA content to stabilize before extraction.
 *
 * @returns ArticleResult with success status and extracted content or error.
 */
export async function extractArticle(): Promise<ArticleResult> {
  try {
    // Wait for SPA content to stabilize
    await waitForContentStabilization();

    // Clone document to avoid modifying the page
    const documentClone = document.cloneNode(true) as Document;

    // Run Readability
    const reader = new Readability(documentClone);
    const article = reader.parse();

    if (!article || !article.textContent) {
      return {
        success: false,
        error: 'Could not extract article content. Try selecting text manually.',
        url: window.location.href
      };
    }

    // Check minimum content threshold
    if (article.textContent.trim().length < MIN_CONTENT_LENGTH) {
      return {
        success: false,
        error: 'Extracted content too short. Try selecting text manually.',
        url: window.location.href
      };
    }

    return {
      success: true,
      title: article.title || document.title,
      content: article.textContent.trim(),
      url: window.location.href
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Extraction failed',
      url: window.location.href
    };
  }
}
