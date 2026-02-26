/**
 * Extraction state management for service worker.
 * Per CONTEXT.md: SW stores pending confirmation state and handles warnings.
 *
 * IMPORTANT: Chunk storage is handled by offscreen document using IndexedDB,
 * NOT in service worker memory. This avoids MV3 SW suspension issues.
 * See CONTEXT.md Decision #2 for rationale.
 */

import type {
  ExtractionState,
  PendingWarning,
  DocumentType,
} from './document-types';

// Current extraction state (in-memory, service worker lifetime)
let currentExtraction: ExtractionState | null = null;

// Chunk metadata only (actual data stored in offscreen IndexedDB)
const chunkMetadata = new Map<string, { receivedChunks: Set<number>; totalChunks: number }>();

// Warning timeout handles
const warningTimeouts = new Map<string, number>();

// Warning timeout duration (5 minutes per CONTEXT.md)
const WARNING_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Get current extraction state.
 */
export function getExtractionState(): ExtractionState | null {
  return currentExtraction;
}

/**
 * Initialize a new extraction.
 */
export function initExtractionState(
  extractionId: string,
  documentType: DocumentType,
  filename: string,
  fileSize: number
): ExtractionState {
  // Clear any previous extraction
  clearExtractionState();

  currentExtraction = {
    extractionId,
    status: 'uploading',
    documentType,
    filename,
    fileSize,
    progress: 0
  };

  return currentExtraction;
}

/**
 * Update extraction state.
 */
export function updateExtractionState(
  updates: Partial<ExtractionState>
): ExtractionState | null {
  if (!currentExtraction) return null;

  currentExtraction = { ...currentExtraction, ...updates };
  return currentExtraction;
}

/**
 * Clear extraction state.
 */
export function clearExtractionState(): void {
  if (currentExtraction) {
    // Clear any pending warning timeout
    const timeout = warningTimeouts.get(currentExtraction.extractionId);
    if (timeout) {
      clearTimeout(timeout);
      warningTimeouts.delete(currentExtraction.extractionId);
    }

    // Clear chunk metadata (actual chunks are in offscreen IndexedDB)
    chunkMetadata.delete(currentExtraction.extractionId);
  }

  currentExtraction = null;

  // Clear badge
  chrome.action.setBadgeText({ text: '' }).catch(() => {});
}

/**
 * Track chunk receipt (metadata only - actual data forwarded to offscreen).
 * Per CONTEXT.md Decision #2: Chunks stored in offscreen IndexedDB, not SW memory.
 */
export function trackChunkReceived(
  extractionId: string,
  chunkIndex: number,
  totalChunks: number
): void {
  if (!chunkMetadata.has(extractionId)) {
    chunkMetadata.set(extractionId, { receivedChunks: new Set<number>(), totalChunks });
  }
  const meta = chunkMetadata.get(extractionId)!;
  meta.receivedChunks.add(chunkIndex);
}

/**
 * Check if all chunks have been received.
 */
export function allChunksReceived(extractionId: string): boolean {
  const meta = chunkMetadata.get(extractionId);
  if (!meta) return false;
  return meta.receivedChunks.size === meta.totalChunks;
}

/**
 * Get chunk metadata for an extraction.
 */
export function getChunkMetadata(extractionId: string): { receivedChunks: number; totalChunks: number } | null {
  const meta = chunkMetadata.get(extractionId);
  if (!meta) return null;
  return {
    receivedChunks: meta.receivedChunks.size,
    totalChunks: meta.totalChunks
  };
}

/**
 * Set pending warning and start timeout.
 * Per CONTEXT.md Decision #6: 5-minute timeout auto-cancels.
 */
export function setPendingWarning(
  warning: PendingWarning,
  onTimeout: () => void
): void {
  if (!currentExtraction) return;

  currentExtraction = {
    ...currentExtraction,
    status: 'warning',
    pendingWarning: warning
  };

  // Show badge indicator
  chrome.action.setBadgeText({ text: '!' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#ffc107' }).catch(() => {});

  // Set timeout for auto-cancel
  const timeout = setTimeout(() => {
    console.log('Warning timeout - auto-cancelling extraction');
    onTimeout();
  }, WARNING_TIMEOUT_MS) as unknown as number;

  warningTimeouts.set(warning.extractionId, timeout);
}

/**
 * Clear pending warning (user responded).
 */
export function clearPendingWarning(extractionId: string): void {
  const timeout = warningTimeouts.get(extractionId);
  if (timeout) {
    clearTimeout(timeout);
    warningTimeouts.delete(extractionId);
  }

  // Clear badge
  chrome.action.setBadgeText({ text: '' }).catch(() => {});

  if (currentExtraction?.extractionId === extractionId) {
    currentExtraction = {
      ...currentExtraction,
      pendingWarning: undefined
    };
  }
}

/**
 * Check if extraction is cancelled.
 */
export function isExtractionCancelled(extractionId: string): boolean {
  return !currentExtraction || currentExtraction.extractionId !== extractionId;
}
