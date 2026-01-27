/**
 * Autosave module for library reading position tracking.
 *
 * Per CONTEXT.md Autosave section:
 * - 10-second throttle between saves
 * - Immediate save on pause/stop (force=true bypasses throttle)
 * - Resume algorithm with fallback chain:
 *   1. Exact match (hash + version match)
 *   2. Snippet search
 *   3. Percentage-based approximation
 *   4. Beginning (ultimate fallback)
 */

import type { ResumeData } from './library-types';
import { CHUNKING_VERSION } from './library-types';

const THROTTLE_MS = 10_000; // 10 seconds per CONTEXT.md

// ============================================================================
// Autosaver Factory
// ============================================================================

export interface AutosaveConfig {
  itemId: string;
  totalChunks: number;
  contentLength: number;
  contentHash: string;
  onSave: (resumeData: ResumeData) => Promise<void>;
}

export interface Autosaver {
  onChunkChange: (chunkIndex: number, chunkText: string) => void;
  saveNow: () => Promise<void>;
  dispose: () => void;
}

/**
 * Create an autosaver instance for tracking reading position.
 *
 * Usage:
 * ```ts
 * const autosaver = createAutosaver({
 *   itemId: 'abc123',
 *   totalChunks: 10,
 *   contentLength: 5000,
 *   contentHash: 'sha256...',
 *   onSave: async (resumeData) => {
 *     await updateLibraryItemPosition(itemId, resumeData);
 *   }
 * });
 *
 * // During playback
 * autosaver.onChunkChange(0, 'First sentence...');
 * autosaver.onChunkChange(1, 'Second sentence...');
 *
 * // On pause/stop
 * await autosaver.saveNow();
 *
 * // Cleanup
 * autosaver.dispose();
 * ```
 */
export function createAutosaver(config: AutosaveConfig): Autosaver {
  const { itemId, totalChunks, contentLength, contentHash, onSave } = config;

  let lastSaveTime = 0;
  let lastSavedChunk = -1;
  let currentChunkIndex = 0;
  let currentChunkText = '';
  let disposed = false;

  const calculateCharOffset = (chunkIndex: number): number => {
    // Approximate character offset based on chunk index
    // Assumes roughly equal chunk sizes
    if (totalChunks === 0) return 0;
    return Math.floor((chunkIndex / totalChunks) * contentLength);
  };

  const createResumeData = (): ResumeData => ({
    currentChunkIndex,
    chunkingVersion: CHUNKING_VERSION,
    contentSnippet: currentChunkText.slice(0, 100),
    charOffset: calculateCharOffset(currentChunkIndex),
    contentLength,
    contentHash,
  });

  const savePosition = async (force = false): Promise<void> => {
    if (disposed) return;

    const now = Date.now();
    if (!force && now - lastSaveTime < THROTTLE_MS) {
      return; // Throttled
    }
    if (currentChunkIndex === lastSavedChunk) {
      return; // No change
    }

    try {
      await onSave(createResumeData());
      lastSaveTime = now;
      lastSavedChunk = currentChunkIndex;
    } catch (error) {
      console.error('Autosave failed:', error);
    }
  };

  return {
    onChunkChange: (chunkIndex: number, chunkText: string) => {
      currentChunkIndex = chunkIndex;
      currentChunkText = chunkText;
      savePosition().catch(console.error);
    },
    saveNow: () => savePosition(true),
    dispose: () => {
      disposed = true;
    },
  };
}

// ============================================================================
// Resume Position Algorithm
// ============================================================================

export interface ResumeContext {
  storedResume: ResumeData;
  newContent: string;
  newChunks: string[];
  newContentHash: string;
}

export interface ResumeResult {
  chunkIndex: number;
  method: 'exact' | 'charOffset' | 'snippet' | 'percentage' | 'beginning';
  contentChanged: boolean;
}

/**
 * Calculate the resume position for a library item.
 *
 * Resume algorithm (per CONTEXT.md):
 * 1. Hash match + version match: Use currentChunkIndex directly (fast path)
 * 2. Hash match + version mismatch: Use charOffset to find new chunk index
 * 3. Hash mismatch (content changed): Search for contentSnippet
 *    - If found: calculate new charOffset from snippet position
 *    - If not found: fall back to percentage
 * 4. Percentage fallback: Use charOffset/contentLength ratio
 * 5. Beginning: Ultimate fallback
 */
export function resumePosition(ctx: ResumeContext): ResumeResult {
  const { storedResume, newContent, newChunks, newContentHash } = ctx;

  // Fast path: exact match (hash + version match)
  if (
    storedResume.contentHash === newContentHash &&
    storedResume.chunkingVersion === CHUNKING_VERSION
  ) {
    return {
      chunkIndex: Math.min(storedResume.currentChunkIndex, newChunks.length - 1),
      method: 'exact',
      contentChanged: false,
    };
  }

  // Content or chunking changed
  const contentChanged = storedResume.contentHash !== newContentHash;

  // Try charOffset if version mismatch but hash matches
  if (!contentChanged && storedResume.charOffset !== undefined) {
    const chunkIndex = findChunkForOffset(newChunks, storedResume.charOffset, newContent);
    return {
      chunkIndex,
      method: 'charOffset',
      contentChanged: false,
    };
  }

  // Try snippet search (content changed)
  if (storedResume.contentSnippet) {
    const snippetIndex = newContent.indexOf(storedResume.contentSnippet);
    if (snippetIndex !== -1) {
      const chunkIndex = findChunkForOffset(newChunks, snippetIndex, newContent);
      return {
        chunkIndex,
        method: 'snippet',
        contentChanged,
      };
    }
  }

  // Percentage-based fallback (requires contentLength)
  if (storedResume.charOffset !== undefined && storedResume.contentLength) {
    const percentage = storedResume.charOffset / storedResume.contentLength;
    const newOffset = Math.floor(percentage * newContent.length);
    const chunkIndex = findChunkForOffset(newChunks, newOffset, newContent);
    return {
      chunkIndex,
      method: 'percentage',
      contentChanged,
    };
  }

  // Ultimate fallback: beginning
  return {
    chunkIndex: 0,
    method: 'beginning',
    contentChanged,
  };
}

/**
 * Find the chunk index that contains the given character offset.
 */
function findChunkForOffset(
  chunks: string[],
  targetOffset: number,
  fullContent: string
): number {
  if (chunks.length === 0) return 0;

  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunkStart = fullContent.indexOf(chunks[i], offset);
    if (chunkStart === -1) continue;

    const chunkEnd = chunkStart + chunks[i].length;
    if (targetOffset >= chunkStart && targetOffset < chunkEnd) {
      return i;
    }
    offset = chunkEnd;
  }

  // Target offset is beyond all chunks - return last chunk
  return Math.max(0, chunks.length - 1);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Save position immediately without creating an Autosaver instance.
 * Useful for one-off saves (e.g., pause/stop handlers).
 */
export async function savePositionNow(
  itemId: string,
  chunkIndex: number,
  chunkText: string,
  totalChunks: number,
  contentLength: number,
  contentHash: string
): Promise<void> {
  // Import dynamically to avoid circular deps
  const { updateLibraryItemPosition } = await import('./library-storage');

  const resumeData: ResumeData = {
    currentChunkIndex: chunkIndex,
    chunkingVersion: CHUNKING_VERSION,
    contentSnippet: chunkText.slice(0, 100),
    charOffset: totalChunks > 0 ? Math.floor((chunkIndex / totalChunks) * contentLength) : 0,
    contentLength,
    contentHash,
  };

  await updateLibraryItemPosition(itemId, { ...resumeData, lastReadAt: Date.now() });
}
