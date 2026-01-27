// Re-export document extraction types
export type {
  DocumentType,
  ExtractDocumentMessage,
  DocumentChunkMessage,
  DocumentChunkCompleteMessage,
  OffscreenExtractMessage,
  DocumentExtractionResult,
  ExtractionWarningMessage,
  WarningResponseMessage,
  CancelExtractionMessage,
  GetPendingWarningMessage,
  ExtractionProgressMessage,
  ExtractionState,
  PendingWarning,
  WarningType,
} from './document-types';

export {
  EXTRACTION_THRESHOLDS,
  generateExtractionId,
  needsChunkedUpload,
  calculateChunkCount,
} from './document-types';

// Message targets
export type MessageTarget = 'offscreen' | 'service-worker' | 'popup' | 'content-script';

// Message types enum
export const MessageType = {
  // TTS lifecycle
  TTS_INIT: 'tts-init',
  TTS_GENERATE: 'tts-generate',
  TTS_STOP: 'tts-stop',
  TTS_LIST_VOICES: 'tts-list-voices',

  // Progress updates
  DOWNLOAD_PROGRESS: 'download-progress',
  GENERATION_COMPLETE: 'generation-complete',

  // Status
  GET_STATUS: 'get-status',
  STATUS_UPDATE: 'status-update',

  // Playback control (popup -> service worker -> content script)
  PLAY_AUDIO: 'play-audio',       // Send audio data to content script
  PAUSE_AUDIO: 'pause-audio',     // Pause current audio
  RESUME_AUDIO: 'resume-audio',   // Resume paused audio
  STOP_PLAYBACK: 'stop-playback', // Stop and reset

  // Speed control
  SET_SPEED: 'set-speed',         // Set playbackRate

  // Content script -> service worker
  AUDIO_ENDED: 'audio-ended',     // Playback finished naturally
  AUDIO_ERROR: 'audio-error',     // Playback failed (e.g., autoplay blocked)
  HEARTBEAT: 'heartbeat',         // Content script alive signal

  // Skip control
  SKIP_TO_CHUNK: 'skip-to-chunk', // Skip to specific chunk index

  // Generation control
  TTS_GENERATE_CHUNK: 'tts-generate-chunk',  // Generate single chunk
  CHUNK_READY: 'chunk-ready',     // Chunk audio ready (offscreen -> sw)

  // Content extraction
  EXTRACT_SELECTION: 'extract-selection',     // Get selected text
  EXTRACT_ARTICLE: 'extract-article',         // Full-page Readability extraction

  // Highlighting
  INIT_HIGHLIGHTING: 'init-highlighting',     // Initialize highlighting mode

  // Floating player control
  SHOW_FLOATING_PLAYER: 'show-floating-player', // Restore dismissed floating player

  // Document extraction (Phase 6)
  EXTRACT_DOCUMENT: 'extract-document',
  DOCUMENT_CHUNK: 'document-chunk',
  DOCUMENT_CHUNK_COMPLETE: 'document-chunk-complete',
  INIT_CHUNK_STORAGE: 'init-chunk-storage',
  STORE_CHUNK: 'store-chunk',
  EXTRACT_FROM_CHUNKS: 'extract-from-chunks',
  CLEANUP_CHUNKS: 'cleanup-chunks',
  EXTRACTION_WARNING: 'extraction-warning',
  WARNING_RESPONSE: 'warning-response',
  CANCEL_EXTRACTION: 'cancel-extraction',
  GET_PENDING_WARNING: 'get-pending-warning',
  EXTRACTION_PROGRESS: 'extraction-progress',
  EXTRACTION_COMPLETE: 'extraction-complete',
  PAGE_COUNT_WARNING: 'page-count-warning',
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

// Base message structure
interface BaseMessage {
  target: MessageTarget;
  type: MessageTypeValue;
}

// Specific message types
export interface TTSInitMessage extends BaseMessage {
  type: typeof MessageType.TTS_INIT;
}

export interface TTSGenerateMessage extends BaseMessage {
  type: typeof MessageType.TTS_GENERATE;
  text: string;
  voice: string;
}

export interface TTSStopMessage extends BaseMessage {
  type: typeof MessageType.TTS_STOP;
}

export interface TTSListVoicesMessage extends BaseMessage {
  type: typeof MessageType.TTS_LIST_VOICES;
}

export interface DownloadProgressMessage extends BaseMessage {
  type: typeof MessageType.DOWNLOAD_PROGRESS;
  progress: {
    file: string;
    loaded: number;
    total: number;
    percent: number;
  };
}

export interface GenerationCompleteMessage extends BaseMessage {
  type: typeof MessageType.GENERATION_COMPLETE;
}

export interface GetStatusMessage extends BaseMessage {
  type: typeof MessageType.GET_STATUS;
}

export interface StatusUpdateMessage extends BaseMessage {
  type: typeof MessageType.STATUS_UPDATE;
  status: {
    initialized: boolean;
    currentVoice?: string;
    isPlaying?: boolean;
  };
}

// Playback control messages
// Note: Uses base64-encoded audio data instead of blob URL because blob URLs are origin-bound
// and cannot be loaded by content scripts running in web page context.
export interface PlayAudioMessage extends BaseMessage {
  type: typeof MessageType.PLAY_AUDIO;
  audioData: string;      // Base64-encoded audio data
  audioMimeType: string;  // e.g., 'audio/wav'
  generationToken: string;
  chunkIndex: number;     // Index for highlighting
  totalChunks: number;    // Total chunks for progress
}

export interface PauseAudioMessage extends BaseMessage {
  type: typeof MessageType.PAUSE_AUDIO;
}

export interface ResumeAudioMessage extends BaseMessage {
  type: typeof MessageType.RESUME_AUDIO;
}

export interface StopPlaybackMessage extends BaseMessage {
  type: typeof MessageType.STOP_PLAYBACK;
}

export interface SetSpeedMessage extends BaseMessage {
  type: typeof MessageType.SET_SPEED;
  speed: number;
}

export interface AudioEndedMessage extends BaseMessage {
  type: typeof MessageType.AUDIO_ENDED;
  generationToken: string;
}

export interface AudioErrorMessage extends BaseMessage {
  type: typeof MessageType.AUDIO_ERROR;
  error: string;
  generationToken: string;
}

export interface HeartbeatMessage extends BaseMessage {
  type: typeof MessageType.HEARTBEAT;
  generationToken: string;
  currentTime: number;
  duration: number;
}

export interface SkipToChunkMessage extends BaseMessage {
  type: typeof MessageType.SKIP_TO_CHUNK;
  chunkIndex: number;
}

export interface TTSGenerateChunkMessage extends BaseMessage {
  type: typeof MessageType.TTS_GENERATE_CHUNK;
  text: string;
  voice: string;
  chunkIndex: number;
  totalChunks: number;
  generationToken: string;
}

export interface ChunkReadyMessage extends BaseMessage {
  type: typeof MessageType.CHUNK_READY;
  audioUrl: string;
  chunkIndex: number;
  generationToken: string;
}

// Content extraction messages
export interface ExtractSelectionMessage extends BaseMessage {
  type: typeof MessageType.EXTRACT_SELECTION;
}

export interface ExtractArticleMessage extends BaseMessage {
  type: typeof MessageType.EXTRACT_ARTICLE;
}

// Highlighting messages
export interface InitHighlightingMessage extends BaseMessage {
  type: typeof MessageType.INIT_HIGHLIGHTING;
  mode: 'selection' | 'overlay';
  text: string;
  title?: string;
}

// Floating player control messages
export interface ShowFloatingPlayerMessage extends BaseMessage {
  type: typeof MessageType.SHOW_FLOATING_PLAYER;
}

/**
 * Result returned from content extraction operations.
 * Used as sendResponse payload, not as a routable message.
 */
export interface ExtractionResult {
  success: boolean;
  text?: string;           // Extracted text content
  title?: string;          // Page/article title
  url?: string;            // Page URL
  error?: string;          // Error message if failed
  source: 'selection' | 'article';  // What was extracted
}

// Union type for all messages
export type TTSMessage =
  | TTSInitMessage
  | TTSGenerateMessage
  | TTSStopMessage
  | TTSListVoicesMessage
  | DownloadProgressMessage
  | GenerationCompleteMessage
  | GetStatusMessage
  | StatusUpdateMessage
  | PlayAudioMessage
  | PauseAudioMessage
  | ResumeAudioMessage
  | StopPlaybackMessage
  | SetSpeedMessage
  | AudioEndedMessage
  | AudioErrorMessage
  | HeartbeatMessage
  | SkipToChunkMessage
  | TTSGenerateChunkMessage
  | ChunkReadyMessage
  | ExtractSelectionMessage
  | ExtractArticleMessage
  | InitHighlightingMessage
  | ShowFloatingPlayerMessage;

// Response types
export interface TTSResponse {
  success: boolean;
  error?: string;
}

export interface VoiceListResponse extends TTSResponse {
  voices?: string[];
}

export interface InitHighlightingResponse extends TTSResponse {
  chunks?: string[];
}

export interface StatusResponse extends TTSResponse {
  initialized: boolean;
  currentVoice?: string;
  isPlaying?: boolean;
}

// Helper to create messages
export function createMessage<T extends TTSMessage>(
  target: MessageTarget,
  type: T['type'],
  payload?: Omit<T, 'target' | 'type'>
): T {
  return { target, type, ...payload } as T;
}
