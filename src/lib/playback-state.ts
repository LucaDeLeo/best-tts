/**
 * PlaybackState module - Centralized state management for audio playback
 *
 * The service worker is the state authority. State is in-memory only.
 * If service worker restarts, state resets to idle (acceptable per CONTEXT.md).
 */

export interface PlaybackState {
  // Playback status
  status: 'idle' | 'generating' | 'playing' | 'paused';

  // Generation tracking
  generationToken: string | null;  // UUID for current generation session

  // Chunk tracking
  chunks: string[];               // Array of sentence texts
  currentChunkIndex: number;      // Which chunk is playing (0-based)
  totalChunks: number;
  currentVoice: string | null;    // Voice selected when this playback started

  // Audio state
  // Note: Audio URL is created in content script (blob URLs are origin-bound)
  playbackSpeed: number;          // 0.5 to 4.0, default 1.0

  // Content script tracking
  activeTabId: number | null;     // Tab where content script is playing
  lastHeartbeat: number | null;   // Timestamp of last heartbeat

  // Library context (Phase 7)
  libraryItemId: string | null;      // If playing from library
  libraryContentHash: string | null; // For autosave
  libraryContentLength: number | null;
}

// Initial state
const initialState: PlaybackState = {
  status: 'idle',
  generationToken: null,
  chunks: [],
  currentChunkIndex: 0,
  totalChunks: 0,
  currentVoice: null,
  playbackSpeed: 1.0,
  activeTabId: null,
  lastHeartbeat: null,
  libraryItemId: null,
  libraryContentHash: null,
  libraryContentLength: null,
};

// In-memory state (service worker lifetime)
let state: PlaybackState = { ...initialState };

/**
 * Get a copy of the current playback state
 */
export function getPlaybackState(): PlaybackState {
  return { ...state };
}

/**
 * Update playback state with partial updates
 * Returns a copy of the new state
 */
export function updatePlaybackState(updates: Partial<PlaybackState>): PlaybackState {
  state = { ...state, ...updates };
  return { ...state };
}

/**
 * Reset playback state to initial values
 * Returns a copy of the reset state
 */
export function resetPlaybackState(): PlaybackState {
  const preservedSpeed = state.playbackSpeed;
  state = { ...initialState, playbackSpeed: preservedSpeed };
  return { ...state };
}

/**
 * Generate a unique token for a new generation session
 */
export function generateToken(): string {
  return crypto.randomUUID();
}
