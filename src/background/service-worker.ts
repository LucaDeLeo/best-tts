import { ensureOffscreenDocument } from '../lib/offscreen-manager';
import {
  MessageType,
  EXTRACTION_THRESHOLDS,
  type TTSMessage,
  type TTSResponse,
  type SetSpeedMessage,
  type HeartbeatMessage,
  type AudioEndedMessage,
  type AudioErrorMessage,
  type SkipToChunkMessage,
  type ExtractionResult,
  type TTSGenerateMessage,
  type InitHighlightingResponse,
  type ExtractDocumentMessage,
  type DocumentChunkMessage,
  type DocumentChunkCompleteMessage,
  type WarningResponseMessage,
  type CancelExtractionMessage,
  type DocumentExtractionResult,
  type PendingWarning,
  type OffscreenExtractMessage,
  type DocumentType,
  type SaveToLibraryMessage,
  type GetLibraryStatusMessage,
  type AutosavePositionMessage,
  type GetLibraryItemMessage,
  type PlayLibraryItemMessage,
  type FolderCreateMessage,
  type FolderRenameMessage,
  type FolderDeleteMessage,
  type ItemMoveToFolderMessage,
  type GetLibraryItemsMessage,
  type DeleteLibraryItemMessage,
  type GetRecentItemsMessage,
  type UpdateSettingsMessage,
  type VoicePreviewMessage,
  type VoicePreviewResponse,
  type MlxServerStatusMessage,
  type MlxListVoicesMessage,
} from '../lib/messages';
import {
  checkServerHealth,
  generateSpeech,
  getVoicesForModel,
} from '../lib/mlx-audio-client';
import {
  migrateSettings,
  getSettings,
  updateSettings,
} from '../lib/settings-storage';
import {
  saveLibraryItem,
  isUrlSaved,
  hashContent,
  getStorageEstimateForLibrary,
  getLibraryItemById,
  getLibraryContent,
  createFolder,
  renameFolder,
  deleteFolder,
  getFolders,
  getLibraryItems,
  getRecentItems,
  updateLibraryItem,
  deleteLibraryItem,
  getLibraryDB,
} from '../lib/library-storage';
import type { LibraryItem, LibraryContent } from '../lib/library-types';
import { savePositionNow, resumePosition } from '../lib/autosave';
import {
  getExtractionState,
  initExtractionState,
  updateExtractionState,
  clearExtractionState,
  trackChunkReceived,
  allChunksReceived,
  setPendingWarning,
  clearPendingWarning,
  isExtractionCancelled,
} from '../lib/extraction-state';
import {
  getPlaybackState,
  updatePlaybackState,
  resetPlaybackState,
  generateToken,
} from '../lib/playback-state';
import { getSelectedVoice } from '../lib/voice-storage';
import { splitIntoChunks } from '../lib/text-chunker';

// Service worker loaded

// ── Continuous generation pipeline ────────────────────────
// Generates ALL chunks as fast as the TTS engine allows, storing
// results in a buffer. Playback reads from the buffer for
// instant, gapless sentence transitions.
interface GeneratedAudio {
  audioData: string;
  audioMimeType: string;
}

const audioBuffer: Map<number, GeneratedAudio> = new Map();
let generationLoopToken: string | null = null;  // tracks active loop

function clearAudioBuffer(): void {
  audioBuffer.clear();
  generationLoopToken = null;
}

/**
 * Continuous generation loop — generates chunks as fast as possible
 * starting from `fromIndex`. Runs in the background while audio plays.
 * Stops when all chunks are generated, token changes, or playback stops.
 */
async function runGenerationLoop(fromIndex: number, token: string): Promise<void> {
  generationLoopToken = token;
  const state = getPlaybackState();
  const voice = state.currentVoice || await getSelectedVoice();

  for (let i = fromIndex; i < state.totalChunks; i++) {
    // Stop if token changed (new playback session, stop, etc.)
    if (getPlaybackState().generationToken !== token || generationLoopToken !== token) {
      return;
    }

    // Skip chunks already in the buffer (e.g., first chunk generated synchronously)
    if (audioBuffer.has(i)) continue;

    const result = await generateChunk(
      state.chunks[i],
      voice,
      i,
      state.totalChunks,
      token
    );

    // Verify token still matches after async generation
    if (getPlaybackState().generationToken !== token || generationLoopToken !== token) {
      return;
    }

    if (result.success && result.audioData) {
      audioBuffer.set(i, {
        audioData: result.audioData,
        audioMimeType: result.audioMimeType || 'audio/wav',
      });
    } else {
      // Generation failed for this chunk — log and continue to next
      console.warn(`Generation loop: chunk ${i} failed, skipping`);
    }
  }
}

// Run settings migration on startup (one-time per install)
migrateSettings().then(migrated => {
  if (migrated) {
    console.log('Settings migration completed on startup');
  }
});

