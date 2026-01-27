import {
  MessageType,
  type PlayAudioMessage,
  type SetSpeedMessage,
  type ExtractionResult,
  type InitHighlightingMessage,
  type StatusUpdateMessage,
  type ShowFloatingPlayerMessage
} from '../lib/messages';
import { getSelectedText, extractArticle } from '../lib/content-extractor';
import type { HighlightState } from '../lib/highlight-types';
import { highlightSentence, clearHighlight, maybeScrollToSentence } from '../lib/highlight-manager';
import { createSelectionHighlighting, cleanupSelectionHighlighting } from '../lib/selection-highlighter';
import { renderOverlayContent, removeOverlayContainer } from '../lib/overlay-highlighter';
import { injectHighlightStyles, removeHighlightStyles } from './highlight-styles';
import { createFloatingPlayer, destroyFloatingPlayer, type PlayerUIState } from './floating-player';

console.log('Best TTS content script loaded');

// Current audio element
let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
let currentGenerationToken: string | null = null;
let currentSpeed: number = 1.0;

// Heartbeat interval
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
const HEARTBEAT_INTERVAL_MS = 2000; // 2 seconds per CONTEXT.md

// Highlight state
let highlightState: HighlightState | null = null;

// Floating player instance
let floatingPlayer: ReturnType<typeof createFloatingPlayer> | null = null;

// Track if player was dismissed by user (stays hidden until restored or playback stops)
let playerDismissed = false;

// Chunk tracking for floating player progress display
let currentChunkIndex: number = 0;
let currentTotalChunks: number = 0;

// Library autosave context (Phase 7)
let libraryItemId: string | null = null;
let libraryContentHash: string | null = null;
let libraryContentLength: number | null = null;
let autosaveInterval: ReturnType<typeof setInterval> | null = null;
const AUTOSAVE_INTERVAL_MS = 10_000; // 10 seconds per CONTEXT.md

// Track chunks for autosave (needed for chunkText)
let currentChunks: string[] = [];

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages for content script
  if (message.target !== 'content-script') {
    return false;
  }

  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      console.error('Content script message handler error:', error);
      sendResponse({ success: false, error: error.message });
    });

  return true; // Keep channel open for async response
});

async function handleMessage(message: any): Promise<any> {
  switch (message.type) {
    case MessageType.PLAY_AUDIO:
      return handlePlayAudio(message as PlayAudioMessage);

    case MessageType.PAUSE_AUDIO:
      return handlePause();

    case MessageType.RESUME_AUDIO:
      return handleResume();

    case MessageType.STOP_PLAYBACK:
      return handleStop();

    case MessageType.SET_SPEED:
      return handleSetSpeed(message as SetSpeedMessage);

    case MessageType.EXTRACT_SELECTION:
      return handleExtractSelection();

    case MessageType.EXTRACT_ARTICLE:
      return handleExtractArticle();

    case MessageType.INIT_HIGHLIGHTING:
      return handleInitHighlighting(message as InitHighlightingMessage);

    case MessageType.STATUS_UPDATE:
      return handleStatusUpdate(message as StatusUpdateMessage);

    case MessageType.SHOW_FLOATING_PLAYER:
      return handleShowFloatingPlayer();

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

async function handlePlayAudio(msg: PlayAudioMessage): Promise<{ success: boolean; error?: string }> {
  const { audioData, audioMimeType, generationToken, chunkIndex, totalChunks } = msg;

  // Track chunk info for floating player
  currentChunkIndex = chunkIndex;
  currentTotalChunks = totalChunks;

  // Initialize floating player if not exists
  if (!floatingPlayer) {
    floatingPlayer = createFloatingPlayer({
      onDismiss: () => {
        playerDismissed = true;
      }
    });
    playerDismissed = false; // Reset on new player creation
  }

  // Update player state to show playing (only if not dismissed)
  if (!playerDismissed) {
    floatingPlayer.update({
      status: 'playing',
      currentChunk: chunkIndex,
      totalChunks: totalChunks,
      playbackSpeed: currentSpeed
    });
  }

  // Stop any existing playback
  await cleanupAudio();

  // Convert base64 back to blob and create URL in content script context
  // This is necessary because blob URLs are origin-bound - the offscreen
  // document's blob URLs cannot be loaded from a web page context
  const binaryString = atob(audioData);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: audioMimeType });
  const audioUrl = URL.createObjectURL(blob);

  // Store new state
  currentAudioUrl = audioUrl;
  currentGenerationToken = generationToken;

  // Highlight the current sentence
  if (highlightState && highlightState.isValid) {
    highlightSentence(highlightState, chunkIndex);
    maybeScrollToSentence(highlightState);
  }

  // Create and configure audio element
  currentAudio = new Audio(audioUrl);
  currentAudio.playbackRate = currentSpeed;

  // Set up event handlers
  currentAudio.onended = () => {
    console.log('Audio playback ended naturally');
    notifyEnded();
    cleanupAudio();
  };

  currentAudio.onerror = (e) => {
    console.error('Audio playback error:', e);
    notifyError('Audio playback failed');
    cleanupAudio();
  };

  // Attempt to play
  try {
    await currentAudio.play();
    startHeartbeat();
    return { success: true };
  } catch (error) {
    // Likely NotAllowedError (autoplay blocked)
    const errorMsg = error instanceof Error ? error.message : 'Playback failed';
    console.error('Play failed (likely autoplay blocked):', errorMsg);

    // Notify service worker of error
    notifyError(errorMsg);
    cleanupAudio();

    return {
      success: false,
      error: errorMsg.includes('NotAllowed') || errorMsg.includes('play()')
        ? 'Click anywhere on the page to enable audio, then try again.'
        : errorMsg
    };
  }
}

