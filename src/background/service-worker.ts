import { ensureOffscreenDocument } from '../lib/offscreen-manager';
import {
  MessageType,
  type TTSMessage,
  type TTSResponse,
  type SetSpeedMessage,
  type HeartbeatMessage,
  type AudioEndedMessage,
  type AudioErrorMessage,
} from '../lib/messages';
import {
  getPlaybackState,
  updatePlaybackState,
  resetPlaybackState,
  generateToken,
} from '../lib/playback-state';

console.log('Best TTS service worker loaded');

// Restore playback speed from storage on startup
chrome.storage.local.get(['playbackSpeed']).then(({ playbackSpeed }) => {
  if (typeof playbackSpeed === 'number') {
    updatePlaybackState({ playbackSpeed });
    console.log('Restored playback speed:', playbackSpeed);
  }
});

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Best TTS extension installed');
});

// Extended message type to include routing - use intersection since TTSMessage is a union
type RoutableMessage = TTSMessage & {
  forwardTo?: 'offscreen';
};

// Main message router
chrome.runtime.onMessage.addListener((message: RoutableMessage, sender, sendResponse) => {
  // Only handle messages intended for service worker
  if (message.target !== 'service-worker') {
    return false; // Not for us
  }

  // Check if this message should be forwarded to offscreen
  if (message.forwardTo === 'offscreen') {
    routeToOffscreen(message, sendResponse);
    return true; // Keep channel open for async response
  }

  // Handle messages directed at the service worker itself
  handleServiceWorkerMessage(message, sendResponse);
  return true; // Keep channel open for async response
});

/**
 * Handle messages directed at the service worker itself
 */