// Restore playback speed from unified settings on startup
// and auto-detect mlx-audio server if configured
getSettings().then(async (settings) => {
  updatePlaybackState({ playbackSpeed: settings.speed });

  // Auto-detect mlx-audio server on startup
  if (settings.engine === 'mlx-audio') {
    const status = await checkServerHealth(settings.mlxAudioUrl);
    await chrome.storage.session.set({ mlxServerStatus: status });
    if (status.online && status.models.length > 0 && !settings.mlxAudioModel) {
      await updateSettings({ mlxAudioModel: status.models[0] });
    }
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

  // Library save context menu (Phase 7)
  chrome.contextMenus.create({
    id: 'save-to-library',
    title: 'Save to Library',
    contexts: ['page']  // Show on right-click anywhere on page
  });

  // Open library context menu (Phase 8)
  chrome.contextMenus.create({
    id: 'open-best-tts-library',
    title: 'Open Best TTS Library',
    contexts: ['page']  // Show on right-click anywhere
  });
});

// Extended message type to include routing - use intersection since TTSMessage is a union
type RoutableMessage = TTSMessage & {
  forwardTo?: 'offscreen';
};

// Union type for all messages handled by service worker
// Includes TTSMessage union plus document extraction types (which use literal target/type fields)
type ServiceWorkerMessage = TTSMessage
  | ExtractDocumentMessage
  | DocumentChunkMessage
  | DocumentChunkCompleteMessage
  | WarningResponseMessage
  | CancelExtractionMessage
  | { type: 'folder-list'; target: 'service-worker' }
  | { type: 'get-pending-warning'; target: 'service-worker' }
  | { type: 'page-count-warning'; target: 'service-worker'; extractionId: string; pageCount: number; threshold: number }
  | { type: 'get-settings'; target: 'service-worker' }
  | { type: 'open-side-panel'; target: 'service-worker' };

// Handle GET_TAB_ID requests - simple utility to let content script know its tab ID
// This is used for rehydration logic to verify the content script is in the active playback tab
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_TAB_ID') {
    sendResponse({ tabId: sender.tab?.id });
    return false; // Synchronous response
  }
  return false; // Not handled here
});

// Main message router
chrome.runtime.onMessage.addListener((message: RoutableMessage | ServiceWorkerMessage, sender, sendResponse) => {
  // Only handle messages intended for service worker
  if (message.target !== 'service-worker') {
    return false; // Not for us
  }

  // Check if this message should be forwarded to offscreen
  if ('forwardTo' in message && message.forwardTo === 'offscreen') {
    routeToOffscreen(message as RoutableMessage, sendResponse);
    return true; // Keep channel open for async response
  }

  // Handle messages directed at the service worker itself
  handleServiceWorkerMessage(message as ServiceWorkerMessage, sendResponse);
  return true; // Keep channel open for async response
});

/**
 * Handle messages directed at the service worker itself
 */
