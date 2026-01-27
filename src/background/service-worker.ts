import { ensureOffscreenDocument } from '../lib/offscreen-manager';
import { MessageType, type TTSMessage, type TTSResponse, type MessageTarget } from '../lib/messages';

console.log('Best TTS service worker loaded');

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
      case MessageType.GET_STATUS:
        // Return basic status - TTS status comes from offscreen
        sendResponse({ success: true });
        break;

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
    sendResponse(response);
  } catch (error) {
    console.error('Error routing to offscreen:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to communicate with TTS engine'
    });
  }
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
