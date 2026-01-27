import { ensureOffscreenDocument } from '../lib/offscreen-manager';
import {
  MessageType,
  type TTSMessage,
  type TTSResponse,
  type SetSpeedMessage,
  type HeartbeatMessage,
  type AudioEndedMessage,
  type AudioErrorMessage,
  type SkipToChunkMessage,
  type ExtractionResult,
} from '../lib/messages';
import {
  getPlaybackState,
  updatePlaybackState,
  resetPlaybackState,
  generateToken,
} from '../lib/playback-state';
import { getSelectedVoice } from '../lib/voice-storage';

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

  // Create context menus
  chrome.contextMenus.create({
    id: 'best-tts-read-selection',
    title: 'Read Selection with Best TTS',
    contexts: ['selection']  // Only show when text selected
  });

  chrome.contextMenus.create({
    id: 'best-tts-read-page',
    title: 'Read This Page with Best TTS',
    contexts: ['page']  // Show on right-click anywhere on page
  });
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
        const pauseState = getPlaybackState();
        if (pauseState.activeTabId && pauseState.status === 'playing') {
          chrome.tabs.sendMessage(pauseState.activeTabId, {
            target: 'content-script',
            type: MessageType.PAUSE_AUDIO
          }).catch(() => {});
          updatePlaybackState({ status: 'paused' });
          broadcastStatusUpdate();
        }
        sendResponse({ success: true });
        break;
      }

      case MessageType.RESUME_AUDIO: {
        const resumeState = getPlaybackState();
        if (resumeState.activeTabId && resumeState.status === 'paused') {
          chrome.tabs.sendMessage(resumeState.activeTabId, {
            target: 'content-script',
            type: MessageType.RESUME_AUDIO
          }).catch(() => {});
          updatePlaybackState({ status: 'playing' });
          broadcastStatusUpdate();
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
        const endedState = getPlaybackState();
        if (ended.generationToken === endedState.generationToken) {
          const nextIndex = endedState.currentChunkIndex + 1;
          if (nextIndex < endedState.totalChunks) {
            // Auto-advance to next chunk
            playChunk(nextIndex).catch(console.error);
          } else {
            // All chunks complete
            updatePlaybackState({ status: 'idle' });
            broadcastStatusUpdate();
          }
        }
        sendResponse({ success: true });
        break;
      }

      case MessageType.AUDIO_ERROR: {
        // Handle mid-playback errors from content script (e.g., audio decode failure, network error)
        const errMsg = message as AudioErrorMessage;
        const errorState = getPlaybackState();
        if (errMsg.generationToken === errorState.generationToken) {
          console.error('Audio playback error from content script:', errMsg.error);

          // Reset playback state
          updatePlaybackState({ status: 'idle' });
          broadcastStatusUpdate();

          // Forward error to popup for user feedback
          chrome.runtime.sendMessage({
            target: 'popup',
            type: MessageType.AUDIO_ERROR,
            error: errMsg.error
          }).catch(() => {});
        }
        sendResponse({ success: true });
        break;
      }

      case MessageType.SKIP_TO_CHUNK: {
        const skipMsg = message as SkipToChunkMessage;
        const skipState = getPlaybackState();
        const targetIndex = skipMsg.chunkIndex;

        // Validate target index
        if (targetIndex < 0 || targetIndex >= skipState.totalChunks) {
          sendResponse({ success: false, error: 'Invalid chunk index' });
          break;
        }

        // Stop current playback in content script
        if (skipState.activeTabId) {
          chrome.tabs.sendMessage(skipState.activeTabId, {
            target: 'content-script',
            type: MessageType.STOP_PLAYBACK
          }).catch(() => {});
        }

        // Generate and play the target chunk
        playChunk(targetIndex).catch(console.error);
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

    // Handle TTS_GENERATE response - store chunks and start playback
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

      // Start playing first chunk (don't await - let it run async)
      playChunk(0).catch(console.error);
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
 * Broadcast status update to popup
 */
function broadcastStatusUpdate(): void {
  const state = getPlaybackState();
  chrome.runtime.sendMessage({
    target: 'popup',
    type: MessageType.STATUS_UPDATE,
    status: {
      initialized: true,
      currentVoice: undefined,
      isPlaying: state.status === 'playing',
      isGenerating: state.status === 'generating',
      isPaused: state.status === 'paused',
      currentChunkIndex: state.currentChunkIndex,
      totalChunks: state.totalChunks,
      playbackSpeed: state.playbackSpeed
    }
  }).catch(() => {});
}

/**
 * Play a specific chunk by generating audio and sending to content script
 */
async function playChunk(chunkIndex: number): Promise<void> {
  const state = getPlaybackState();

  // Validate state
  if (chunkIndex >= state.totalChunks || !state.generationToken) {
    console.log('No more chunks or invalid state');
    updatePlaybackState({ status: 'idle' });
    broadcastStatusUpdate();
    return;
  }

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    console.error('No active tab for playback');
    updatePlaybackState({ status: 'idle' });
    broadcastStatusUpdate();
    return;
  }

  updatePlaybackState({
    status: 'generating',
    currentChunkIndex: chunkIndex,
    activeTabId: tab.id
  });
  broadcastStatusUpdate();

  // Generate chunk audio
  const chunkText = state.chunks[chunkIndex];
  const voice = await getSelectedVoice();

  const result = await generateChunk(
    chunkText,
    voice,
    chunkIndex,
    state.totalChunks,
    state.generationToken
  );

  // Check if generation was cancelled (token mismatch)
  // Note: This is "soft cancellation" - the TTSEngine has no abort API, so generation
  // runs to completion but results are discarded. This is acceptable for Phase 2
  // because: (1) typical chunk generation is fast (<1s), (2) discarding prevents
  // stale audio from playing, (3) true cancellation would require TTSEngine changes.
  const currentState = getPlaybackState();
  if (currentState.generationToken !== state.generationToken) {
    console.log('Generation cancelled (token mismatch) - discarding result');
    // No blob URL to revoke - audio data is base64 string (garbage collected)
    return;
  }

  if (!result.success || !result.audioData) {
    console.error('Chunk generation failed:', result.error);
    updatePlaybackState({ status: 'idle' });
    broadcastStatusUpdate();
    return;
  }

  // Send audio data to content script (NOT blob URL - those are origin-bound)
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      target: 'content-script',
      type: MessageType.PLAY_AUDIO,
      audioData: result.audioData,           // base64-encoded audio
      audioMimeType: result.audioMimeType,   // MIME type for blob creation
      generationToken: state.generationToken
    });

    if (response.success) {
      updatePlaybackState({
        status: 'playing'
        // Note: Audio URL is created in content script, not stored here
      });
    } else {
      // Autoplay blocked or other error
      console.error('Content script playback failed:', response.error);
      updatePlaybackState({ status: 'idle' });
      // Send error to popup
      chrome.runtime.sendMessage({
        target: 'popup',
        type: MessageType.AUDIO_ERROR,
        error: response.error
      }).catch(() => {});
    }
    broadcastStatusUpdate();
  } catch (error) {
    console.error('Failed to send to content script:', error);
    updatePlaybackState({ status: 'idle' });
    broadcastStatusUpdate();
  }
}

