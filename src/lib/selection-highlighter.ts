/**
 * Selection mode highlighting for user-selected text on live pages.
 *
 * Per CONTEXT.md:
 * - Walk DOM text nodes directly (NOT selection.toString())
 * - Single segmentation creates both chunks and spans in lockstep
 * - Track splitText() calls for cleanup restoration
 * - Multiple spans per sentence when crossing element boundaries
 */

import type {
  HighlightState,
  TextNodeOffset,
  SplitNodeRecord
} from './highlight-types';
import { groupSentences } from './text-chunker';
import {
  getSegmentationLocale,
  segmentSentences,
  createScrollContext
} from './highlight-manager';

// Skip these elements when walking text nodes
const SKIP_SELECTORS = 'script, style, textarea, input, [contenteditable]';

/**
 * Build a map from cumulative character offsets to DOM text nodes.
 * Per CONTEXT.md: walk DOM text nodes directly, do NOT use selection.toString()
 */
function buildTextNodeOffsetMap(range: Range): {
  text: string;
  offsets: TextNodeOffset[];
} {
  const offsets: TextNodeOffset[] = [];
  let cumulativeOffset = 0;

  const walker = document.createTreeWalker(
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement!
      : range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (parent?.closest(SKIP_SELECTORS)) {
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
    let nodeSelectedStart = 0;
    let nodeSelectedEnd = nodeText.length;

    // Clip first/last text nodes to the exact range boundaries.
    // Without this, we can accidentally include unselected node text.
    if (node === range.startContainer) {
      nodeSelectedStart = Math.max(0, Math.min(range.startOffset, nodeText.length));
    }
    if (node === range.endContainer) {
      nodeSelectedEnd = Math.max(0, Math.min(range.endOffset, nodeText.length));
    }

    if (nodeSelectedStart >= nodeSelectedEnd) continue;

    const selectedText = nodeText.slice(nodeSelectedStart, nodeSelectedEnd);
    if (!selectedText) continue;

    const start = cumulativeOffset;
    const end = start + selectedText.length;
    offsets.push({
      node,
      startOffset: start,
      endOffset: end,
      nodeSelectedStart,
      nodeSelectedEnd
    });
    textParts.push(selectedText);
    cumulativeOffset = end;
  }

  return { text: textParts.join(''), offsets };
}

/**
 * Find which text nodes intersect a given character range.
 */
function findIntersectingNodes(
  segmentStart: number,
  segmentEnd: number,
  offsets: TextNodeOffset[]
): Array<{ node: Text; localStart: number; localEnd: number }> {
  const result: Array<{ node: Text; localStart: number; localEnd: number }> = [];

  for (const offset of offsets) {
    // Check if this node intersects the segment
    if (offset.endOffset <= segmentStart) continue; // Node is before segment
    if (offset.startOffset >= segmentEnd) break;    // Node is after segment, done

    // Calculate offsets within the selected slice, then map back to original node offsets.
    const selectedLength = offset.endOffset - offset.startOffset;
    const segmentLocalStart = Math.max(0, segmentStart - offset.startOffset);
    const segmentLocalEnd = Math.min(selectedLength, segmentEnd - offset.startOffset);
    const localStart = offset.nodeSelectedStart + segmentLocalStart;
    const localEnd = offset.nodeSelectedStart + segmentLocalEnd;

    if (localStart >= localEnd) continue;

    result.push({ node: offset.node, localStart, localEnd });
  }

  return result;
}

/**
 * Wrap a portion of a text node in a span.
 * If wrapping partial text, uses splitText() and records for cleanup.
 */
function wrapTextNodePortion(
  textNode: Text,
  localStart: number,
  localEnd: number,
  sentenceIndex: number,
  splitRecords: SplitNodeRecord[]
): HTMLSpanElement {
  const originalText = textNode.textContent || '';
  const parent = textNode.parentNode!;
  const nextSibling = textNode.nextSibling;

  // Track nodes that result from splitting
  const resultingNodes: Text[] = [];

  let nodeToWrap: Text = textNode;

  // Split at start if needed
  if (localStart > 0) {
    nodeToWrap = textNode.splitText(localStart);
    resultingNodes.push(textNode, nodeToWrap);
  } else {
    resultingNodes.push(nodeToWrap);
  }

  // Split at end if needed (relative to nodeToWrap)
  const wrapLength = localEnd - localStart;
  if (wrapLength < nodeToWrap.length) {
    const afterNode = nodeToWrap.splitText(wrapLength);
    resultingNodes.push(afterNode);
  }

  // Record split for cleanup
  if (resultingNodes.length > 1) {
    splitRecords.push({
      originalText,
      resultingNodes,
      parentElement: parent as Element,
      nextSibling
    });
  }

  // Create wrapper span
  const span = document.createElement('span');
  span.setAttribute('data-besttts-sentence', String(sentenceIndex));

  // Replace text node with span containing the text
  parent.insertBefore(span, nodeToWrap);
  span.appendChild(nodeToWrap);

  return span;
}

/**
 * Create selection highlighting for user-selected text.
 * Returns HighlightState and chunks array (same segmentation guarantees alignment).
 *
 * Per CONTEXT.md single source of truth architecture:
 * - Content script does ONE segmentation
 * - Returns both state (DOM refs) and chunks (for TTS)
 * - chunks[i] === state.sentences[i] (guaranteed alignment)
 */
export function createSelectionHighlighting(selection: Selection): {
  state: HighlightState;
  chunks: string[];
} | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);

  // Build text-node-to-offset map from DOM (NOT selection.toString())
  const { text, offsets } = buildTextNodeOffsetMap(range);

  if (text.trim().length === 0) {
    return null;
  }

  // Segment text into sentences
  const locale = getSegmentationLocale();
  const segments = segmentSentences(text, locale);

  const splitRecords: SplitNodeRecord[] = [];

  // First pass: create sentence-level spans
  const sentenceSpanGroups: HTMLSpanElement[][] = [];
  const sentenceTexts: string[] = [];
  let sentenceIndex = 0;

  for (const segment of segments) {
    const trimmed = segment.text.trim();
    if (trimmed.length === 0) continue;

    sentenceTexts.push(trimmed);

    const intersecting = findIntersectingNodes(
      segment.startOffset,
      segment.endOffset,
      offsets
    );

    const spans: HTMLSpanElement[] = [];
    for (const { node, localStart, localEnd } of intersecting) {
      if (!node.isConnected) continue;
      const span = wrapTextNodePortion(node, localStart, localEnd, sentenceIndex, splitRecords);
      spans.push(span);
    }

    // Always push to keep indices aligned with sentenceTexts
    sentenceSpanGroups.push(spans);
    sentenceIndex++;
  }

  // Second pass: group sentences into ~150-word chunks
  const groups = groupSentences(sentenceTexts);
  const spanGroups: HTMLSpanElement[][] = [];
  const chunks: string[] = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const indices = groups[gi];
    const groupSpans: HTMLSpanElement[] = [];
    const groupTexts: string[] = [];

    for (const idx of indices) {
      if (idx < sentenceSpanGroups.length) {
        // Update data attribute to reflect the grouped chunk index
        for (const span of sentenceSpanGroups[idx]) {
          span.setAttribute('data-besttts-sentence', String(gi));
        }
        groupSpans.push(...sentenceSpanGroups[idx]);
      }
      groupTexts.push(sentenceTexts[idx]);
    }

    // Always push to keep spanGroups aligned with chunks (same index = same chunk)
    spanGroups.push(groupSpans);
    chunks.push(groupTexts.join(' '));
  }

  // Clear selection to avoid visual confusion
  selection.removeAllRanges();

  // Create scroll context for window (selection mode)
  const scrollContext = createScrollContext(window);

  const state: HighlightState = {
    sourceText: text,
    sentences: chunks,
    spanGroups,
    currentIndex: -1,
    observer: null, // MutationObserver setup in integration plan
    scrollContext,
    isValid: true,
    splitRecords,
    mode: 'selection'
  };

  return { state, chunks };
}