async function handleServiceWorkerMessage(
  message: TTSMessage,
  sendResponse: (response: TTSResponse) => void
): Promise<void> {
  try {
    switch (message.type) {
      case MessageType.GET_STATUS: {
        // Return full playback state
        const state = getPlaybackState();
        sendResponse({
          success: true,
          ...state
        } as TTSResponse & typeof state);
        break;
      }

      case MessageType.SET_SPEED: {
        const { speed } = message as SetSpeedMessage;
        const clampedSpeed = Math.max(0.5, Math.min(4.0, speed));
        updatePlaybackState({ playbackSpeed: clampedSpeed });

        // Persist to storage
        chrome.storage.local.set({ playbackSpeed: clampedSpeed });

        // Forward to active tab's content script if playing
        const currentState = getPlaybackState();
        if (currentState.activeTabId && currentState.status === 'playing') {
          chrome.tabs.sendMessage(currentState.activeTabId, {
            target: 'content-script',
            type: MessageType.SET_SPEED,
            speed: clampedSpeed
          }).catch(() => {
            // Content script might not be ready
          });
        }
        sendResponse({ success: true, speed: clampedSpeed } as TTSResponse & { speed: number });
        break;
      }

      case MessageType.STOP_PLAYBACK: {
        const prevState = getPlaybackState();
        if (prevState.activeTabId) {
          chrome.tabs.sendMessage(prevState.activeTabId, {
            target: 'content-script',
            type: MessageType.STOP_PLAYBACK
          }).catch(() => {
            // Content script might not be available
          });
        }
        resetPlaybackState();
        sendResponse({ success: true });
        break;
      }

      case MessageType.PAUSE_AUDIO: {
        const state = getPlaybackState();
        if (state.activeTabId && state.status === 'playing') {
          updatePlaybackState({ status: 'paused' });
          chrome.tabs.sendMessage(state.activeTabId, {
            target: 'content-script',
            type: MessageType.PAUSE_AUDIO
          }).catch(() => {});
        }
        sendResponse({ success: true });
        break;
      }

      case MessageType.RESUME_AUDIO: {
        const state = getPlaybackState();
        if (state.activeTabId && state.status === 'paused') {
          updatePlaybackState({ status: 'playing' });
          chrome.tabs.sendMessage(state.activeTabId, {
            target: 'content-script',
            type: MessageType.RESUME_AUDIO
          }).catch(() => {});
        }
        sendResponse({ success: true });
        break;
      }

      case MessageType.HEARTBEAT: {
        const hb = message as HeartbeatMessage;
        if (hb.generationToken === getPlaybackState().generationToken) {
          updatePlaybackState({ lastHeartbeat: Date.now() });
        }
        sendResponse({ success: true });
        break;
      }

      case MessageType.AUDIO_ENDED: {
        const ended = message as AudioEndedMessage;
        if (ended.generationToken === getPlaybackState().generationToken) {
          // Will be expanded in Plan 03 for auto-advance
          updatePlaybackState({ status: 'idle' });
        }
        sendResponse({ success: true });
        break;
      }

      case MessageType.AUDIO_ERROR: {
        const errMsg = message as AudioErrorMessage;
        console.error('Audio playback error:', errMsg.error);
        if (errMsg.generationToken === getPlaybackState().generationToken) {
          updatePlaybackState({ status: 'idle' });
        }
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
    }
  } catch (error) {
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Route messages to the offscreen document
 * Creates the document if it doesn't exist
 *
 * NOTE: We rewrite the message target to 'offscreen' before sending.
 * The original message arrives with target: 'service-worker' and forwardTo: 'offscreen'.
 * The offscreen document expects target: 'offscreen' to handle the message.
 */
async function routeToOffscreen(
  message: RoutableMessage,
  sendResponse: (response: TTSResponse) => void
): Promise<void> {
  try {
    // Ensure offscreen document exists before sending message
    await ensureOffscreenDocument();

    // Rewrite target for offscreen document and remove forwardTo
    const { forwardTo, ...rest } = message;
    const offscreenMessage = { ...rest, target: 'offscreen' as const };

    // Forward message to offscreen document
    const response = await chrome.runtime.sendMessage(offscreenMessage);

    // Handle TTS_GENERATE response - store chunks in playback state
    // Full orchestration (generation + playback) will be implemented in Plan 03
    if (message.type === MessageType.TTS_GENERATE && response.success && response.chunks) {
      const token = generateToken();
      updatePlaybackState({
        status: 'generating',
        generationToken: token,
        chunks: response.chunks,
        totalChunks: response.chunks.length,
        currentChunkIndex: 0
      });
      console.log(`Stored ${response.chunks.length} chunks with token ${token}`);
      // Include generation token in response for client use
      response.generationToken = token;
    }

    sendResponse(response);
  } catch (error) {
    console.error('Error routing to offscreen:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to communicate with TTS engine'
    });
  }
}

/**
 * Request chunk generation from offscreen document
 * Returns base64-encoded audio data (not blob URL) for cross-origin transfer
 *
 * Note: This function is prepared for Plan 03 when full orchestration is implemented.
 * The content script will receive the audio data and create its own blob URL.
 */
async function generateChunk(
  chunkText: string,
  voice: string,
  chunkIndex: number,
  totalChunks: number,
  generationToken: string
): Promise<{ success: boolean; audioData?: string; audioMimeType?: string; error?: string }> {
  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: MessageType.TTS_GENERATE_CHUNK,
    text: chunkText,
    voice,
    chunkIndex,
    totalChunks,
    generationToken
  });

  return response;
}

// Export for potential future use (Plan 03)
// TypeScript compile-time only - service workers don't have module exports
void generateChunk;

// Listen for download progress from offscreen and broadcast to popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MessageType.DOWNLOAD_PROGRESS) {
    // Store progress in storage for popup to read
    chrome.storage.local.set({
      downloadProgress: message.progress
    });
    // Also broadcast to any open popups
    chrome.runtime.sendMessage({
      target: 'popup',
      type: MessageType.DOWNLOAD_PROGRESS,
      progress: message.progress
    }).catch(() => {
      // Popup might not be open, that's fine
    });
  }
  return false;
});
