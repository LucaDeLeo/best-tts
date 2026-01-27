/**
 * Overlay mode highlighting for extracted article content.
 *
 * Per CONTEXT.md:
 * - Render extracted content in extension-controlled container
 * - Each sentence maps 1:1 to a span with data-besttts-sentence attribute
 * - Single segmentation creates both chunks and spans in lockstep
 * - Uses textContent and DOM methods instead of innerHTML for security
 */

import type { HighlightState, SegmentBoundary } from './highlight-types';
import {
  getSegmentationLocale,
  segmentSentences,
  createScrollContext,
  createEmptyHighlightState
} from './highlight-manager';

const OVERLAY_CONTAINER_ID = 'besttts-overlay-container';

/**
 * Create or get the overlay container for rendering highlighted content.
 * Container is positioned fixed and styled for reading.
 */
function getOrCreateOverlayContainer(): HTMLElement {
  let container = document.getElementById(OVERLAY_CONTAINER_ID);
  if (container) return container;

  container = document.createElement('div');
  container.id = OVERLAY_CONTAINER_ID;
  container.setAttribute('data-besttts-container', 'true');

  // Overlay styling - positioned for reading, scrollable
  Object.assign(container.style, {
    position: 'fixed',
    top: '0',
    right: '0',
    width: '400px',
    height: '100vh',
    backgroundColor: 'white',
    boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.15)',
    overflowY: 'auto',
    padding: '24px',
    zIndex: '2147483647',  // Max z-index
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '16px',
    lineHeight: '1.6',
    color: '#1a1a1a'
  });

  // Support dark mode
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    Object.assign(container.style, {
      backgroundColor: '#1a1a1a',
      color: '#e5e5e5'
    });
  }

  document.body.appendChild(container);
  return container;
}

/**
 * Remove the overlay container from the DOM.
 */
export function removeOverlayContainer(): void {
  document.getElementById(OVERLAY_CONTAINER_ID)?.remove();
}

/**
 * Clear overlay container content safely without innerHTML.
 */
function clearOverlayContainer(container: HTMLElement): void {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

/**
 * Create overlay highlighting for extracted article content.
 * Returns HighlightState and chunks array (same segmentation guarantees alignment).
 *
 * Per CONTEXT.md single source of truth architecture:
 * - Content script does ONE segmentation
 * - Returns both state (DOM refs) and chunks (for TTS)
 * - chunks[i] === state.sentences[i] (guaranteed alignment)
 */
export function createOverlayHighlighting(sourceText: string): {
  state: HighlightState;
  chunks: string[];
} {
  const locale = getSegmentationLocale();
  const segments = segmentSentences(sourceText, locale);

  // Create aligned chunks and spans
  const container = getOrCreateOverlayContainer();
  clearOverlayContainer(container); // Safe clear without innerHTML

  const spanGroups: HTMLSpanElement[][] = [];
  const chunks: string[] = [];

  let chunkIndex = 0;
  for (const segment of segments) {
    const trimmed = segment.text.trim();
    if (trimmed.length === 0) continue; // Skip empty segments

    // This segment becomes TTS chunk at index `chunkIndex`
    chunks.push(trimmed);

    // Create span for this sentence
    const span = document.createElement('span');
    span.setAttribute('data-besttts-sentence', String(chunkIndex));
    span.textContent = segment.text; // Keep original whitespace in display

    container.appendChild(span);
    spanGroups.push([span]); // Single span per sentence in overlay mode

    chunkIndex++;
  }

  // Create scroll context for the overlay container
  const scrollContext = createScrollContext(container);

  const state: HighlightState = {
    sourceText,
    sentences: chunks,
    spanGroups,
    currentIndex: -1,
    observer: null, // No mutation observer needed for overlay mode
    scrollContext,
    isValid: true,
    splitRecords: [], // No split records needed for overlay mode
    mode: 'overlay'
  };

  return { state, chunks };
}

/**
 * Render article title and content in overlay.
 * Returns highlight state and chunks.
 */
export function renderOverlayContent(
  title: string | undefined,
  content: string
): {
  state: HighlightState;
  chunks: string[];
} {
  const container = getOrCreateOverlayContainer();
  clearOverlayContainer(container); // Safe clear

  // Add close button first (positioned absolutely)
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'X';
  closeBtn.setAttribute('aria-label', 'Close reader');
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '12px',
    right: '12px',
    width: '32px',
    height: '32px',
    border: 'none',
    borderRadius: '50%',
    backgroundColor: '#e5e5e5',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold'
  });
  closeBtn.onclick = () => {
    removeOverlayContainer();
    // Dispatch event for cleanup
    window.dispatchEvent(new CustomEvent('besttts-overlay-closed'));
  };
  container.appendChild(closeBtn);

  // Add title if provided
  if (title) {
    const titleEl = document.createElement('h1');
    titleEl.textContent = title;
    Object.assign(titleEl.style, {
      marginTop: '32px', // Below close button
      marginBottom: '16px',
      fontSize: '20px',
      fontWeight: '600'
    });
    container.appendChild(titleEl);
  }

  // Create content wrapper for sentences
  const contentWrapper = document.createElement('div');
  contentWrapper.setAttribute('data-besttts-content', 'true');
  container.appendChild(contentWrapper);

  // Now create highlighting in the content wrapper
  const locale = getSegmentationLocale();
  const segments = segmentSentences(content, locale);

  const spanGroups: HTMLSpanElement[][] = [];
  const chunks: string[] = [];

  let chunkIndex = 0;
  for (const segment of segments) {
    const trimmed = segment.text.trim();
    if (trimmed.length === 0) continue;

    chunks.push(trimmed);

    const span = document.createElement('span');
    span.setAttribute('data-besttts-sentence', String(chunkIndex));
    span.textContent = segment.text;

    contentWrapper.appendChild(span);
    spanGroups.push([span]);

    chunkIndex++;
  }

  const scrollContext = createScrollContext(container);

  const state: HighlightState = {
    sourceText: content,
    sentences: chunks,
    spanGroups,
    currentIndex: -1,
    observer: null,
    scrollContext,
    isValid: true,
    splitRecords: [],
    mode: 'overlay'
  };

  return { state, chunks };
}
