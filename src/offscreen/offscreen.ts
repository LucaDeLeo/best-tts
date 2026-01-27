import { MessageType, type TTSMessage, type TTSResponse, type VoiceListResponse } from '../lib/messages';
import { TTSEngine, type VoiceId } from '../lib/tts-engine';
import { setDownloadProgress, clearDownloadProgress, setCacheStatus } from '../lib/model-cache';
import { getSelectedVoice } from '../lib/voice-storage';

console.log('Best TTS offscreen document loaded');

// Current audio element for playback control
let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;

// Message handler
chrome.runtime.onMessage.addListener((message: TTSMessage, sender, sendResponse) => {
  // Only handle messages intended for offscreen document
  if (message.target !== 'offscreen') {
    return false;
  }

  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      console.error('Offscreen message handler error:', error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      } as TTSResponse);
    });

  return true; // Keep channel open for async response
});

/**
 * Main message dispatcher
 */
async function handleMessage(message: TTSMessage): Promise<TTSResponse | VoiceListResponse> {
  switch (message.type) {
    case MessageType.TTS_INIT:
      return handleInit();

    case MessageType.TTS_GENERATE:
      return handleGenerate(message.text, message.voice);

    case MessageType.TTS_STOP:
      return handleStop();

    case MessageType.TTS_LIST_VOICES:
      return handleListVoices();

    case MessageType.GET_STATUS:
      return handleGetStatus();

    default:
      return { success: false, error: `Unknown message type: ${(message as TTSMessage).type}` };
  }
}

/**
 * Initialize TTS engine with progress tracking
 */
async function handleInit(): Promise<TTSResponse> {
  try {
    console.log('Initializing TTS engine...');

    await TTSEngine.getInstance((progress) => {
      // Handle different progress statuses
      if (progress.status === 'progress' && progress.file) {
        const percent = progress.progress
          ? Math.round(progress.progress * 100)
          : progress.loaded && progress.total
            ? Math.round((progress.loaded / progress.total) * 100)
            : 0;

        // Persist progress to storage
        setDownloadProgress({
          file: progress.file,
          loaded: progress.loaded || 0,
          total: progress.total || 0,
          percent
        });

        // Broadcast progress to service worker (which will forward to popup)
        chrome.runtime.sendMessage({
          target: 'service-worker',
          type: MessageType.DOWNLOAD_PROGRESS,
          progress: {
            file: progress.file,
            loaded: progress.loaded || 0,
            total: progress.total || 0,
            percent
          }
        }).catch(() => {
          // Service worker might not be listening, that's fine
        });
      }

      if (progress.status === 'done') {
        // Clear progress when complete
        clearDownloadProgress();

        // Update cache status
        setCacheStatus({
          initialized: true,
          lastUpdated: Date.now(),
          modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX'
        });
      }
    });

    console.log('TTS engine initialized successfully');
    return { success: true };
  } catch (error) {
    console.error('TTS initialization failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to initialize TTS engine'
    };
  }
}

/**
 * Generate speech and play it
 */
async function handleGenerate(text: string, voice: string): Promise<TTSResponse> {
  try {
    // Validate input
    if (!text || text.trim().length === 0) {
      return { success: false, error: 'Text cannot be empty' };
    }

    // Use provided voice or get from storage
    const selectedVoice = (voice || await getSelectedVoice()) as VoiceId;

    console.log(`Generating speech for: "${text.substring(0, 50)}..." with voice: ${selectedVoice}`);

    // Generate audio
    const blob = await TTSEngine.generate(text, selectedVoice);

    // Stop any current playback
    await stopCurrentPlayback();

    // Create audio element and play
    currentAudioUrl = URL.createObjectURL(blob);
    currentAudio = new Audio(currentAudioUrl);

    // Set up event handlers
    currentAudio.onended = () => {
      console.log('Playback completed');
      cleanupAudio();

      // Notify that playback is complete
      chrome.runtime.sendMessage({
        target: 'popup',
        type: MessageType.GENERATION_COMPLETE
      }).catch(() => {
        // Popup might not be open
      });
    };

    currentAudio.onerror = (e) => {
      console.error('Audio playback error:', e);
      cleanupAudio();
    };

    // Play the audio
    await currentAudio.play();

    console.log('Playback started');
    return { success: true };
  } catch (error) {
    console.error('TTS generation failed:', error);
    cleanupAudio();
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate speech'
    };
  }
}

/**
 * Stop current playback
 */
async function handleStop(): Promise<TTSResponse> {
  await stopCurrentPlayback();
  return { success: true };
}

/**
 * Stop playback and cleanup resources
 */
async function stopCurrentPlayback(): Promise<void> {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  cleanupAudio();
}

/**
 * Cleanup audio resources
 */
function cleanupAudio(): void {
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
  currentAudio = null;
}

/**
 * List available voices
 */
async function handleListVoices(): Promise<VoiceListResponse> {
  try {
    // Make sure engine is initialized
    if (!TTSEngine.isInitialized()) {
      // Initialize without progress callback for this call
      await TTSEngine.getInstance();
    }

    const voices = await TTSEngine.getVoices();
    return { success: true, voices };
  } catch (error) {
    console.error('Failed to list voices:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list voices',
      voices: []
    };
  }
}

/**
 * Get current status
 */
async function handleGetStatus(): Promise<TTSResponse & { initialized: boolean; isPlaying: boolean }> {
  return {
    success: true,
    initialized: TTSEngine.isInitialized(),
    isPlaying: currentAudio !== null && !currentAudio.paused
  };
}