async function handleServiceWorkerMessage(
  message: ServiceWorkerMessage,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendResponse: (response: any) => void
): Promise<void> {
  try {
    switch (message.type) {
      case MessageType.GET_STATUS: {
        // Return full playback state with explicit boolean fields for UI sync
        const state = getPlaybackState();
        sendResponse({
          success: true,
          // Include raw state first, then override with computed fields
          ...state,
          initialized: true,
          isPlaying: state.status === 'playing',
          isGenerating: state.status === 'generating',
          isPaused: state.status === 'paused'
        } as TTSResponse & typeof state & {
          initialized: boolean;
          isPlaying: boolean;
          isGenerating: boolean;
          isPaused: boolean;
        });
        break;
      }

      case MessageType.SET_SPEED: {
        const { speed } = message as SetSpeedMessage;
        const clampedSpeed = Math.max(0.5, Math.min(4.0, speed));
        updatePlaybackState({ playbackSpeed: clampedSpeed });

        // Persist to unified settings
        updateSettings({ speed: clampedSpeed });

        // Forward to active tab's content script if playing or paused
        const currentState = getPlaybackState();
        if (currentState.activeTabId && (currentState.status === 'playing' || currentState.status === 'paused')) {
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
        clearAudioBuffer();
        if (prevState.activeTabId) {
          chrome.tabs.sendMessage(prevState.activeTabId, {
            target: 'content-script',
            type: MessageType.STOP_PLAYBACK
          }).catch(() => {
            // Content script might not be available
          });
        }
        resetPlaybackState();
        broadcastStatusUpdate();
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
            resetPlaybackState();
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
          resetPlaybackState();
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

        // Note: don't clear audioBuffer on skip — pre-generated chunks
        // ahead of the target are still valid and will be used.

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

      case MessageType.TTS_GENERATE: {
        // Handle TTS_GENERATE directly to integrate highlighting
        // Per Phase 4: Initialize highlighting in content script, get chunks back
        const { text, voice, libraryItemId, libraryContentHash, libraryContentLength, startChunkIndex } = message as TTSGenerateMessage;

        if (!text || text.trim().length === 0) {
          sendResponse({ success: false, error: 'Text cannot be empty' });
          break;
        }

        // Library context for autosave
        const libraryContext = libraryItemId ? {
          libraryItemId,
          libraryContentHash: libraryContentHash || null,
          libraryContentLength: libraryContentLength || null
        } : null;

        // Get active tab for highlighting initialization
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          // No active tab - fallback to chunking without highlighting
          console.warn('No active tab for highlighting, using fallback chunking');
          const fallbackChunks = splitIntoChunks(text);
          if (fallbackChunks.length === 0) {
            sendResponse({ success: false, error: 'No valid sentences found in text' });
            break;
          }
          await startPlaybackWithChunks(fallbackChunks, voice, null, sendResponse, libraryContext, startChunkIndex);
          break;
        }

        // Determine highlighting mode based on extraction source
        // If pendingExtraction exists and is article, use overlay mode
        interface PendingExtraction {
          text: string;
          title?: string;
          url?: string;
          source: 'selection' | 'article';
          timestamp: number;
        }
        const { pendingExtraction } = await chrome.storage.session.get('pendingExtraction') as { pendingExtraction?: PendingExtraction };
        const mode = pendingExtraction?.source === 'article' ? 'overlay' : 'selection';

        try {
          // Initialize highlighting in content script
          // This returns chunks that are aligned with DOM spans
          const highlightResult = await chrome.tabs.sendMessage(tab.id, {
            target: 'content-script',
            type: MessageType.INIT_HIGHLIGHTING,
            mode,
            text,
            title: pendingExtraction?.title
          }) as InitHighlightingResponse;

          if (!highlightResult.success || !highlightResult.chunks || highlightResult.chunks.length === 0) {
            // Fallback: proceed without highlighting
            console.warn('Highlighting init failed, proceeding without:', highlightResult.error);
            const fallbackChunks = splitIntoChunks(text);
            if (fallbackChunks.length === 0) {
              sendResponse({ success: false, error: 'No valid sentences found in text' });
              break;
            }
            await startPlaybackWithChunks(fallbackChunks, voice, tab.id, sendResponse, libraryContext, startChunkIndex);
            break;
          }

          // Use chunks from highlighting (guaranteed DOM alignment)
          await startPlaybackWithChunks(highlightResult.chunks, voice, tab.id, sendResponse, libraryContext, startChunkIndex);
        } catch (error) {
          // Content script error (not injected, etc.) - fallback
          console.warn('Could not communicate with content script:', error);
          const fallbackChunks = splitIntoChunks(text);
          if (fallbackChunks.length === 0) {
            sendResponse({ success: false, error: 'No valid sentences found in text' });
            break;
          }
          await startPlaybackWithChunks(fallbackChunks, voice, tab.id, sendResponse, libraryContext, startChunkIndex);
        }
        break;
      }

      // Document extraction messages (Phase 6)
      case MessageType.EXTRACT_DOCUMENT: {
        const msg = message as ExtractDocumentMessage;
        await handleExtractDocument(msg, sendResponse);
        break;
      }

      case MessageType.DOCUMENT_CHUNK: {
        const msg = message as DocumentChunkMessage;
        await handleDocumentChunk(msg, sendResponse);
        break;
      }

      case MessageType.DOCUMENT_CHUNK_COMPLETE: {
        const msg = message as DocumentChunkCompleteMessage;
        await handleDocumentChunkComplete(msg, sendResponse);
        break;
      }

      case MessageType.WARNING_RESPONSE: {
        const msg = message as WarningResponseMessage;
        await handleWarningResponse(msg, sendResponse);
        break;
      }

      case MessageType.CANCEL_EXTRACTION: {
        const msg = message as CancelExtractionMessage;
        await handleCancelExtraction(msg, sendResponse);
        break;
      }

      case MessageType.GET_PENDING_WARNING: {
        handleGetPendingWarning(sendResponse);
        break;
      }

      case MessageType.PAGE_COUNT_WARNING: {
        // Early page count warning from offscreen (per CONTEXT Decision #6)
        const msg = message as { extractionId: string; pageCount: number; threshold: number };
        await handlePageCountWarning(msg, sendResponse);
        break;
      }

      // Library autosave messages (Phase 7)
      case MessageType.AUTOSAVE_POSITION: {
        const msg = message as AutosavePositionMessage;
        await savePositionNow(
          msg.itemId,
          msg.chunkIndex,
          msg.chunkText,
          msg.totalChunks,
          msg.contentLength,
          msg.contentHash
        );
        sendResponse({ success: true });
        break;
      }

      case MessageType.GET_LIBRARY_ITEM: {
        const { itemId } = message as GetLibraryItemMessage;
        const item = await getLibraryItemById(itemId);
        if (!item) {
          sendResponse({ success: false, error: 'Item not found' });
          break;
        }
        const content = await getLibraryContent(itemId);
        sendResponse({
          success: true,
          item,
          content
        });
        break;
      }

      case MessageType.PLAY_LIBRARY_ITEM: {
        const { itemId } = message as PlayLibraryItemMessage;
        const item = await getLibraryItemById(itemId);
        if (!item) {
          sendResponse({ success: false, error: 'Item not found' });
          break;
        }
        if (item.contentDeleted) {
          sendResponse({ success: false, error: 'Content deleted. Re-extract from original page.' });
          break;
        }
        const contentRecord = await getLibraryContent(itemId);
        if (!contentRecord) {
          sendResponse({ success: false, error: 'Content not found' });
          break;
        }

        // Calculate resume position if we have resume data
        let startChunkIndex = 0;
        let resumeMethod: string | null = null;

        if (item.resumeData) {
          // Re-chunk the content to get current chunks
          const newChunks = splitIntoChunks(contentRecord);
          const contentHash = await hashContent(contentRecord);

          const resumeResult = resumePosition({
            storedResume: item.resumeData,
            newContent: contentRecord,
            newChunks,
            newContentHash: contentHash
          });

          startChunkIndex = resumeResult.chunkIndex;
          resumeMethod = resumeResult.method;

          // Log if content changed
          if (resumeResult.contentChanged) {
            console.log(`Content changed since last read, resuming via ${resumeMethod}`);
          }
        }

        sendResponse({
          success: true,
          item,
          content: contentRecord,
          contentHash: await hashContent(contentRecord),
          resumeData: item.resumeData,
          startChunkIndex,
          resumeMethod
        });
        break;
      }

      case MessageType.SAVE_TO_LIBRARY: {
        const { item } = message as SaveToLibraryMessage;
        const normalizedUrl = item.url.trim();

        // Check quota
        const quota = await getStorageEstimateForLibrary();
        const contentSize = new Blob([item.content]).size;
        if (quota && quota.available < contentSize + 5 * 1024 * 1024) {
          sendResponse({ success: false, error: 'Storage full' });
          break;
        }

        // Check if already saved for URL-backed content.
        // Imported files can have empty URL and should not all dedupe to one item.
        if (normalizedUrl) {
          const existing = await isUrlSaved(normalizedUrl);
          if (existing) {
            sendResponse({ success: true, alreadyExists: true, itemId: existing.id });
            break;
          }
        }

        // Create and save
        const libraryItemToSave: LibraryItem = {
          id: crypto.randomUUID(),
          title: item.title,
          url: normalizedUrl,
          source: item.source,
          folderId: item.folderId || null,
          createdAt: Date.now(),
          lastReadAt: Date.now(),
          contentDeleted: false,
          contentDeletedAt: null,
          contentSize: contentSize,
          contentHash: await hashContent(item.content),
          resumeData: null
        };

        await saveLibraryItem(libraryItemToSave, item.content);
        sendResponse({ success: true, itemId: libraryItemToSave.id });
        break;
      }

      case MessageType.GET_LIBRARY_STATUS: {
        const { url } = message as GetLibraryStatusMessage;
        const existingItem = await isUrlSaved(url);
        sendResponse({
          success: true,
          isSaved: !!existingItem,
          itemId: existingItem?.id
        });
        break;
      }

      // Folder management handlers (Phase 7)
      case MessageType.FOLDER_CREATE: {
        const { name } = message as FolderCreateMessage;
        if (!name || name.trim().length === 0) {
          sendResponse({ success: false, error: 'Folder name required' });
          break;
        }
        const folder = await createFolder(name.trim());
        sendResponse({ success: true, folder });
        break;
      }

      case MessageType.FOLDER_RENAME: {
        const { folderId, name } = message as FolderRenameMessage;
        if (!name || name.trim().length === 0) {
          sendResponse({ success: false, error: 'Folder name required' });
          break;
        }
        await renameFolder(folderId, name.trim());
        sendResponse({ success: true });
        break;
      }

      case MessageType.FOLDER_DELETE: {
        const { folderId } = message as FolderDeleteMessage;
        // Per CONTEXT.md: items in folder move to root (folderId = null)
        // This is handled by deleteFolder which updates items first
        await deleteFolder(folderId);
        sendResponse({ success: true });
        break;
      }

      case MessageType.FOLDER_LIST: {
        const folders = await getFolders();
        sendResponse({ success: true, folders });
        break;
      }

      case MessageType.ITEM_MOVE_TO_FOLDER: {
        const { itemId, folderId } = message as ItemMoveToFolderMessage;
        const item = await getLibraryItemById(itemId);
        if (!item) {
          sendResponse({ success: false, error: 'Item not found' });
          break;
        }
        await updateLibraryItem(itemId, { folderId });
        sendResponse({ success: true });
        break;
      }

      case MessageType.GET_LIBRARY_ITEMS: {
        const { folderId } = message as GetLibraryItemsMessage;
        const items = await getLibraryItems({ folderId });
        sendResponse({ success: true, items });
        break;
      }

      case MessageType.DELETE_LIBRARY_ITEM: {
        const { itemId, deleteContent } = message as DeleteLibraryItemMessage;

        if (deleteContent) {
          // Delete content only, keep metadata
          const item = await getLibraryItemById(itemId);
          if (item) {
            await updateLibraryItem(itemId, {
              contentDeleted: true,
              contentDeletedAt: Date.now()
            });
            // Delete from contents store
            const db = await getLibraryDB();
            await db.delete('library-contents', itemId);
          }
          sendResponse({ success: true });
        } else {
          // Delete completely
          await deleteLibraryItem(itemId);
          sendResponse({ success: true });
        }
        break;
      }

      case MessageType.GET_RECENT_ITEMS: {
        const { limit = 5 } = message as GetRecentItemsMessage;
        const items = await getRecentItems(limit);
        sendResponse({ success: true, items });
        break;
      }

      // Settings messages (Phase 8)
      case MessageType.GET_SETTINGS: {
        const settings = await getSettings();
        sendResponse({ success: true, settings });
        break;
      }

      case MessageType.UPDATE_SETTINGS: {
        const { updates } = message as UpdateSettingsMessage;
        const newSettings = await updateSettings(updates);
        sendResponse({ success: true, settings: newSettings });
        break;
      }

      case 'open-side-panel': {
        // Get current tab and open side panel (Phase 8)
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id && chrome.sidePanel) {
          await chrome.sidePanel.open({ tabId: tab.id });
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Side Panel API not available' });
        }
        break;
      }

      case MessageType.VOICE_PREVIEW: {
        const { voice } = message as VoicePreviewMessage;
        await handleVoicePreviewRequest(voice, sendResponse);
        break;
      }

      case MessageType.MLX_SERVER_STATUS: {
        const mlxMsg = message as MlxServerStatusMessage;
        const mlxSettings = await getSettings();
        const baseUrl = mlxMsg.baseUrl || mlxSettings.mlxAudioUrl;
        const status = await checkServerHealth(baseUrl);
        // Cache result in session storage for quick UI reads
        await chrome.storage.session.set({ mlxServerStatus: status });
        // Auto-populate model if empty and server is online
        if (status.online && status.models.length > 0 && !mlxSettings.mlxAudioModel) {
          await updateSettings({ mlxAudioModel: status.models[0] });
        }
        sendResponse({ success: true, ...status });
        break;
      }

      case MessageType.MLX_LIST_VOICES: {
        const { model } = message as MlxListVoicesMessage;
        const voices = getVoicesForModel(model);
        sendResponse({ success: true, voices });
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
 * Handle voice preview request.
 * mlx-audio: generates directly via HTTP. Kokoro: forwards to offscreen document.
 */
async function handleVoicePreviewRequest(
  voice: string,
  sendResponse: (response: VoicePreviewResponse) => void
): Promise<void> {
  try {
    const settings = await getSettings();

    if (settings.engine === 'mlx-audio') {
      const result = await generateSpeech({
        baseUrl: settings.mlxAudioUrl,
        model: settings.mlxAudioModel,
        text: 'This is a preview of the selected voice.',
        voice,
        speed: settings.speed,
      });
      sendResponse({
        success: result.success,
        audioData: result.audioData,
        audioMimeType: result.audioMimeType,
        error: result.error,
      });
      return;
    }

    // Kokoro: forward to offscreen document
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: MessageType.VOICE_PREVIEW,
      voice
    }) as VoicePreviewResponse;

    sendResponse(response);
  } catch (error) {
    console.error('Voice preview request failed:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Preview request failed'
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
    // Note: TTS_GENERATE is handled by handleServiceWorkerMessage directly (not forwarded).
    // This function only routes TTS_INIT, TTS_LIST_VOICES, etc. to offscreen.
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

/**
 * Broadcast status update to popup and active tab's content script.
 * Per CONTEXT.md decision [13]: SW owns authoritative state; content script holds derived copy.
 * This ensures both popup and floating player stay in sync.
 */
function broadcastStatusUpdate(): void {
  const state = getPlaybackState();
  const statusPayload = {
    initialized: true,
    currentVoice: undefined,
    isPlaying: state.status === 'playing',
    isGenerating: state.status === 'generating',
    isPaused: state.status === 'paused',
    currentChunkIndex: state.currentChunkIndex,
    totalChunks: state.totalChunks,
    playbackSpeed: state.playbackSpeed
  };

  // Broadcast to popup
  chrome.runtime.sendMessage({
    target: 'popup',
    type: MessageType.STATUS_UPDATE,
    status: statusPayload
  }).catch(() => {
    // Popup might not be open
  });

  // Broadcast to active tab's content script (for floating player)
  if (state.activeTabId) {
    chrome.tabs.sendMessage(state.activeTabId, {
      target: 'content-script',
      type: MessageType.STATUS_UPDATE,
      status: statusPayload
    }).catch(() => {
      // Content script might not be injected
    });
  }
}

/**
 * Play a specific chunk by sending audio to content script.
 * Reads from the audio buffer when possible (instant), or waits
 * for the generation loop to produce the chunk.
 */
async function playChunk(chunkIndex: number): Promise<void> {
  const state = getPlaybackState();

  // Validate state
  if (chunkIndex >= state.totalChunks || !state.generationToken) {
    console.log('No more chunks or invalid state');
    resetPlaybackState();
    clearAudioBuffer();
    broadcastStatusUpdate();
    return;
  }

  const tabId = state.activeTabId;
  if (!tabId) {
    console.error('No active tab for playback');
    resetPlaybackState();
    clearAudioBuffer();
    broadcastStatusUpdate();
    return;
  }

  const chunkText = state.chunks[chunkIndex];
  let audio: GeneratedAudio | undefined = audioBuffer.get(chunkIndex);

  if (audio) {
    // Buffer HIT — instant playback, no generation wait
    console.log(`Buffer HIT for chunk ${chunkIndex} (${audioBuffer.size} buffered)`);
    audioBuffer.delete(chunkIndex); // free memory for played chunk
  } else {
    // Buffer MISS — generate on demand (first chunk, or generation loop hasn't caught up)
    console.log(`Buffer MISS for chunk ${chunkIndex}, generating on demand`);

    updatePlaybackState({
      status: 'generating',
      currentChunkIndex: chunkIndex
    });
    broadcastStatusUpdate();

    const voice = state.currentVoice || await getSelectedVoice();
    const result = await generateChunk(
      chunkText,
      voice,
      chunkIndex,
      state.totalChunks,
      state.generationToken
    );

    // Check if generation was cancelled (token mismatch)
    if (getPlaybackState().generationToken !== state.generationToken) {
      console.log('Generation cancelled (token mismatch) - discarding result');
      return;
    }

    if (!result.success || !result.audioData) {
      console.error('Chunk generation failed:', result.error);
      resetPlaybackState();
      broadcastStatusUpdate();
      return;
    }

    audio = { audioData: result.audioData, audioMimeType: result.audioMimeType || 'audio/wav' };
  }

  updatePlaybackState({ currentChunkIndex: chunkIndex });

  // Send audio to content script
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      target: 'content-script',
      type: MessageType.PLAY_AUDIO,
      audioData: audio.audioData,
      audioMimeType: audio.audioMimeType,
      generationToken: state.generationToken,
      chunkIndex: chunkIndex,
      totalChunks: state.totalChunks,
      chunkText: chunkText.slice(0, 100),
      libraryItemId: state.libraryItemId,
      libraryContentHash: state.libraryContentHash,
      libraryContentLength: state.libraryContentLength
    });

    if (response.success) {
      updatePlaybackState({ status: 'playing' });
    } else {
      console.error('Content script playback failed:', response.error);
      resetPlaybackState();
      chrome.runtime.sendMessage({
        target: 'popup',
        type: MessageType.AUDIO_ERROR,
        error: response.error
      }).catch(() => {});
    }
    broadcastStatusUpdate();
  } catch (error) {
    console.error('Failed to send to content script:', error);
    resetPlaybackState();
    broadcastStatusUpdate();
  }
}

/**
 * Request chunk generation from the active engine.
 * mlx-audio: fetches directly from localhost server (skips offscreen).
 * Kokoro: forwards to offscreen WASM document (unchanged).
 * Returns base64-encoded audio data for cross-origin transfer.
 */
async function generateChunk(
  chunkText: string,
  voice: string,
  chunkIndex: number,
  totalChunks: number,
  generationToken: string
): Promise<{ success: boolean; audioData?: string; audioMimeType?: string; error?: string }> {
  const settings = await getSettings();

  if (settings.engine === 'mlx-audio') {
    return generateSpeech({
      baseUrl: settings.mlxAudioUrl,
      model: settings.mlxAudioModel,
      text: chunkText,
      voice: settings.mlxAudioVoice || voice,
      speed: settings.speed,
    });
  }

  // Kokoro: existing offscreen flow
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

/**
 * Library context for autosave tracking
 */
interface LibraryContext {
  libraryItemId: string;
  libraryContentHash: string | null;
  libraryContentLength: number | null;
}

/**
 * Initialize playback state with chunks and start playing first chunk.
 * Used by TTS_GENERATE handler after getting chunks from highlighting or fallback.
 */
async function startPlaybackWithChunks(
  chunks: string[],
  voice: string,
  tabId: number | null,
  sendResponse: (response: TTSResponse & { generationToken?: string; chunks?: string[] }) => void,
  libraryContext?: LibraryContext | null,
  startChunkIndex?: number
): Promise<void> {
  const token = generateToken();
  const safeStartIndex = Math.max(0, Math.min(startChunkIndex ?? 0, chunks.length - 1));

  updatePlaybackState({
    status: 'generating',
    generationToken: token,
    chunks,
    totalChunks: chunks.length,
    currentChunkIndex: safeStartIndex,
    currentVoice: voice,
    activeTabId: tabId,
    // Store library context for autosave (Phase 7)
    libraryItemId: libraryContext?.libraryItemId || null,
    libraryContentHash: libraryContext?.libraryContentHash || null,
    libraryContentLength: libraryContext?.libraryContentLength || null
  });

  console.log(`Starting playback with ${chunks.length} chunks at index ${safeStartIndex}, token ${token}${libraryContext?.libraryItemId ? ` (library: ${libraryContext.libraryItemId})` : ''}`);

  // Clear any stale audio from a previous session
  clearAudioBuffer();

  // Start playing the first chunk (generates on demand since buffer is empty)
  playChunk(safeStartIndex).catch(console.error);

  // Start the continuous generation loop for remaining chunks.
  // Runs in the background — generates as fast as the TTS engine allows,
  // storing results in audioBuffer for instant playback on chunk advance.
  runGenerationLoop(safeStartIndex + 1, token).catch(console.error);

  // Respond immediately with success and the token
  sendResponse({
    success: true,
    generationToken: token,
    chunks
  });
}

// Context menu click handler
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) {
    showNotification('Error', 'No active tab found');
    return;
  }

  // Handle Save to Library context menu
  if (info.menuItemId === 'save-to-library') {
    await handleSaveToLibraryContextMenu(tab);
    return;
  }

  // Handle Open Library context menu (Phase 8)
  if (info.menuItemId === 'open-best-tts-library') {
    // Open side panel in the current tab
    if (tab?.id && chrome.sidePanel) {
      chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
    }
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
 * Handle Save to Library context menu click.
 * Extracts content and saves to library in one step.
 */
async function handleSaveToLibraryContextMenu(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id || !tab.url) {
    showNotification('Error', 'No active tab found');
    return;
  }

  // Check if already saved
  const existing = await isUrlSaved(tab.url);
  if (existing) {
    showNotification('Already in Library', 'This page is already saved.');
    return;
  }

  try {
    // Extract article content
    const result = await chrome.tabs.sendMessage(tab.id, {
      target: 'content-script',
      type: MessageType.EXTRACT_ARTICLE
    }) as ExtractionResult;

    if (!result.success || !result.text) {
      showNotification('Extraction Failed', result.error || 'Could not extract content');
      return;
    }

    // Create library item
    const contentSize = new Blob([result.text]).size;
    const libraryItem: LibraryItem = {
      id: crypto.randomUUID(),
      title: result.title || 'Untitled',
      url: tab.url,
      source: 'webpage',
      folderId: null,
      createdAt: Date.now(),
      lastReadAt: Date.now(),
      contentDeleted: false,
      contentDeletedAt: null,
      contentSize: contentSize,
      contentHash: await hashContent(result.text),
      resumeData: null
    };

    // Save to library
    await saveLibraryItem(libraryItem, result.text);

    showNotification(
      'Saved to Library',
      `"${result.title || 'Untitled'}" has been saved.`
    );

  } catch (error) {
    console.error('Save to library failed:', error);
    showNotification(
      'Save Failed',
      'Could not save to library. Make sure the page is fully loaded.'
    );
  }
}

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

// ============================================================================
// Document Extraction Handlers (Phase 6)
// ============================================================================

// Resolvers for page count warnings (so WARNING_RESPONSE can continue extraction)
const pageCountWarningResolvers = new Map<string, (shouldContinue: boolean) => void>();

/**
 * Handle document extraction request from popup.
 * Per CONTEXT.md Decision #2: Different handling for small vs large files.
 */
async function handleExtractDocument(
  msg: ExtractDocumentMessage,
  sendResponse: (response: DocumentExtractionResult) => void
): Promise<void> {
  const { documentType, data, filename, fileSize, extractionId } = msg;

  // Initialize extraction state
  initExtractionState(extractionId, documentType, filename, fileSize);

  // Ensure offscreen document exists
  await ensureOffscreenDocument();

  // If data is null, this is a chunked upload - initialize chunk storage in offscreen
  if (data === null) {
    console.log(`Starting chunked upload for ${filename} (${fileSize} bytes)`);

    // Initialize chunk storage in offscreen document's IndexedDB
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: MessageType.INIT_CHUNK_STORAGE,
      extractionId,
      documentType,
      filename,
      fileSize
    });

    sendResponse({
      success: true,
      extractionId,
      // Partial response - extraction will complete after chunks
    } as DocumentExtractionResult);
    return;
  }

  // Direct upload - proceed with extraction
  await performExtraction(data, documentType, filename, extractionId, sendResponse);
}

