// Message targets
export type MessageTarget = 'offscreen' | 'service-worker' | 'popup';

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

// Union type for all messages
export type TTSMessage =
  | TTSInitMessage
  | TTSGenerateMessage
  | TTSStopMessage
  | TTSListVoicesMessage
  | DownloadProgressMessage
  | GenerationCompleteMessage
  | GetStatusMessage
  | StatusUpdateMessage;

// Response types
export interface TTSResponse {
  success: boolean;
  error?: string;
}

export interface VoiceListResponse extends TTSResponse {
  voices?: string[];
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
