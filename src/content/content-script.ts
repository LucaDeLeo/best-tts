import { MessageType, type PlayAudioMessage, type SetSpeedMessage } from '../lib/messages';

console.log('Best TTS content script loaded');

// Current audio element
let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
let currentGenerationToken: string | null = null;
let currentSpeed: number = 1.0;

// Heartbeat interval
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
const HEARTBEAT_INTERVAL_MS = 2000; // 2 seconds per CONTEXT.md

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

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

async function handlePlayAudio(msg: PlayAudioMessage): Promise<{ success: boolean; error?: string }> {
  const { audioData, audioMimeType, generationToken } = msg;

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
  return { success: true };
}

async function handleSetSpeed(msg: SetSpeedMessage): Promise<{ success: boolean }> {
  currentSpeed = msg.speed;
  if (currentAudio) {
    currentAudio.playbackRate = currentSpeed;
  }
  return { success: true };
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