/**
 * Handle incoming chunk for chunked upload.
 * Per CONTEXT.md Decision #2: Forward chunks to offscreen IndexedDB, don't store in SW memory.
 */
async function handleDocumentChunk(
  msg: DocumentChunkMessage,
  sendResponse: (response: { success: boolean }) => void
): Promise<void> {
  const { extractionId, chunkIndex, totalChunks, data } = msg;

  // Check if extraction was cancelled
  if (isExtractionCancelled(extractionId)) {
    sendResponse({ success: false });
    return;
  }

  // Forward chunk to offscreen document for IndexedDB storage
  // SW doesn't hold the chunk data - it goes directly to offscreen
  await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: MessageType.STORE_CHUNK,
    extractionId,
    chunkIndex,
    totalChunks,
    data
  });

  // Track metadata only (not the data itself)
  trackChunkReceived(extractionId, chunkIndex, totalChunks);

  // Update progress
  updateExtractionState({
    progress: Math.round(((chunkIndex + 1) / totalChunks) * 50) // 50% for upload
  });

  sendResponse({ success: true });
}

/**
 * Handle chunk upload completion - trigger extraction in offscreen.
 * Per CONTEXT.md Decision #2: Offscreen reassembles from IndexedDB and extracts.
 */
async function handleDocumentChunkComplete(
  msg: DocumentChunkCompleteMessage,
  sendResponse: (response: DocumentExtractionResult) => void
): Promise<void> {
  const { extractionId } = msg;

  // Check if extraction was cancelled
  if (isExtractionCancelled(extractionId)) {
    // Tell offscreen to clean up IndexedDB chunks
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: MessageType.CLEANUP_CHUNKS,
      extractionId
    }).catch(() => {});

    sendResponse({
      success: false,
      error: 'Extraction cancelled',
      extractionId
    });
    return;
  }

  const state = getExtractionState();
  if (!state) {
    sendResponse({
      success: false,
      error: 'No extraction in progress',
      extractionId
    });
    return;
  }

  // Verify all chunks received
  if (!allChunksReceived(extractionId)) {
    sendResponse({
      success: false,
      error: 'Not all chunks received',
      extractionId
    });
    clearExtractionState();
    return;
  }

  updateExtractionState({ status: 'extracting' });

  // Tell offscreen to reassemble from IndexedDB and extract
  // The offscreen document holds the chunks in IndexedDB, not the SW
  const result = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: MessageType.EXTRACT_FROM_CHUNKS,
    extractionId,
    documentType: state.documentType,
    filename: state.filename
  }) as DocumentExtractionResult;

  // Handle result with warning checks
  await handleExtractionResultWithWarnings(result, extractionId, sendResponse);
}

