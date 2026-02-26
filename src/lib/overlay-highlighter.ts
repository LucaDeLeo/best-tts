/**
 * Overlay mode highlighting for extracted article content.
 *
 * Per CONTEXT.md:
 * - Render extracted content in extension-controlled container
 * - Each sentence maps 1:1 to a span with data-besttts-sentence attribute
 * - Single segmentation creates both chunks and spans in lockstep
 * - Uses textContent and DOM methods instead of innerHTML for security
 */

import type { HighlightState } from './highlight-types';
import { groupSentences } from './text-chunker';
import {
  getSegmentationLocale,
  segmentSentences,
  createScrollContext,
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
  // Sentences are grouped into ~150-word blocks for efficient TTS generation.
  // Each spanGroup contains multiple sentence spans; highlightSentence highlights them all.
  const locale = getSegmentationLocale();
  const segments = segmentSentences(content, locale);

  // First: create all sentence spans
  const allSentences: { text: string; trimmed: string; span: HTMLSpanElement }[] = [];
  for (const segment of segments) {
    const trimmed = segment.text.trim();
    if (trimmed.length === 0) continue;

    const span = document.createElement('span');
    span.textContent = segment.text;
    contentWrapper.appendChild(span);
    allSentences.push({ text: segment.text, trimmed, span });
  }

  // Second: group sentences into ~150-word chunks
  const sentenceTexts = allSentences.map(s => s.trimmed);
  const groups = groupSentences(sentenceTexts);

  const spanGroups: HTMLSpanElement[][] = [];
  const chunks: string[] = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const indices = groups[gi];
    const groupSpans: HTMLSpanElement[] = [];
    const groupTexts: string[] = [];

    for (const idx of indices) {
      allSentences[idx].span.setAttribute('data-besttts-sentence', String(gi));
      groupSpans.push(allSentences[idx].span);
      groupTexts.push(allSentences[idx].trimmed);
    }

    spanGroups.push(groupSpans);
    chunks.push(groupTexts.join(' '));
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
