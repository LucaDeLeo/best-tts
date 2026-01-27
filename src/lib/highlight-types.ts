/**
 * Type definitions for the text highlighting system.
 *
 * Per CONTEXT.md:
 * - Sentence-level highlighting (1:1 with TTS chunks)
 * - Supports both overlay mode (extracted content) and selection mode (live DOM)
 * - Multiple spans per sentence when crossing element boundaries
 */

/**
 * Tracks a text node's position in the concatenated source string.
 * Used for mapping sentence boundaries back to DOM positions.
 */
export interface TextNodeOffset {
  node: Text;
  startOffset: number;  // Cumulative offset in concatenated string
  endOffset: number;
}

/**
 * Segment boundary from Intl.Segmenter with position tracking.
 * Preserves original text including whitespace for accurate DOM mapping.
 */
export interface SegmentBoundary {
  sentenceIndex: number;
  startOffset: number;  // In concatenated string
  endOffset: number;
  text: string;         // Original unsanitized segment (may include whitespace)
}

/**
 * Maps a sentence to its DOM spans.
 * A sentence may produce multiple spans if it crosses element boundaries.
 */
export interface SentenceMapping {
  sentenceIndex: number;
  spans: HTMLSpanElement[];  // Multiple spans if sentence crosses elements
  text: string;              // Original segment text (for verification)
}

/**
 * Record of a text node split for cleanup/restoration.
 * When splitText() is called, we permanently mutate the DOM.
 */
export interface SplitNodeRecord {
  originalText: string;         // Full text content before splitting
  resultingNodes: Text[];       // All nodes created by splitting (in order)
  parentElement: Element;       // Parent to re-insert merged node into
  nextSibling: Node | null;     // Sibling for positioning
}

/**
 * Scroll context for auto-scroll with user override detection.
 * Supports both window scrolling (selection mode) and container scrolling (overlay mode).
 */
export interface ScrollContext {
  container: HTMLElement | Window;
  userScrolledRecently: boolean;
  scrollTimeout: ReturnType<typeof setTimeout> | null;
}

/**
 * Main state object for highlight tracking.
 * Single source of truth for all highlighting data.
 */
export interface HighlightState {
  sourceText: string;                    // Original extracted text
  sentences: string[];                   // TTS chunks (trimmed, non-empty)
  spanGroups: HTMLSpanElement[][];       // spanGroups[i] = spans for sentence i
  currentIndex: number;                  // Currently highlighted sentence (-1 = none)
  observer: MutationObserver | null;     // For DOM mutation detection
  scrollContext: ScrollContext | null;   // Scroll tracking context
  isValid: boolean;                      // False if DOM mutations invalidated spans
  splitRecords: SplitNodeRecord[];       // For cleanup/restoration
  mode: 'overlay' | 'selection';         // Current highlighting mode
}

/**
 * Highlighting mode determines how text is rendered and highlighted.
 */
export type HighlightMode = 'overlay' | 'selection';
