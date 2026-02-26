/**
 * Core highlight manager with locale resolution and segmentation.
 *
 * Per CONTEXT.md:
 * - Sentence-level highlighting (1:1 with TTS chunks)
 * - Locale resolution: TTS language > page lang > navigator.language > 'en'
 * - Auto-scroll with user-scroll override detection (3s debounce)
 * - Both overlay and selection mode support
 */

import type {
  HighlightState,
  HighlightMode,
  ScrollContext,
  SegmentBoundary
} from './highlight-types';

const USER_SCROLL_DEBOUNCE_MS = 3000; // Resume auto-scroll after 3s of no user scrolling

/**
 * Get locale for sentence segmentation.
 * Priority: TTS language > page lang > navigator.language > 'en'
 */
export function getSegmentationLocale(): string {
  // Note: TTS language from extension storage would be added here in future
  // For now, use page language or navigator
  const pageLanguage = document.documentElement.lang;
  if (pageLanguage) return pageLanguage;

  return navigator.language || 'en';
}

/**
 * Segment text into sentences with boundary tracking.
 * Preserves original text including whitespace.
 */
export function segmentSentences(text: string, locale: string): SegmentBoundary[] {
  if (!('Segmenter' in Intl)) {
    // Fallback for older browsers (unlikely in modern Chrome)
    return fallbackSegmentation(text);
  }

  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  const segments = [...segmenter.segment(text)];

  // Preserve ALL segments including whitespace-only
  return segments.map((seg, idx) => ({
    sentenceIndex: idx,
    startOffset: seg.index,
    endOffset: seg.index + seg.segment.length,
    text: seg.segment  // Keep original, no trim()
  }));
}

/**
 * Regex fallback for browsers without Intl.Segmenter.
 */
function fallbackSegmentation(text: string): SegmentBoundary[] {
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

/**
 * Create scroll context with user-scroll detection.
 */
export function createScrollContext(container: HTMLElement | Window): ScrollContext {
  const ctx: ScrollContext = {
    container,
    userScrolledRecently: false,
    scrollTimeout: null,
    scrollHandler: null
  };

  const scrollTarget = container === window ? window : container;

  const handleScroll = () => {
    ctx.userScrolledRecently = true;
    if (ctx.scrollTimeout) clearTimeout(ctx.scrollTimeout);
    ctx.scrollTimeout = setTimeout(() => {
      ctx.userScrolledRecently = false;
    }, USER_SCROLL_DEBOUNCE_MS);
  };

  ctx.scrollHandler = handleScroll;
  scrollTarget.addEventListener('scroll', handleScroll, { passive: true });

  return ctx;
}

/**
 * Cleanup scroll context listeners.
 */
export function destroyScrollContext(ctx: ScrollContext): void {
  if (ctx.scrollTimeout) clearTimeout(ctx.scrollTimeout);
  if (ctx.scrollHandler) {
    const scrollTarget = ctx.container === window ? window : ctx.container;
    scrollTarget.removeEventListener('scroll', ctx.scrollHandler);
    ctx.scrollHandler = null;
  }
}

/**
 * Create initial empty highlight state.
 */
export function createEmptyHighlightState(mode: HighlightMode): HighlightState {
  return {
    sourceText: '',
    sentences: [],
    spanGroups: [],
    currentIndex: -1,
    observer: null,
    scrollContext: null,
    isValid: false,
    splitRecords: [],
    mode
  };
}

/**
 * Highlight a sentence by index (add active class to all spans in group).
 */
export function highlightSentence(state: HighlightState, index: number): void {
  if (!state.isValid || index < 0 || index >= state.spanGroups.length) return;

  // Remove previous highlight
  if (state.currentIndex >= 0 && state.spanGroups[state.currentIndex]) {
    for (const span of state.spanGroups[state.currentIndex]) {
      span.classList.remove('besttts-highlight-active');
    }
  }

  // Add new highlight
  state.currentIndex = index;
  for (const span of state.spanGroups[index]) {
    span.classList.add('besttts-highlight-active');
  }
}

/**
 * Remove all highlights.
 */
export function clearHighlight(state: HighlightState): void {
  if (state.currentIndex >= 0 && state.spanGroups[state.currentIndex]) {
    for (const span of state.spanGroups[state.currentIndex]) {
      span.classList.remove('besttts-highlight-active');
    }
  }
  state.currentIndex = -1;
}

/**
 * Auto-scroll to make the highlighted sentence visible.
 * Respects user scroll override (3s debounce).
 */
export function maybeScrollToSentence(state: HighlightState): void {
  if (!state.scrollContext || state.scrollContext.userScrolledRecently) return;
  if (state.currentIndex < 0 || !state.spanGroups[state.currentIndex]) return;

  const span = state.spanGroups[state.currentIndex][0]; // First span of sentence
  if (!span || !span.isConnected) return;

  const rect = span.getBoundingClientRect();

  if (state.scrollContext.container === window) {
    // Selection mode: check against viewport
    const isOffScreen = rect.top < 0 || rect.bottom > window.innerHeight;
    if (isOffScreen) {
      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  } else {
    // Overlay mode: check against container bounds
    const containerEl = state.scrollContext.container as HTMLElement;
    const containerRect = containerEl.getBoundingClientRect();
    const isOffScreen = rect.top < containerRect.top || rect.bottom > containerRect.bottom;
    if (isOffScreen) {
      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}