/**
 * Perform actual extraction by sending to offscreen document.
 * For direct uploads (non-chunked).
 */
async function performExtraction(
  data: ArrayBuffer,
  documentType: DocumentType,
  filename: string,
  extractionId: string,
  sendResponse: (response: DocumentExtractionResult) => void
): Promise<void> {
  try {
    updateExtractionState({ status: 'extracting' });

    // Send to offscreen for extraction
    const result = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: MessageType.EXTRACT_DOCUMENT,
      documentType,
      data,
      filename,
      extractionId
    } as OffscreenExtractMessage) as DocumentExtractionResult;

    await handleExtractionResultWithWarnings(result, extractionId, sendResponse);

  } catch (error) {
    console.error('Extraction failed:', error);
    clearExtractionState();
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Extraction failed',
      extractionId
    });
  }
}

/**
 * Handle extraction result, checking for soft limit warnings.
 * Per CONTEXT.md Decision #6: Page count and text length warnings.
 *
 * NOTE: Page count warning is now triggered EARLY (after PDF metadata load)
 * by the offscreen document. This function handles the warning response
 * and text length warnings (which require full extraction).
 */
async function handleExtractionResultWithWarnings(
  result: DocumentExtractionResult,
  extractionId: string,
  sendResponse: (response: DocumentExtractionResult) => void
): Promise<void> {
  // Check if cancelled during extraction
  if (isExtractionCancelled(extractionId)) {
    sendResponse({
      success: false,
      error: 'Extraction cancelled',
      extractionId
    });
    return;
  }

  if (!result.success) {
    clearExtractionState();
    sendResponse(result);
    return;
  }

  // Check text length warning (page count warning handled early by offscreen)
  if (result.textLength && result.textLength > EXTRACTION_THRESHOLDS.TEXT_LENGTH) {
    const warning: PendingWarning = {
      type: 'textLength',
      value: result.textLength,
      threshold: EXTRACTION_THRESHOLDS.TEXT_LENGTH,
      extractionId
    };

    updateExtractionState({
      status: 'warning',
      textLength: result.textLength,
      pendingWarning: warning
    });

    await chrome.storage.session.set({
      pendingExtractionResult: result
    });

    setPendingWarning(warning, () => {
      clearExtractionState();
      chrome.storage.session.remove('pendingExtractionResult');
    });

    chrome.runtime.sendMessage({
      target: 'popup',
      type: MessageType.EXTRACTION_WARNING,
      warning
    }).catch(() => {});

    sendResponse({
      success: true,
      extractionId,
      // Partial response - waiting for user confirmation
    } as DocumentExtractionResult);
    return;
  }

  // No warnings - complete successfully
  clearExtractionState();
  sendResponse(result);
}