async function handlePause(): Promise<{ success: boolean }> {
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    stopHeartbeat();
  }

  // Update floating player to paused state
  if (floatingPlayer) {
    floatingPlayer.update({
      status: 'paused',
      currentChunk: currentChunkIndex,
      totalChunks: currentTotalChunks,
      playbackSpeed: currentSpeed
    });
  }

  // Save position immediately on pause (library autosave)
  sendAutosavePosition();

  return { success: true };
}

async function handleResume(): Promise<{ success: boolean; error?: string }> {
  if (currentAudio && currentAudio.paused) {
    try {
      await currentAudio.play();
      startHeartbeat();

      // Update floating player to playing state
      if (floatingPlayer) {
        floatingPlayer.update({
          status: 'playing',
          currentChunk: currentChunkIndex,
          totalChunks: currentTotalChunks,
          playbackSpeed: currentSpeed
        });
      }

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Resume failed';
      return { success: false, error: errorMsg };
    }
  }
  return { success: true };
}

async function handleStop(): Promise<{ success: boolean }> {
  // Save position immediately on stop (library autosave)
  sendAutosavePosition();

  await cleanupAudio();
  cleanupHighlighting();

  // Hide floating player (set to idle status)
  if (floatingPlayer) {
    floatingPlayer.update({
      status: 'idle',
      currentChunk: 0,
      totalChunks: 0,
      playbackSpeed: currentSpeed
    });
  }

  // Reset chunk tracking
  currentChunkIndex = 0;
  currentTotalChunks = 0;

  // Reset dismissed state so player shows on next playback
  playerDismissed = false;

  // Clear library context
  clearLibraryContext();

  return { success: true };
}

async function handleSetSpeed(msg: SetSpeedMessage): Promise<{ success: boolean }> {
  currentSpeed = msg.speed;
  if (currentAudio) {
    currentAudio.playbackRate = currentSpeed;
  }

  // Update floating player with new speed
  if (floatingPlayer) {
    floatingPlayer.update({
      status: currentAudio && !currentAudio.paused ? 'playing' : 'paused',
      currentChunk: currentChunkIndex,
      totalChunks: currentTotalChunks,
      playbackSpeed: msg.speed
    });
  }

  return { success: true };
}

/**
 * Handle selection extraction request
 * Returns selected text with page metadata
 */
