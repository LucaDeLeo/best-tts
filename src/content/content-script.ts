import {
  MessageType,
  type PlayAudioMessage,
  type SetSpeedMessage,
  type ExtractionResult,
  type InitHighlightingMessage
} from '../lib/messages';
import { getSelectedText, extractArticle } from '../lib/content-extractor';
import type { HighlightState } from '../lib/highlight-types';
import { highlightSentence, clearHighlight, maybeScrollToSentence } from '../lib/highlight-manager';
import { createSelectionHighlighting, cleanupSelectionHighlighting } from '../lib/selection-highlighter';
import { renderOverlayContent, removeOverlayContainer } from '../lib/overlay-highlighter';
import { injectHighlightStyles, removeHighlightStyles } from './highlight-styles';

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

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

async function handlePlayAudio(msg: PlayAudioMessage): Promise<{ success: boolean; error?: string }> {
  const { audioData, audioMimeType, generationToken, chunkIndex } = msg;

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
  return { success: true };
}

async function handleResume(): Promise<{ success: boolean; error?: string }> {
  if (currentAudio && currentAudio.paused) {
    try {
      await currentAudio.play();
      startHeartbeat();
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Resume failed';
      return { success: false, error: errorMsg };
    }
  }
  return { success: true };
}

async function handleStop(): Promise<{ success: boolean }> {
  await cleanupAudio();
  cleanupHighlighting();
  return { success: true };
}

async function handleSetSpeed(msg: SetSpeedMessage): Promise<{ success: boolean }> {
  currentSpeed = msg.speed;
  if (currentAudio) {
    currentAudio.playbackRate = currentSpeed;
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

// Cleanup highlighting on page unload
window.addEventListener('beforeunload', () => {
  cleanupHighlighting();
});