/**
 * Handle user response to a warning.
 * Handles both early page count warnings (during extraction) and
 * post-extraction text length warnings.
 */
async function handleWarningResponse(
  msg: WarningResponseMessage,
  sendResponse: (response: DocumentExtractionResult) => void
): Promise<void> {
  const { extractionId, action } = msg;

  clearPendingWarning(extractionId);

  // Check if this is an early page count warning (extraction paused, waiting for response)
  const pageCountResolver = pageCountWarningResolvers.get(extractionId);
  if (pageCountResolver) {
    pageCountWarningResolvers.delete(extractionId);

    if (action === 'cancel') {
      pageCountResolver(false); // Tell offscreen to abort
      clearExtractionState();
      sendResponse({
        success: false,
        error: 'Extraction cancelled by user',
        extractionId
      });
    } else {
      pageCountResolver(true); // Tell offscreen to continue
      // Acknowledge immediately so the popup message channel doesn't time out.
      // The original EXTRACT_DOCUMENT call returns the final extraction result.
      sendResponse({
        success: true,
        extractionId
      });
    }
    return;
  }

  // Post-extraction warning (text length) - result already stored
  if (action === 'cancel') {
    clearExtractionState();
    await chrome.storage.session.remove('pendingExtractionResult');
    sendResponse({
      success: false,
      error: 'Extraction cancelled by user',
      extractionId
    });
    return;
  }

  // User chose to continue - retrieve stored result
  const { pendingExtractionResult } = await chrome.storage.session.get('pendingExtractionResult');
  await chrome.storage.session.remove('pendingExtractionResult');

  if (!pendingExtractionResult) {
    clearExtractionState();
    sendResponse({
      success: false,
      error: 'Extraction result not found',
      extractionId
    });
    return;
  }

  clearExtractionState();
  sendResponse(pendingExtractionResult as DocumentExtractionResult);
}

