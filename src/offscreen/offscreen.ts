import { MessageType, type TTSMessage, type TTSResponse, type VoiceListResponse } from '../lib/messages';

console.log('Best TTS offscreen document loaded');

// TTS engine will be initialized in Plan 03
let ttsInitialized = false;

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
 * Initialize TTS engine - placeholder for Plan 03
 */
async function handleInit(): Promise<TTSResponse> {
  // Will be implemented in Plan 03
  console.log('TTS init called (placeholder)');
  ttsInitialized = true;
  return { success: true };
}

/**
 * Generate speech - placeholder for Plan 03
 */
async function handleGenerate(text: string, voice: string): Promise<TTSResponse> {
  // Will be implemented in Plan 03
  console.log('TTS generate called (placeholder):', { text, voice });

  if (!ttsInitialized) {
    return { success: false, error: 'TTS engine not initialized' };
  }

  // Placeholder - return success for now
  return { success: true };
}

/**
 * Stop playback - placeholder for Plan 03
 */
async function handleStop(): Promise<TTSResponse> {
  // Will be implemented in Plan 03
  console.log('TTS stop called (placeholder)');
  return { success: true };
}

/**
 * List available voices - placeholder for Plan 03
 */
async function handleListVoices(): Promise<VoiceListResponse> {
  // Will be implemented in Plan 03
  // Return placeholder voices for testing message flow
  return {
    success: true,
    voices: ['af_heart', 'af_bella', 'am_michael']
  };
}

/**
 * Get current status
 */
async function handleGetStatus(): Promise<TTSResponse & { initialized: boolean }> {
  return {
    success: true,
    initialized: ttsInitialized
  };
}