/**
 * Request chunk generation from offscreen document
 * Returns base64-encoded audio data (not blob URL) for cross-origin transfer
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

// Reference to prevent unused function warning
// generateChunk is called by playChunk above
void generateChunk;

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) {
    showNotification('Error', 'No active tab found');
    return;
  }

  const messageType = info.menuItemId === 'best-tts-read-selection'
    ? MessageType.EXTRACT_SELECTION
    : MessageType.EXTRACT_ARTICLE;

  try {
    // Send extraction request to content script
    // Content script will extract and return result via sendResponse
    const result = await chrome.tabs.sendMessage(tab.id, {
      target: 'content-script',
      type: messageType
    }) as ExtractionResult;

    if (!result.success) {
      showNotification('Extraction Failed', result.error || 'Could not extract content');
      return;
    }

    // Successfully extracted - store using shared function
    await storePendingExtraction(result);

    // Open popup to show the extracted text and let user play it
    // Note: Can't programmatically open popup, so show notification instead
    showNotification(
      'Ready to Read',
      `"${result.title || 'Selected text'}" extracted. Click extension icon to play.`
    );

  } catch (error) {
    console.error('Extraction failed:', error);
    showNotification(
      'Extraction Failed',
      'Could not extract content. Make sure the page is fully loaded.'
    );
  }
});

/**
 * Show notification to user
 */
function showNotification(title: string, message: string): void {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-48.png',
    title: `Best TTS: ${title}`,
    message
  });
}

/**
 * Handle popup port connections for extraction requests.
 * Per CONTEXT.md:
 * - Port keeps SW alive while popup is open
 * - If popup closes mid-extraction, store result in session storage
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'extraction') return;

  let pendingTabId: number | null = null;
  let extractionInProgress = false;

  port.onMessage.addListener(async (message) => {
    if (message.type === MessageType.EXTRACT_ARTICLE || message.type === MessageType.EXTRACT_SELECTION) {
      pendingTabId = message.tabId;
      extractionInProgress = true;

      try {
        // Forward extraction request to content script
        const result = await chrome.tabs.sendMessage(message.tabId, {
          target: 'content-script',
          type: message.type
        }) as ExtractionResult;

        extractionInProgress = false;

        // Try to send result back over port
        try {
          port.postMessage({
            type: 'EXTRACTION_RESPONSE',
            result
          });
        } catch {
          // Port disconnected (popup closed), store result
          await storePendingExtraction(result);
        }
      } catch (error) {
        extractionInProgress = false;
        const errorResult: ExtractionResult = {
          success: false,
          error: error instanceof Error ? error.message : 'Extraction failed',
          source: message.type === MessageType.EXTRACT_ARTICLE ? 'article' : 'selection'
        };

        try {
          port.postMessage({
            type: 'EXTRACTION_RESPONSE',
            result: errorResult
          });
        } catch {
          // Port disconnected, nothing to store for failed extraction
        }
      }
    }
  });

  // Handle popup close mid-extraction
  port.onDisconnect.addListener(async () => {
    if (extractionInProgress && pendingTabId !== null) {
      // Extraction is still in progress but popup closed
      // The extraction will complete and store result via the catch block above
      console.log('Popup closed during extraction, result will be stored when ready');
    }
  });
});

/**
 * Store extraction result in session storage for popup to retrieve later.
 * Used when popup closes mid-extraction or for context menu extractions.
 */
async function storePendingExtraction(result: ExtractionResult) {
  if (!result.success || !result.text) return;

  await chrome.storage.session.set({
    pendingExtraction: {
      text: result.text,
      title: result.title,
      url: result.url,
      source: result.source,
      timestamp: Date.now()
    }
  });
}

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
