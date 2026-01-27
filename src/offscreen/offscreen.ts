import {
  MessageType,
  type TTSMessage,
  type TTSResponse,
  type VoiceListResponse,
  type TTSGenerateChunkMessage,
  type OffscreenExtractMessage,
  type DocumentExtractionResult,
} from '../lib/messages';
import { TTSEngine, type VoiceId } from '../lib/tts-engine';
import { setDownloadProgress, clearDownloadProgress, setCacheStatus } from '../lib/model-cache';
import { getSelectedVoice } from '../lib/voice-storage';
import { splitIntoChunks } from '../lib/text-chunker';
import { extractTextFile } from '../lib/text-file-extractor';

console.log('Best TTS offscreen document loaded');

// Response type for chunk generation
interface ChunkReadyResponse extends TTSResponse {
  audioData?: string;       // base64-encoded audio data (NOT blob URL)
  audioMimeType?: string;   // MIME type for recreating blob
  chunkIndex?: number;
  generationToken?: string;
}

// Response type for TTS_GENERATE (now returns chunks instead of playing)
interface GenerateResponse extends TTSResponse {
  chunks?: string[];
}

// Union type for all messages handled by offscreen document
type OffscreenHandledMessage = TTSMessage | OffscreenExtractMessage;

// Message handler
chrome.runtime.onMessage.addListener((message: OffscreenHandledMessage, sender, sendResponse) => {
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
async function handleMessage(message: OffscreenHandledMessage): Promise<TTSResponse | VoiceListResponse | ChunkReadyResponse | GenerateResponse | DocumentExtractionResult> {
  switch (message.type) {
    case MessageType.TTS_INIT:
      return handleInit();

    case MessageType.TTS_GENERATE:
      return handleGenerate(message.text, message.voice, (message as TTSMessage & { locale?: string }).locale);

    case MessageType.TTS_GENERATE_CHUNK:
      return handleGenerateChunk(message as TTSGenerateChunkMessage);

    case MessageType.TTS_STOP:
      return handleStop();

    case MessageType.TTS_LIST_VOICES:
      return handleListVoices();

    case MessageType.GET_STATUS:
      return handleGetStatus();

    case MessageType.EXTRACT_DOCUMENT:
      return handleExtractDocument(message as unknown as OffscreenExtractMessage);

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
 * Split text into chunks and return them (no longer plays audio)
 * Audio playback is handled by content scripts per CONTEXT.md
 */
async function handleGenerate(text: string, voice: string, locale?: string): Promise<GenerateResponse> {
  try {
    // Validate input
    if (!text || text.trim().length === 0) {
      return { success: false, error: 'Text cannot be empty' };
    }

    // Split into chunks
    const chunks = splitIntoChunks(text, locale);
    if (chunks.length === 0) {
      return { success: false, error: 'No valid sentences found in text' };
    }

    console.log(`Split text into ${chunks.length} chunks for voice: ${voice || 'default'}`);

    // Return chunks for service worker to orchestrate generation
    return { success: true, chunks };
  } catch (error) {
    console.error('Text splitting failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process text'
    };
  }
}

/**
 * Generate audio for a single chunk and return as base64
 * Returns base64-encoded audio data (not blob URL) because blob URLs are origin-bound.
 * Content scripts cannot load blob URLs created in the offscreen document.
 */
async function handleGenerateChunk(msg: TTSGenerateChunkMessage): Promise<ChunkReadyResponse> {
  const { text, voice, chunkIndex, totalChunks, generationToken } = msg;

  try {
    // Validate
    if (!text || text.trim().length === 0) {
      return { success: false, error: 'Chunk text cannot be empty' };
    }

    const selectedVoice = (voice || await getSelectedVoice()) as VoiceId;

    console.log(`Generating chunk ${chunkIndex + 1}/${totalChunks}: "${text.substring(0, 30)}..."`);

    // Generate audio blob
    const blob = await TTSEngine.generate(text, selectedVoice);

    // Convert blob to base64 for cross-origin transfer
    // Blob URLs are origin-bound; content scripts cannot load offscreen blob URLs
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    return {
      success: true,
      audioData: base64,       // base64-encoded audio data
      audioMimeType: blob.type, // e.g., 'audio/wav'
      chunkIndex,
      generationToken
    };
  } catch (error) {
    console.error('Chunk generation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate chunk'
    };
  }
}

/**
 * Stop is now a no-op in offscreen (playback handled by content scripts)
 * Kept for backward compatibility with existing message flow
 */
async function handleStop(): Promise<TTSResponse> {
  // No audio playback in offscreen anymore - this is handled by content scripts
  return { success: true };
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
 * Note: isPlaying removed - playback state is managed by service worker
 */
async function handleGetStatus(): Promise<TTSResponse & { initialized: boolean }> {
  return {
    success: true,
    initialized: TTSEngine.isInitialized()
  };
}

/**
 * Extract text from a document (PDF or text file).
 * Full implementation in 06-02-PLAN.md (PDF) and 06-03-PLAN.md (text files).
 *
 * Per CONTEXT.md Decision #2: Offscreen receives ArrayBuffer and performs extraction.
 * PDF.js and TextDecoder run here to avoid popup memory pressure.
 */
async function handleExtractDocument(msg: OffscreenExtractMessage): Promise<DocumentExtractionResult> {
  const { documentType, data, filename, extractionId } = msg;

  console.log(`Extracting ${documentType} document: ${filename} (${data.byteLength} bytes)`);

  try {
    switch (documentType) {
      case 'pdf':
        // Implemented in 06-02-PLAN.md
        return {
          success: false,
          error: 'PDF extraction not yet implemented',
          extractionId
        };

      case 'txt':
      case 'md': {
        const textResult = extractTextFile(data, filename);

        return {
          success: textResult.success,
          text: textResult.text,
          title: textResult.title || filename,
          textLength: textResult.textLength,
          error: textResult.error,
          extractionId
        };
      }

      default:
        return {
          success: false,
          error: `Unsupported document type: ${documentType}`,
          extractionId
        };
    }
  } catch (error) {
    console.error('Document extraction failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Document extraction failed',
      extractionId
    };
  }
}