async function handleExtractSelection(): Promise<ExtractionResult> {
  const text = getSelectedText();

  if (!text) {
    return {
      success: false,
      error: 'No text selected. Select some text and try again.',
      source: 'selection'
    };
  }

  return {
    success: true,
    text,
    title: document.title,
    url: window.location.href,
    source: 'selection'
  };
}

/**
 * Handle full-page article extraction
 * Uses Readability with SPA stabilization (see CONTEXT.md)
 * Has internal 10s timeout to prevent hanging per MV3 30s limit
 */
async function handleExtractArticle(): Promise<ExtractionResult> {
  const EXTRACTION_TIMEOUT = 10000; // 10 seconds

  try {
    // Race extraction against timeout
    const result = await Promise.race([
      extractArticle(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Extraction timed out')), EXTRACTION_TIMEOUT)
      )
    ]);

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Could not extract article content',
        url: result.url,
        source: 'article'
      };
    }

    return {
      success: true,
      text: result.content,
      title: result.title,
      url: result.url,
      source: 'article'
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Extraction failed',
      url: window.location.href,
      source: 'article'
    };
  }
}

function startHeartbeat(): void {
  stopHeartbeat(); // Clear any existing

  heartbeatInterval = setInterval(() => {
    if (currentAudio && !currentAudio.paused && currentGenerationToken) {
      chrome.runtime.sendMessage({
        target: 'service-worker',
        type: MessageType.HEARTBEAT,
        generationToken: currentGenerationToken,
        currentTime: currentAudio.currentTime,
        duration: isNaN(currentAudio.duration) ? 0 : currentAudio.duration
      }).catch(() => {
        // Service worker might not be listening
      });
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function notifyEnded(): void {
  if (currentGenerationToken) {
    chrome.runtime.sendMessage({
      target: 'service-worker',
      type: MessageType.AUDIO_ENDED,
      generationToken: currentGenerationToken
    }).catch(() => {});
  }
}

function notifyError(error: string): void {
  if (currentGenerationToken) {
    chrome.runtime.sendMessage({
      target: 'service-worker',
      type: MessageType.AUDIO_ERROR,
      error,
      generationToken: currentGenerationToken
    }).catch(() => {});
  }
}

async function cleanupAudio(): Promise<void> {
  stopHeartbeat();

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio = null;
  }

  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }

  currentGenerationToken = null;
}

/**
 * Clean up highlighting state and restore DOM.
 */
function cleanupHighlighting(): void {
  if (!highlightState) return;

  if (highlightState.mode === 'selection') {
    cleanupSelectionHighlighting(highlightState);
  } else {
    removeOverlayContainer();
  }

  removeHighlightStyles();
  highlightState = null;
}

// ============================================================================
// Library Autosave Functions (Phase 7)
// ============================================================================

/**
 * Start library playback with autosave context.
 * Called when playing content from the library.
 */
function startLibraryPlayback(
  itemId: string,
  contentHash: string,
  contentLength: number,
  chunks: string[]
): void {
  libraryItemId = itemId;
  libraryContentHash = contentHash;
  libraryContentLength = contentLength;
  currentChunks = chunks;

  // Clear any existing autosave interval
  if (autosaveInterval) clearInterval(autosaveInterval);

  // Save position every 10 seconds during active playback
  autosaveInterval = setInterval(() => {
    if (libraryItemId && currentAudio && !currentAudio.paused) {
      sendAutosavePosition();
    }
  }, AUTOSAVE_INTERVAL_MS);
}

/**
 * Send autosave position to service worker.
 * Called on interval (10s), pause, and stop.
 */
function sendAutosavePosition(): void {
  if (!libraryItemId || currentChunkIndex === undefined) return;

  const chunkText = currentChunks[currentChunkIndex]?.slice(0, 100) || '';

  chrome.runtime.sendMessage({
    target: 'service-worker',
    type: MessageType.AUTOSAVE_POSITION,
    itemId: libraryItemId,
    chunkIndex: currentChunkIndex,
    chunkText,
    totalChunks: currentTotalChunks,
    contentLength: libraryContentLength || 0,
    contentHash: libraryContentHash || ''
  }).catch((error) => {
    console.error('Autosave failed:', error);
  });
}

/**
 * Clear library context when playback ends.
 */
function clearLibraryContext(): void {
  if (autosaveInterval) {
    clearInterval(autosaveInterval);
    autosaveInterval = null;
  }
  libraryItemId = null;
  libraryContentHash = null;
  libraryContentLength = null;
  currentChunks = [];
}

/**
 * Set library context for autosave (called from external message).
 * This allows the popup/service worker to configure library playback.
 */
export function setLibraryContext(
  itemId: string,
  contentHash: string,
  contentLength: number,
  chunks: string[]
): void {
  startLibraryPlayback(itemId, contentHash, contentLength, chunks);
}

/**
 * Handle initialization of highlighting mode.
 * Called before TTS playback starts to set up DOM spans.
 */
async function handleInitHighlighting(msg: InitHighlightingMessage): Promise<{
  success: boolean;
  chunks?: string[];
  error?: string;
}> {
  // Cleanup any existing highlighting
  cleanupHighlighting();

  // Inject highlight styles
  injectHighlightStyles();

  if (msg.mode === 'overlay') {
    const result = renderOverlayContent(msg.title, msg.text);
    highlightState = result.state;
    return { success: true, chunks: result.chunks };
  } else {
    // Selection mode - get current selection
    const selection = window.getSelection();
    if (!selection) {
      return { success: false, error: 'No selection available' };
    }

    const result = createSelectionHighlighting(selection);
    if (!result) {
      return { success: false, error: 'Could not highlight selection' };
    }

    highlightState = result.state;
    return { success: true, chunks: result.chunks };
  }
}

/**
 * Handle STATUS_UPDATE messages from service worker.
 * Updates the floating player to reflect authoritative playback state.
 * Per CONTEXT.md decision [13]: SW owns state, content script holds derived/cached copy.
 */
async function handleStatusUpdate(message: StatusUpdateMessage): Promise<{ success: boolean }> {
  const status = message.status;

  // Map service worker status to PlayerUIState
  let playerStatus: 'idle' | 'generating' | 'playing' | 'paused';
  if (status.isPlaying) {
    playerStatus = 'playing';
  } else if ((status as { isPaused?: boolean }).isPaused) {
    playerStatus = 'paused';
  } else if ((status as { isGenerating?: boolean }).isGenerating) {
    playerStatus = 'generating';
  } else {
    playerStatus = 'idle';
  }

  // Always track the latest state (even when dismissed)
  // This ensures state is fresh when player is restored
  const statusExt = status as {
    currentChunkIndex?: number;
    totalChunks?: number;
    playbackSpeed?: number;
  };
  currentChunkIndex = statusExt.currentChunkIndex ?? currentChunkIndex;
  currentTotalChunks = statusExt.totalChunks ?? currentTotalChunks;
  currentSpeed = statusExt.playbackSpeed ?? currentSpeed;

  // Reset dismissed state when going idle (so player shows on next playback)
  if (playerStatus === 'idle') {
    playerDismissed = false;
  }

  // Update floating player UI if exists
  if (floatingPlayer) {
    // Only update UI if not dismissed, or if going idle (to hide)
    // Note: Internal state (currentChunkIndex, etc.) is always updated above
    if (!playerDismissed || playerStatus === 'idle') {
      floatingPlayer.update({
        status: playerStatus,
        currentChunk: currentChunkIndex,
        totalChunks: currentTotalChunks,
        playbackSpeed: currentSpeed
      });
    }
  }

  return { success: true };
}

/**
 * Handle SHOW_FLOATING_PLAYER message from popup.
 * Restores a dismissed floating player with fresh state from service worker.
 */
async function handleShowFloatingPlayer(): Promise<{ success: boolean }> {
  // Reset dismissed state so player can show
  playerDismissed = false;

  if (floatingPlayer) {
    // Fetch latest state from service worker before showing
    // This ensures the UI reflects the current playback state
    try {
      const response = await chrome.runtime.sendMessage({
        target: 'service-worker',
        type: MessageType.GET_STATUS
      });

      if (response && response.success) {
        // Map response to player status
        let playerStatus: 'idle' | 'generating' | 'playing' | 'paused' = 'idle';
        if (response.isPlaying) playerStatus = 'playing';
        else if (response.isPaused) playerStatus = 'paused';
        else if (response.isGenerating) playerStatus = 'generating';

        // Update tracked state
        currentChunkIndex = response.currentChunkIndex ?? currentChunkIndex;
        currentTotalChunks = response.totalChunks ?? currentTotalChunks;
        currentSpeed = response.playbackSpeed ?? currentSpeed;

        // Update player UI
        floatingPlayer.update({
          status: playerStatus,
          currentChunk: currentChunkIndex,
          totalChunks: currentTotalChunks,
          playbackSpeed: currentSpeed
        });
      }
    } catch {
      // Service worker might not be ready - show with cached state
    }

    // Explicitly show the player (in case update didn't show due to idle status)
    floatingPlayer.show();
  }

  return { success: true };
}

// Cleanup highlighting on page unload
window.addEventListener('beforeunload', () => {
  // Save position before unload (best-effort)
  sendAutosavePosition();

  cleanupHighlighting();
  clearLibraryContext();

  // Destroy floating player on page unload
  if (floatingPlayer) {
    floatingPlayer.destroy();
    floatingPlayer = null;
  }
});

// Handle overlay close event - stop playback when user closes overlay
window.addEventListener('besttts-overlay-closed', () => {
  // Stop playback when overlay is manually closed
  chrome.runtime.sendMessage({
    target: 'service-worker',
    type: MessageType.STOP_PLAYBACK
  }).catch(() => {
    // Service worker might not be listening
  });
});

// Request current state from service worker to rehydrate floating player on load
// This handles: (1) page refresh, (2) hard navigation, (3) reopening tab with active playback
// Per CONTEXT.md decision [15]: SW stores state, content script rehydrates on load
(async function rehydrateFloatingPlayer() {
  try {
    // Get this tab's ID to verify we're the active playback tab
    const tabIdResponse = await new Promise<{ tabId?: number }>((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, (response) => {
        resolve(response || {});
      });
    });
    const thisTabId = tabIdResponse.tabId;

    // Get current playback state from service worker
    const response = await chrome.runtime.sendMessage({
      target: 'service-worker',
      type: MessageType.GET_STATUS
    });

    if (!response || !response.success) return;

    // Only rehydrate if this is the tab where playback is active
    // This prevents other tabs from incorrectly showing the player
    const isActiveInThisTab = (response.isPlaying || response.isPaused) &&
                              response.activeTabId === thisTabId;

    if (isActiveInThisTab && response.totalChunks > 0) {
      // Rehydrate: create floating player and show current state
      if (!floatingPlayer) {
        floatingPlayer = createFloatingPlayer({
          onDismiss: () => {
            playerDismissed = true;
          }
        });
        playerDismissed = false;
      }

      // Update tracked state from service worker (authoritative source)
      currentChunkIndex = response.currentChunkIndex ?? 0;
      currentTotalChunks = response.totalChunks ?? 0;
      currentSpeed = response.playbackSpeed ?? 1.0;

      // Map status - note: after hard navigation, state will be 'paused'
      // because the audio element was destroyed by navigation
      let playerStatus: 'idle' | 'generating' | 'playing' | 'paused' = 'idle';
      if (response.isPlaying) playerStatus = 'playing';
      else if (response.isPaused) playerStatus = 'paused';
      else if (response.isGenerating) playerStatus = 'generating';

      floatingPlayer.update({
        status: playerStatus,
        currentChunk: currentChunkIndex,
        totalChunks: currentTotalChunks,
        playbackSpeed: currentSpeed
      });

      console.log('Rehydrated floating player:', playerStatus, currentChunkIndex + 1, '/', currentTotalChunks);
    }
  } catch {
    // Service worker might not be ready - this is fine on initial load
  }
})();