/**
 * Clean up selection highlighting and restore original DOM structure.
 * Per CONTEXT.md: unwrap spans and re-merge split text nodes.
 */
export function cleanupSelectionHighlighting(state: HighlightState): void {
  if (state.mode !== 'selection') return;

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
  for (const record of state.splitRecords.slice().reverse()) {
    mergeTextNodes(record);
  }
  state.splitRecords.length = 0;

  // 4. Normalize to merge any adjacent text nodes we missed
  // Find unique parent elements that contained our spans
  const containers = new Set<Element>();
  document.querySelectorAll('[data-besttts-container]').forEach(el => {
    containers.add(el);
  });
  containers.forEach(container => container.normalize());

  // 5. Clean up state
  state.spanGroups = [];
  state.isValid = false;
}

/**
 * Re-merge split text nodes.
 */
function mergeTextNodes(record: SplitNodeRecord): void {
  const connectedNodes = record.resultingNodes.filter(n => n.isConnected);
  if (connectedNodes.length <= 1) return;

  const parent = connectedNodes[0].parentNode;
  if (!parent) return;

  // Collect text and keep first node
  let mergedText = '';
  for (const node of connectedNodes) {
    mergedText += node.textContent || '';
  }

  // Update first node, remove others
  connectedNodes[0].textContent = mergedText;
  for (let i = 1; i < connectedNodes.length; i++) {
    if (connectedNodes[i].isConnected) {
      connectedNodes[i].remove();
    }
  }
}