/**
 * Handle extraction cancellation.
 * Per CONTEXT.md Decision #11: Support cancellation for long extractions.
 */
async function handleCancelExtraction(
  msg: CancelExtractionMessage,
  sendResponse: (response: { success: boolean }) => void
): Promise<void> {
  const { extractionId } = msg;
  const state = getExtractionState();

  if (state?.extractionId === extractionId) {
    // Notify offscreen to abort extraction and clean up IndexedDB chunks
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: MessageType.CANCEL_EXTRACTION,
      extractionId
    }).catch(() => {});

    clearExtractionState();
    chrome.storage.session.remove('pendingExtractionResult').catch(() => {});
  }

  sendResponse({ success: true });
}

/**
 * Handle request for pending warning (popup reopen).
 * Per CONTEXT.md Decision #6: Popup checks for pending warning on load.
 */
function handleGetPendingWarning(
  sendResponse: (response: { warning: PendingWarning | null }) => void
): void {
  const state = getExtractionState();
  sendResponse({
    warning: state?.pendingWarning || null
  });
}

/**
 * Handle early page count warning from offscreen (per CONTEXT Decision #6).
 * This is called DURING extraction, BEFORE full text extraction begins.
 * Extraction is paused in offscreen waiting for this response.
 */
async function handlePageCountWarning(
  msg: { extractionId: string; pageCount: number; threshold: number },
  sendResponse: (response: { continue: boolean }) => void
): Promise<void> {
  const { extractionId, pageCount, threshold } = msg;

  // Check if extraction was cancelled
  if (isExtractionCancelled(extractionId)) {
    sendResponse({ continue: false });
    return;
  }

  const warning: PendingWarning = {
    type: 'pageCount',
    value: pageCount,
    threshold,
    extractionId
  };

  // Update state to waiting for user confirmation
  updateExtractionState({
    status: 'warning',
    pageCount,
    pendingWarning: warning
  });

  // Try to send warning to popup if open
  chrome.runtime.sendMessage({
    target: 'popup',
    type: MessageType.EXTRACTION_WARNING,
    warning
  }).catch(() => {
    // Popup not open - warning will be retrieved when popup opens
  });

  // Show badge indicator
  chrome.action.setBadgeText({ text: '!' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#ffc107' }).catch(() => {});

  // Store a Promise resolver so WARNING_RESPONSE can resolve it
  // This allows the offscreen extraction to pause and wait
  const continuePromise = new Promise<boolean>((resolve) => {
    pageCountWarningResolvers.set(extractionId, resolve);

    // Set timeout for auto-cancel (5 minutes per CONTEXT.md)
    setTimeout(() => {
      if (pageCountWarningResolvers.has(extractionId)) {
        console.log('Page count warning timeout - auto-cancelling');
        pageCountWarningResolvers.delete(extractionId);
        resolve(false);
        clearExtractionState();
      }
    }, 5 * 60 * 1000);
  });

  const shouldContinue = await continuePromise;
  sendResponse({ continue: shouldContinue });
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

// Detect hard navigation to handle state rehydration
// Per CONTEXT.md decision [15]: SW stores state, content script rehydrates on load
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const state = getPlaybackState();

  // Only care about the tab we're playing in
  if (state.activeTabId !== tabId) return;

  if (changeInfo.status === 'loading') {
    // Stop background generation on navigation; buffered audio is page-context specific.
    clearAudioBuffer();

    // Hard navigation started - audio will stop, content script destroyed
    // Mark state as paused so rehydration shows correct state
    if (state.status === 'playing' || state.status === 'generating') {
      console.log('Hard navigation detected in active tab, marking as paused for rehydration');
      // Update state to paused - audio element will be destroyed by navigation
      // so we can't continue playing. User will need to resume manually.
      updatePlaybackState({ status: 'paused' });
      broadcastStatusUpdate();
    }
  }

  if (changeInfo.status === 'complete' && state.status !== 'idle') {
    // Page loaded - content script will request state via GET_STATUS
    // and show player if playback was active
    console.log('Page load complete, content script should rehydrate');
  }
});

// Handle tab closure - reset state if the active playback tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  const state = getPlaybackState();
  if (state.activeTabId === tabId) {
    console.log('Active playback tab closed, resetting state');
    resetPlaybackState();
  }
});
