import {
  MessageType,
  EXTRACTION_THRESHOLDS,
  generateExtractionId,
  needsChunkedUpload,
  calculateChunkCount,
  type TTSResponse,
  type VoiceListResponse,
  type ExtractionResult,
  type DocumentType,
  type DocumentExtractionResult,
  type PendingWarning,
  type SaveToLibraryResponse,
} from '../lib/messages';
import { getSelectedVoice, setSelectedVoice } from '../lib/voice-storage';
import { getDownloadProgress } from '../lib/model-cache';
import { getSettings } from '../lib/settings-storage';
import type { VoiceId } from '../lib/tts-engine';
import type { LibraryItem } from '../lib/library-types';

// DOM Elements
const statusIndicator = document.getElementById('status-indicator')!;
const progressSection = document.getElementById('progress-section')!;
const progressPercent = document.getElementById('progress-percent')!;
const progressFill = document.getElementById('progress-fill')!;
const progressFile = document.getElementById('progress-file')!;
const mainSection = document.getElementById('main-section')!;
const textInput = document.getElementById('text-input') as HTMLTextAreaElement;
const voiceSelect = document.getElementById('voice-select') as HTMLSelectElement;
const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const message = document.getElementById('message')!;
const errorSection = document.getElementById('error-section')!;
const errorMessage = document.getElementById('error-message')!;
const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;

// New playback control elements
const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
const speedValue = document.getElementById('speed-value')!;
const progressIndicator = document.getElementById('progress-indicator')!;
const sentenceProgress = document.getElementById('sentence-progress')!;
const sentenceFill = document.getElementById('sentence-fill')!;
const skipBackBtn = document.getElementById('skip-back-btn') as HTMLButtonElement;
const skipForwardBtn = document.getElementById('skip-forward-btn') as HTMLButtonElement;

// Extraction elements
const readPageBtn = document.getElementById('read-page-btn') as HTMLButtonElement;
const readSelectionBtn = document.getElementById('read-selection-btn') as HTMLButtonElement;
const extractionStatus = document.getElementById('extraction-status')!;
const extractionSource = document.getElementById('extraction-source')!;
const clearExtractionBtn = document.getElementById('clear-extraction-btn') as HTMLButtonElement;

// File import elements
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const importFileBtn = document.getElementById('import-file-btn') as HTMLButtonElement;
const fileSizeWarning = document.getElementById('file-size-warning')!;
const fileSizeMessage = document.getElementById('file-size-message')!;
const fileCancelBtn = document.getElementById('file-cancel-btn') as HTMLButtonElement;
const fileContinueBtn = document.getElementById('file-continue-btn') as HTMLButtonElement;
const importProgress = document.getElementById('import-progress')!;
const importFilename = document.getElementById('import-filename')!;
const cancelImportBtn = document.getElementById('cancel-import-btn') as HTMLButtonElement;
const importProgressFill = document.getElementById('import-progress-fill')!;
const importProgressText = document.getElementById('import-progress-text')!;
const importStatus = document.getElementById('import-status')!;
const importSource = document.getElementById('import-source')!;
const clearImportBtn = document.getElementById('clear-import-btn') as HTMLButtonElement;

// Show player button (restores dismissed floating player)
const showPlayerBtn = document.getElementById('show-player-btn') as HTMLButtonElement;

// Save to Library buttons
const saveToLibraryBtn = document.getElementById('save-to-library-btn') as HTMLButtonElement;
const saveImportToLibraryBtn = document.getElementById('save-import-to-library-btn') as HTMLButtonElement;

// Recent Items elements
const recentSection = document.getElementById('recent-section')!;
const recentList = document.getElementById('recent-list')!;
const viewAllBtn = document.getElementById('view-all-btn') as HTMLButtonElement;

// Library Panel elements
const librarySection = document.getElementById('library-section')!;
const libraryToggleBtn = document.getElementById('library-toggle-btn') as HTMLButtonElement;
const libraryBackBtn = document.getElementById('library-back-btn') as HTMLButtonElement;
const folderList = document.getElementById('folder-list')!;
const newFolderInput = document.getElementById('new-folder-input') as HTMLInputElement;
const createFolderBtn = document.getElementById('create-folder-btn') as HTMLButtonElement;
const libraryItemsList = document.getElementById('library-items-list')!;
const itemActions = document.getElementById('item-actions')!;
const moveToFolderSelect = document.getElementById('move-to-folder-select') as HTMLSelectElement;
const playItemBtn = document.getElementById('play-item-btn') as HTMLButtonElement;
const deleteItemBtn = document.getElementById('delete-item-btn') as HTMLButtonElement;

// Port for service worker communication (keeps SW alive during extraction)
let extractionPort: chrome.runtime.Port | null = null;

// State
let isInitialized = false;
let isPlaying = false;
let isGenerating = false;
let currentChunkIndex = 0;
let totalChunks = 0;
let playbackSpeed = 1.0;

// File import state
let pendingFile: File | null = null;
let currentExtractionId: string | null = null;

// Pending warning state (for extraction warnings like page count or text length)
let pendingWarning: PendingWarning | null = null;

// Library state
let isSavedToLibrary = false;
let savingToLibrary = false;
let currentDocumentUrl: string | null = null;
let currentDocumentTitle: string | null = null;
// Library context for autosave (Phase 7)
let currentLibraryItemId: string | null = null;
let currentLibraryContentHash: string | null = null;
let currentLibraryContentLength: number | null = null;

// Library panel state
let libraryPanelOpen = false;
let currentFolderId: string | null = null;  // null = 'All Items' (root)
let selectedItemId: string | null = null;
interface LibraryItemData {
  id: string;
  title: string;
  url: string;
  source: 'webpage' | 'pdf' | 'text';
  folderId: string | null;
  createdAt: number;
  lastReadAt: number;
  contentDeleted: boolean;
  contentSize: number;
}
interface FolderData {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}
let libraryItems: LibraryItemData[] = [];
let folders: FolderData[] = [];

/**
 * Check if Side Panel API is available
 * Per CONTEXT.md: Graceful fallback if API unavailable
 */
function isSidePanelAvailable(): boolean {
  return typeof chrome.sidePanel !== 'undefined';
}

/**
 * Apply theme from settings
 */
async function applyTheme() {
  const settings = await getSettings();
  const html = document.documentElement;

  if (settings.darkMode === 'dark') {
    html.classList.add('dark-mode');
    html.classList.remove('light-mode');
  } else if (settings.darkMode === 'light') {
    html.classList.remove('dark-mode');
    html.classList.add('light-mode');
  } else {
    // System preference
    html.classList.remove('dark-mode', 'light-mode');
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      html.classList.add('dark-mode');
    }
  }
}

/**
 * Create side panel button in header
 */
function addSidePanelButton() {
  // Only show if API is available
  if (!isSidePanelAvailable()) {
    console.log('Side Panel API not available, hiding button');
    return;
  }

  const headerActions = document.querySelector('.header-actions');
  if (!headerActions) {
    // Create header-actions if it doesn't exist
    const header = document.querySelector('header');
    if (!header) return;

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'header-actions';
    header.appendChild(actionsDiv);
  }

  const container = document.querySelector('.header-actions');
  if (!container) return;

  // Insert the side panel button at the beginning of header actions
  const btn = document.createElement('button');
  btn.id = 'open-sidepanel-btn';
  btn.className = 'icon-btn';
  btn.title = 'Open Library';
  btn.textContent = '\u2630'; // Hamburger menu icon

  btn.addEventListener('click', openSidePanel);

  // Insert at the beginning
  container.insertBefore(btn, container.firstChild);
}

/**
 * Open side panel
 */
async function openSidePanel() {
  try {
    await chrome.runtime.sendMessage({
      target: 'service-worker',
      type: 'open-side-panel'
    });
    // Close popup after opening side panel
    window.close();
  } catch (error) {
    console.error('Failed to open side panel:', error);
  }
}

/**
 * Initialize popup
 */
async function init() {
  console.log('Popup initializing...');

  // Apply theme from settings (Phase 8)
  await applyTheme();

  // Add side panel button if API available (Phase 8)
  addSidePanelButton();

  // Set up event listeners
  playBtn.addEventListener('click', handlePlay);
  pauseBtn.addEventListener('click', handlePauseResume);
  stopBtn.addEventListener('click', handleStop);
  retryBtn.addEventListener('click', handleRetry);
  voiceSelect.addEventListener('change', handleVoiceChange);
  textInput.addEventListener('input', updatePlayButtonState);
  speedSlider.addEventListener('input', handleSpeedChange);
  skipBackBtn.addEventListener('click', () => handleSkip(-1));
  skipForwardBtn.addEventListener('click', () => handleSkip(1));

  // Extraction button listeners
  readPageBtn.addEventListener('click', handleReadPage);
  readSelectionBtn.addEventListener('click', handleReadSelection);
  clearExtractionBtn.addEventListener('click', clearExtraction);

  // File import listeners
  importFileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);
  fileCancelBtn.addEventListener('click', cancelFileSizeWarning);
  fileContinueBtn.addEventListener('click', continueWithLargeFile);
  cancelImportBtn.addEventListener('click', handleCancelImport);
  clearImportBtn.addEventListener('click', clearImport);

  // Show player button listener
  showPlayerBtn.addEventListener('click', handleShowPlayer);

  // Save to Library button listeners
  saveToLibraryBtn.addEventListener('click', handleSaveToLibrary);
  saveImportToLibraryBtn.addEventListener('click', handleSaveToLibrary);

  // Recent items listeners
  viewAllBtn.addEventListener('click', toggleLibraryPanel);

  // Library panel listeners
  libraryToggleBtn.addEventListener('click', toggleLibraryPanel);
  libraryBackBtn.addEventListener('click', closeLibraryPanel);
  createFolderBtn.addEventListener('click', handleCreateFolder);
  newFolderInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleCreateFolder();
  });
  playItemBtn.addEventListener('click', handlePlayItem);
  deleteItemBtn.addEventListener('click', handleDeleteItem);
  moveToFolderSelect.addEventListener('change', handleMoveItem);

  // Load recent library items
  await loadRecentItems();

  // Check for pending extraction (from context menu OR popup that closed mid-extraction)
  await loadPendingExtraction();

  // Check for pending extraction warning (page count or text length)
  await checkPendingWarning();

  // Keyboard shortcuts (with focus guard)
  document.addEventListener('keydown', handleKeydown);

  // Listen for messages from service worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === MessageType.DOWNLOAD_PROGRESS) {
      showProgress(msg.progress);
    }
    if (msg.type === MessageType.GENERATION_COMPLETE) {
      handlePlaybackComplete();
    }
    // Handle playback status updates
    if (msg.type === MessageType.STATUS_UPDATE) {
      const status = msg.status;
      if (status.currentChunkIndex !== undefined && status.totalChunks !== undefined) {
        currentChunkIndex = status.currentChunkIndex;
        totalChunks = status.totalChunks;
        updateProgressUI();
      }
      if (status.isPlaying !== undefined) {
        isPlaying = status.isPlaying;
        updatePlayPauseUI();
      }
      if (status.isGenerating !== undefined) {
        isGenerating = status.isGenerating;
        updateGeneratingUI();
      }
    }
    // Handle audio errors (autoplay blocked, etc.)
    if (msg.type === MessageType.AUDIO_ERROR) {
      handlePlaybackComplete();
      showMessage(msg.error || 'Audio playback failed', 'error');
    }
    // Handle extraction progress
    if (msg.type === MessageType.EXTRACTION_PROGRESS) {
      if (msg.extractionId === currentExtractionId) {
        const basePercent = 50; // Upload is first 50%
        const extractionPercent = Math.round(msg.progress / 2); // Extraction is next 50%
        const totalPercent = basePercent + extractionPercent;
        importProgressFill.style.width = `${totalPercent}%`;
        importProgressText.textContent = msg.stage === 'uploading'
          ? 'Loading document...'
          : `Extracting... ${msg.progress}%`;
      }
    }
    // Handle extraction warning (page count or text length exceeded)
    if (msg.type === MessageType.EXTRACTION_WARNING) {
      showExtractionWarning(msg.warning);
    }
  });

  // Listen for theme changes (Phase 8)
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.settings) {
      applyTheme();
    }
  });

  // Check for existing download progress
  const existingProgress = await getDownloadProgress();
  if (existingProgress && existingProgress.percent < 100) {
    showProgress(existingProgress);
  }

  // Initialize TTS engine
  await initializeTTS();
}

/**
 * Initialize TTS engine
 */
async function initializeTTS() {
  setStatus('loading');
  showMessage('Initializing TTS engine...');

  try {
    const response = await sendToOffscreen<TTSResponse>(
      MessageType.TTS_INIT
    );

    if (!response.success) {
      throw new Error(response.error || 'Failed to initialize TTS');
    }

    // Load voices
    await loadVoices();

    // Restore selected voice
    const savedVoice = await getSelectedVoice();
    if (savedVoice) {
      voiceSelect.value = savedVoice;
    }

    // Restore saved speed setting
    const { playbackSpeed: savedSpeed } = await chrome.storage.local.get(['playbackSpeed']);
    if (typeof savedSpeed === 'number') {
      playbackSpeed = savedSpeed;
      speedSlider.value = String(savedSpeed);
      speedValue.textContent = `${savedSpeed}x`;
    }

    isInitialized = true;
    setStatus('ready');
    hideProgress();
    showMessage('Ready to speak!', 'success');
    updatePlayButtonState();
  } catch (error) {
    console.error('TTS initialization failed:', error);
    setStatus('error');
    showError(error instanceof Error ? error.message : 'Failed to initialize TTS engine');
  }
}

/**
 * Load available voices
 */
async function loadVoices() {
  try {
    const response = await sendToOffscreen<VoiceListResponse>(
      MessageType.TTS_LIST_VOICES
    );

    if (!response.success || !response.voices) {
      throw new Error(response.error || 'Failed to load voices');
    }

    // Clear existing options using DOM methods (safer than innerHTML)
    while (voiceSelect.firstChild) {
      voiceSelect.removeChild(voiceSelect.firstChild);
    }

    // Categorize voices by quality grade
    const gradeA = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky', 'am_adam', 'am_michael'];
    const voices = response.voices;

    // Sort voices: Grade A first, then alphabetically
    voices.sort((a, b) => {
      const aIsGradeA = gradeA.includes(a);
      const bIsGradeA = gradeA.includes(b);
      if (aIsGradeA && !bIsGradeA) return -1;
      if (!aIsGradeA && bIsGradeA) return 1;
      return a.localeCompare(b);
    });

    // Add options
    for (const voice of voices) {
      const option = document.createElement('option');
      option.value = voice;

      // Format voice name for display
      const displayName = formatVoiceName(voice);
      const isHighQuality = gradeA.includes(voice);
      option.textContent = isHighQuality ? `${displayName} (High Quality)` : displayName;

      voiceSelect.appendChild(option);
    }
  } catch (error) {
    console.error('Failed to load voices:', error);
    // Add default option using DOM methods
    while (voiceSelect.firstChild) {
      voiceSelect.removeChild(voiceSelect.firstChild);
    }
    const defaultOption = document.createElement('option');
    defaultOption.value = 'af_heart';
    defaultOption.textContent = 'Default Voice';
    voiceSelect.appendChild(defaultOption);
  }
}

/**
 * Format voice ID to display name
 */
function formatVoiceName(voiceId: string): string {
  // af_heart -> Heart (American Female)
  // am_michael -> Michael (American Male)
  // bf_emma -> Emma (British Female)
  const parts = voiceId.split('_');
  if (parts.length !== 2) return voiceId;

  const [prefix, name] = parts;
  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);

  const accents: Record<string, string> = {
    'a': 'American',
    'b': 'British'
  };

  const genders: Record<string, string> = {
    'f': 'Female',
    'm': 'Male'
  };

  const accent = accents[prefix[0]] || '';
  const gender = genders[prefix[1]] || '';

  if (accent && gender) {
    return `${capitalizedName} (${accent} ${gender})`;
  }

  return capitalizedName;
}

/**
 * Handle play button click
 * Sends TTS_GENERATE to service worker for orchestration (chunked playback)
 */
async function handlePlay() {
  const text = textInput.value.trim();
  if (!text || !isInitialized || isGenerating) return;

  isGenerating = true;
  playBtn.classList.add('loading');
  playBtn.disabled = true;
  stopBtn.disabled = false;
  showMessage('Generating speech...');

  try {
    // Send to service worker for orchestration (NOT directly to offscreen)
    // Service worker will: split into chunks, store in PlaybackState,
    // then forward TTS_GENERATE_CHUNK to offscreen and PLAY_AUDIO to content script
    const response = await sendToServiceWorker<TTSResponse>(
      MessageType.TTS_GENERATE,
      {
        text,
        voice: voiceSelect.value,
        // Include library context for autosave (Phase 7)
        libraryItemId: currentLibraryItemId || undefined,
        libraryContentHash: currentLibraryContentHash || undefined,
        libraryContentLength: currentLibraryContentLength || undefined
      }
    );

    if (!response.success) {
      throw new Error(response.error || 'Failed to generate speech');
    }

    // Playback state updates come via STATUS_UPDATE messages
    // So we don't set isPlaying here - wait for status update
  } catch (error) {
    console.error('TTS generation failed:', error);
    isGenerating = false;
    playBtn.classList.remove('loading');
    updatePlayButtonState();
    stopBtn.disabled = true;
    showMessage(error instanceof Error ? error.message : 'Failed to generate speech', 'error');
  }
}

/**
 * Handle stop button click
 */
async function handleStop() {
  try {
    await sendToServiceWorker<TTSResponse>(MessageType.STOP_PLAYBACK);
  } catch (error) {
    console.error('Failed to stop playback:', error);
  }

  handlePlaybackComplete();
}

/**
 * Handle playback completion
 */
function handlePlaybackComplete() {
  isPlaying = false;
  isGenerating = false;
  currentChunkIndex = 0;
  totalChunks = 0;
  playBtn.classList.remove('loading');
  playBtn.classList.remove('hidden');
  pauseBtn.classList.add('hidden');
  showPlayerBtn.classList.add('hidden'); // Hide "Show Player" when idle
  updatePlayButtonState();
  stopBtn.disabled = true;
  updateProgressUI();
  showMessage('Ready', 'success');
  // Clear library context (Phase 7)
  currentLibraryItemId = null;
  currentLibraryContentHash = null;
  currentLibraryContentLength = null;
}

/**
 * Handle retry button click
 */
async function handleRetry() {
  errorSection.classList.add('hidden');
  mainSection.classList.remove('hidden');
  await initializeTTS();
}

/**
 * Handle voice selection change
 */
async function handleVoiceChange() {
  const voice = voiceSelect.value as VoiceId;
  if (voice) {
    await setSelectedVoice(voice);
  }
}

/**
 * Update play button enabled state
 */
function updatePlayButtonState() {
  const hasText = textInput.value.trim().length > 0;
  playBtn.disabled = !isInitialized || !hasText || isGenerating;
}

/**
 * Set status indicator
 */
function setStatus(status: 'ready' | 'loading' | 'error') {
  statusIndicator.className = 'status-indicator ' + status;
}

/**
 * Show progress bar
 */
function showProgress(progress: { file: string; percent: number }) {
  progressSection.classList.remove('hidden');
  progressPercent.textContent = `${progress.percent}%`;
  progressFill.style.width = `${progress.percent}%`;

  // Show just the filename, not full path
  const filename = progress.file.split('/').pop() || progress.file;
  progressFile.textContent = filename;
}

/**
 * Hide progress bar
 */
function hideProgress() {
  progressSection.classList.add('hidden');
}

/**
 * Show message
 */
function showMessage(text: string, type?: 'success' | 'error') {
  message.textContent = text;
  message.className = 'message' + (type ? ` ${type}` : '');
}

/**
 * Show error state
 */
function showError(errorText: string) {
  mainSection.classList.add('hidden');
  errorSection.classList.remove('hidden');
  errorMessage.textContent = errorText;
}

/**
 * Handle speed slider change
 */
async function handleSpeedChange() {
  const speed = parseFloat(speedSlider.value);
  playbackSpeed = speed;
  speedValue.textContent = `${speed}x`;

  // Persist to storage
  await chrome.storage.local.set({ playbackSpeed: speed });

  // Send to service worker to update playback rate
  try {
    await sendToServiceWorker(MessageType.SET_SPEED, { speed });
  } catch (error) {
    console.error('Failed to set speed:', error);
  }
}

/**
 * Handle skip forward/back
 */
async function handleSkip(direction: -1 | 1) {
  const targetIndex = currentChunkIndex + direction;
  if (targetIndex < 0 || targetIndex >= totalChunks) return;

  try {
    // Send skip request to service worker
    await chrome.runtime.sendMessage({
      target: 'service-worker',
      type: MessageType.SKIP_TO_CHUNK,
      chunkIndex: targetIndex
    });
  } catch (error) {
    console.error('Failed to skip:', error);
  }
}

/**
 * Handle pause/resume toggle
 */
async function handlePauseResume() {
  try {
    if (isPlaying) {
      await sendToServiceWorker(MessageType.PAUSE_AUDIO);
      pauseBtn.textContent = 'Resume';
      isPlaying = false;
    } else {
      await sendToServiceWorker(MessageType.RESUME_AUDIO);
      pauseBtn.textContent = 'Pause';
      isPlaying = true;
    }
    updateProgressUI();
  } catch (error) {
    console.error('Failed to pause/resume:', error);
  }
}

/**
 * Handle keyboard shortcuts with focus guard
 */
function handleKeydown(e: KeyboardEvent) {
  // Focus guard: don't handle shortcuts when typing in textarea
  if (document.activeElement === textInput) {
    return;
  }

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (isInitialized) {
        if (isPlaying || pauseBtn.textContent === 'Resume') {
          handlePauseResume();
        } else if (!isGenerating && textInput.value.trim()) {
          handlePlay();
        }
      }
      break;

    case 'ArrowLeft':
      e.preventDefault();
      if (!skipBackBtn.disabled) handleSkip(-1);
      break;

    case 'ArrowRight':
      e.preventDefault();
      if (!skipForwardBtn.disabled) handleSkip(1);
      break;

    case 'Equal': // + key
    case 'NumpadAdd':
      e.preventDefault();
      adjustSpeed(0.25);
      break;

    case 'Minus':
    case 'NumpadSubtract':
      e.preventDefault();
      adjustSpeed(-0.25);
      break;
  }
}

/**
 * Adjust speed by delta
 */
function adjustSpeed(delta: number) {
  const newSpeed = Math.max(0.5, Math.min(4, playbackSpeed + delta));
  speedSlider.value = String(newSpeed);
  handleSpeedChange();
}

/**
 * Update progress indicator UI
 */
function updateProgressUI() {
  if (totalChunks > 0) {
    progressIndicator.classList.remove('hidden');
    sentenceProgress.textContent = `Sentence ${currentChunkIndex + 1} of ${totalChunks}`;
    const percent = ((currentChunkIndex + 1) / totalChunks) * 100;
    sentenceFill.style.width = `${percent}%`;

    // Enable/disable skip buttons based on position and playing state
    skipBackBtn.disabled = currentChunkIndex <= 0 || (!isPlaying && pauseBtn.textContent !== 'Resume');
    skipForwardBtn.disabled = currentChunkIndex >= totalChunks - 1 || (!isPlaying && pauseBtn.textContent !== 'Resume');
  } else {
    progressIndicator.classList.add('hidden');
    skipBackBtn.disabled = true;
    skipForwardBtn.disabled = true;
  }
}

/**
 * Update play/pause button UI
 */
function updatePlayPauseUI() {
  const hasActivePlayback = isPlaying || (totalChunks > 0 && currentChunkIndex < totalChunks);

  if (isPlaying) {
    playBtn.classList.add('hidden');
    pauseBtn.classList.remove('hidden');
    pauseBtn.disabled = false;
    pauseBtn.textContent = 'Pause';
    stopBtn.disabled = false;
  } else if (totalChunks > 0 && currentChunkIndex < totalChunks) {
    // Paused state (has active playback)
    playBtn.classList.add('hidden');
    pauseBtn.classList.remove('hidden');
    pauseBtn.disabled = false;
    pauseBtn.textContent = 'Resume';
    stopBtn.disabled = false;
  } else {
    // Idle state
    playBtn.classList.remove('hidden');
    pauseBtn.classList.add('hidden');
    updatePlayButtonState();
  }

  // Show "Show Player" button when playback is active (playing or paused)
  // User may have dismissed the floating player and want to restore it
  if (hasActivePlayback) {
    showPlayerBtn.classList.remove('hidden');
  } else {
    showPlayerBtn.classList.add('hidden');
  }

  updateProgressUI();
}

/**
 * Update generating UI state
 */
function updateGeneratingUI() {
  if (isGenerating) {
    playBtn.classList.add('loading');
    showMessage('Generating speech...');
  } else {
    playBtn.classList.remove('loading');
  }
}

/**
 * Send message to service worker
 */
async function sendToServiceWorker<T>(
  type: string,
  payload?: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { target: 'service-worker', type, ...payload },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      }
    );
  });
}

/**
 * Send message to offscreen document via service worker
 *
 * IMPORTANT: Messages are sent to 'service-worker' which then routes them to the offscreen
 * document. This prevents duplicate handling that would occur if we sent directly with
 * target: 'offscreen' (since both service worker and offscreen listen to runtime.onMessage).
 */
async function sendToOffscreen<T>(
  type: string,
  payload?: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { target: 'service-worker', forwardTo: 'offscreen', type, ...payload },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      }
    );
  });
}

/**
 * Handle "Show Player" button - restores dismissed floating player.
 * Sends SHOW_FLOATING_PLAYER message to content script.
 */
async function handleShowPlayer() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, {
        target: 'content-script',
        type: MessageType.SHOW_FLOATING_PLAYER
      });
    }
  } catch {
    // Content script might not be ready - silently ignore
  }
}

/**
 * Handle Save to Library button click.
 * Saves current extracted content to the library.
 */
async function handleSaveToLibrary() {
  const text = textInput.value.trim();
  if (!text || savingToLibrary) return;

  savingToLibrary = true;
  updateSaveButtonState();

  try {
    // Determine source based on which section is visible
    let source: 'webpage' | 'pdf' | 'text' = 'webpage';
    if (!importStatus.classList.contains('hidden')) {
      // Import status visible - it's a document
      const filename = importSource.textContent || '';
      source = filename.toLowerCase().endsWith('.pdf') ? 'pdf' : 'text';
    }

    const response = await sendToServiceWorker<SaveToLibraryResponse>(
      MessageType.SAVE_TO_LIBRARY,
      {
        item: {
          title: currentDocumentTitle || 'Untitled',
          url: currentDocumentUrl || '',
          source,
          content: text
        }
      }
    );

    if (response.success) {
      isSavedToLibrary = true;
      if (response.alreadyExists) {
        showMessage('Already in library', 'success');
      } else {
        showMessage('Saved to library!', 'success');
      }
      updateSaveButtonState();
    } else {
      showMessage(response.error || 'Failed to save', 'error');
    }
  } catch (error) {
    console.error('Save to library failed:', error);
    showMessage('Failed to save to library', 'error');
  } finally {
    savingToLibrary = false;
    updateSaveButtonState();
  }
}

/**
 * Update Save to Library button states based on current state.
 */
function updateSaveButtonState() {
  const text = savingToLibrary ? 'Saving...' : isSavedToLibrary ? 'Saved' : 'Save';
  const disabled = savingToLibrary || isSavedToLibrary;

  saveToLibraryBtn.textContent = text;
  saveToLibraryBtn.disabled = disabled;
  saveImportToLibraryBtn.textContent = text;
  saveImportToLibraryBtn.disabled = disabled;
}

/**
 * Check if URL is already saved in library.
 */
async function checkLibraryStatus(url: string) {
  if (!url) {
    isSavedToLibrary = false;
    updateSaveButtonState();
    return;
  }

  try {
    const response = await sendToServiceWorker<{ success: boolean; isSaved: boolean; itemId?: string }>(
      MessageType.GET_LIBRARY_STATUS,
      { url }
    );

    if (response.success) {
      isSavedToLibrary = response.isSaved;
      updateSaveButtonState();
    }
  } catch (error) {
    console.error('Failed to check library status:', error);
  }
}

/**
 * Handle "Read This Page" button - extract article content
 */
async function handleReadPage() {
  await triggerExtraction(MessageType.EXTRACT_ARTICLE);
}

/**
 * Handle "Read Selection" button - extract selected text
 */
async function handleReadSelection() {
  await triggerExtraction(MessageType.EXTRACT_SELECTION);
}

/**
 * Trigger extraction via service worker port connection.
 *
 * Flow per CONTEXT.md:
 * 1. Popup establishes port to service worker via chrome.runtime.connect()
 * 2. SW forwards extraction request to content script via tabs.sendMessage
 * 3. Content script returns result via sendResponse
 * 4. SW relays result back to popup over port
 * 5. If popup closes mid-extraction, SW stores result in session storage
 */
async function triggerExtraction(messageType: string) {
  // Disable buttons during extraction
  readPageBtn.disabled = true;
  readSelectionBtn.disabled = true;
  readPageBtn.classList.add('loading');
  readSelectionBtn.classList.add('loading');
  showMessage('Extracting content...');

  try {
    // Get active tab ID to include in request
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('No active tab');
    }

    // Establish port connection to service worker
    // This keeps SW alive for the duration of the extraction
    extractionPort = chrome.runtime.connect({ name: 'extraction' });

    // Wait for result via port message
    const result = await new Promise<ExtractionResult>((resolve, reject) => {
      if (!extractionPort) {
        reject(new Error('Port not connected'));
        return;
      }

      // Handle response from service worker
      extractionPort.onMessage.addListener((message) => {
        if (message.type === 'EXTRACTION_RESPONSE') {
          resolve(message.result as ExtractionResult);
        }
      });

      // Handle port disconnect (SW crashed or similar)
      extractionPort.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        }
      });

      // Send extraction request over port
      extractionPort.postMessage({
        type: messageType,
        tabId: tab.id
      });

      // Timeout after 15s (content script has 10s internal timeout)
      setTimeout(() => {
        reject(new Error('Extraction timed out'));
      }, 15000);
    });

    if (!result.success) {
      throw new Error(result.error || 'Extraction failed');
    }

    // Show extracted content
    showExtractedContent(result);

  } catch (error) {
    console.error('Extraction failed:', error);
    showMessage(error instanceof Error ? error.message : 'Extraction failed', 'error');
  } finally {
    // Clean up port
    if (extractionPort) {
      extractionPort.disconnect();
      extractionPort = null;
    }
    readPageBtn.disabled = false;
    readSelectionBtn.disabled = false;
    readPageBtn.classList.remove('loading');
    readSelectionBtn.classList.remove('loading');
  }
}

/**
 * Pending extraction stored in session storage
 */
interface PendingExtraction {
  text: string;
  title?: string;
  url?: string;
  source: 'selection' | 'article';
  timestamp: number;
}

/**
 * Load any pending extraction from session storage.
 * This handles two cases:
 * 1. Context menu extraction completed while popup was closed
 * 2. Popup closed mid-extraction and SW stored the result
 */
async function loadPendingExtraction() {
  try {
    const result = await chrome.storage.session.get('pendingExtraction');
    const pendingExtraction = result.pendingExtraction as PendingExtraction | undefined;

    if (pendingExtraction && pendingExtraction.text) {
      // Check if it's recent (within last 5 minutes)
      const fiveMinutes = 5 * 60 * 1000;
      if (Date.now() - pendingExtraction.timestamp < fiveMinutes) {
        showExtractedContent({
          success: true,
          text: pendingExtraction.text,
          title: pendingExtraction.title,
          url: pendingExtraction.url,
          source: pendingExtraction.source
        });
        // Clear pending after loading
        await chrome.storage.session.remove('pendingExtraction');
      }
    }
  } catch (error) {
    console.error('Failed to load pending extraction:', error);
  }
}

/**
 * Check for pending warning when popup opens.
 * Per CONTEXT.md Decision #6: Popup surfaces pending warnings.
 */
async function checkPendingWarning() {
  try {
    const result = await sendToServiceWorker<{ warning: PendingWarning | null }>(
      MessageType.GET_PENDING_WARNING
    );

    if (result.warning) {
      showExtractionWarning(result.warning);
    }
  } catch {
    // Service worker might not be ready
  }
}

/**
 * Show extraction warning dialog.
 * Reuses the file size warning dialog for consistency.
 */
function showExtractionWarning(warning: PendingWarning) {
  let warningMessage: string;
  switch (warning.type) {
    case 'pageCount':
      warningMessage = `This PDF has ${warning.value} pages (threshold: ${warning.threshold}). Processing may be slow.`;
      break;
    case 'textLength':
      warningMessage = `Extracted text is ${warning.value.toLocaleString()} characters (threshold: ${warning.threshold.toLocaleString()}). This is a lot of content to process.`;
      break;
    default:
      warningMessage = 'This file exceeds recommended limits.';
  }

  // Reuse the file size warning dialog
  fileSizeMessage.textContent = warningMessage;
  fileSizeWarning.classList.remove('hidden');

  // Store warning for response
  pendingWarning = warning;
}

/**
 * Display extracted content in the UI
 */
function showExtractedContent(result: ExtractionResult) {
  if (!result.text) return;

  // Store document info for library save
  currentDocumentUrl = result.url || null;
  currentDocumentTitle = result.title || null;

  // Reset library state for new extraction
  isSavedToLibrary = false;
  updateSaveButtonState();

  // Populate text input with extracted content
  textInput.value = result.text;
  updatePlayButtonState();

  // Show extraction status
  const sourceLabel = result.source === 'article'
    ? `Article: ${result.title || 'Untitled'}`
    : `Selection from: ${result.title || 'Page'}`;

  extractionSource.textContent = sourceLabel;
  extractionSource.title = result.url || '';
  extractionStatus.classList.remove('hidden');

  // Check if already in library
  if (result.url) {
    checkLibraryStatus(result.url);
  }

  showMessage('Content extracted! Click Play to listen.', 'success');
}

/**
 * Clear extraction and reset UI
 */
function clearExtraction() {
  textInput.value = '';
  extractionStatus.classList.add('hidden');
  currentDocumentUrl = null;
  currentDocumentTitle = null;
  isSavedToLibrary = false;
  updateSaveButtonState();
  updatePlayButtonState();
  showMessage('Ready', 'success');
}

// ============================================================================
// File Import Functions
// ============================================================================

/**
 * Handle file selection from input.
 * Per CONTEXT.md Decision #6: Check file.size BEFORE file.arrayBuffer()
 */
async function handleFileSelect() {
  const file = fileInput.files?.[0];
  if (!file) return;

  // Reset input for re-selection of same file
  fileInput.value = '';

  // Validate file type
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext || !['pdf', 'txt', 'md'].includes(ext)) {
    showMessage('Unsupported file type. Please select PDF, TXT, or MD file.', 'error');
    return;
  }

  // Check file size BEFORE reading into memory
  if (file.size > EXTRACTION_THRESHOLDS.FILE_SIZE_BYTES) {
    // Show warning dialog
    pendingFile = file;
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    fileSizeMessage.textContent = `This file is ${sizeMB} MB. Processing may be slow and could fail.`;
    fileSizeWarning.classList.remove('hidden');
    return;
  }

  // Proceed with import
  await startFileImport(file);
}

/**
 * Cancel file size warning (user chose not to proceed).
 * Handles both file size and extraction warnings.
 */
async function cancelFileSizeWarning() {
  // Handle extraction warning (page count or text length)
  if (pendingWarning) {
    await sendToServiceWorker(MessageType.WARNING_RESPONSE, {
      extractionId: pendingWarning.extractionId,
      action: 'cancel'
    }).catch(() => {});
    pendingWarning = null;
    fileSizeWarning.classList.add('hidden');
    showMessage('Extraction cancelled', 'error');
    return;
  }

  // Handle file size warning
  pendingFile = null;
  fileSizeWarning.classList.add('hidden');
}

/**
 * Continue with large file after warning.
 * Handles both file size and extraction warnings.
 */
async function continueWithLargeFile() {
  // Handle extraction warning (page count or text length)
  if (pendingWarning) {
    const warning = pendingWarning;
    pendingWarning = null;
    fileSizeWarning.classList.add('hidden');

    // Send continue response to service worker
    const result = await sendToServiceWorker<DocumentExtractionResult>(
      MessageType.WARNING_RESPONSE,
      {
        extractionId: warning.extractionId,
        action: 'continue'
      }
    );

    // Handle the extraction result
    if (result.success && result.text) {
      handleExtractionResult(result, result.title || 'Document');
    } else if (!result.success) {
      showMessage(result.error || 'Extraction failed', 'error');
    }
    // If no result yet (for page count warning), extraction continues
    // and will send result when complete
    return;
  }

  // Handle file size warning
  if (!pendingFile) return;

  const file = pendingFile;
  pendingFile = null;
  fileSizeWarning.classList.add('hidden');

  await startFileImport(file);
}

/**
 * Start file import process.
 * Per CONTEXT.md Decision #2: Different strategies for small vs large files.
 */
async function startFileImport(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase() as DocumentType;
  const extractionId = generateExtractionId();
  currentExtractionId = extractionId;

  // Show progress UI
  importFilename.textContent = file.name;
  importProgressFill.style.width = '0%';
  importProgressText.textContent = 'Reading file...';
  importProgress.classList.remove('hidden');
  importFileBtn.disabled = true;

  try {
    if (needsChunkedUpload(file.size)) {
      // Large file: chunked upload per CONTEXT.md
      await uploadFileChunked(file, ext, extractionId);
    } else {
      // Small file: direct send
      await uploadFileDirect(file, ext, extractionId);
    }
  } catch (error) {
    console.error('File import failed:', error);
    showMessage(error instanceof Error ? error.message : 'File import failed', 'error');
    hideImportProgress();
  }
}

/**
 * Upload small file directly (< 10 MB).
 */
async function uploadFileDirect(file: File, documentType: DocumentType, extractionId: string) {
  importProgressText.textContent = 'Reading file...';
  importProgressFill.style.width = '10%';

  const data = await file.arrayBuffer();

  // Check for cancellation
  if (currentExtractionId !== extractionId) return;

  importProgressText.textContent = 'Extracting text...';
  importProgressFill.style.width = '50%';

  // Send to service worker
  const result = await sendToServiceWorker<DocumentExtractionResult>(
    MessageType.EXTRACT_DOCUMENT,
    {
      documentType,
      data,
      filename: file.name,
      fileSize: file.size,
      extractionId
    }
  );

  handleExtractionResult(result, file.name);
}

/**
 * Upload large file in chunks (> 10 MB).
 * Per CONTEXT.md Decision #2: Streamed chunking with file.slice()
 */
async function uploadFileChunked(file: File, documentType: DocumentType, extractionId: string) {
  const chunkSize = EXTRACTION_THRESHOLDS.CHUNK_SIZE_BYTES;
  const totalChunksCount = calculateChunkCount(file.size);

  // Send initial message with null data
  await sendToServiceWorker(MessageType.EXTRACT_DOCUMENT, {
    documentType,
    data: null,
    filename: file.name,
    fileSize: file.size,
    extractionId
  });

  // Send chunks one at a time
  for (let i = 0; i < totalChunksCount; i++) {
    // Check for cancellation
    if (currentExtractionId !== extractionId) return;

    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const slice = file.slice(start, end);
    const data = await slice.arrayBuffer();

    // Update progress
    const percent = Math.round(((i + 1) / totalChunksCount) * 50); // 50% for upload
    importProgressFill.style.width = `${percent}%`;
    importProgressText.textContent = `Uploading... ${i + 1}/${totalChunksCount}`;

    // Send chunk
    await sendToServiceWorker(MessageType.DOCUMENT_CHUNK, {
      extractionId,
      chunkIndex: i,
      totalChunks: totalChunksCount,
      data
    });
  }

  // Signal upload complete
  importProgressText.textContent = 'Extracting text...';
  importProgressFill.style.width = '50%';

  const result = await sendToServiceWorker<DocumentExtractionResult>(
    MessageType.DOCUMENT_CHUNK_COMPLETE,
    { extractionId }
  );

  handleExtractionResult(result, file.name);
}

/**
 * Handle extraction result from service worker.
 */
function handleExtractionResult(result: DocumentExtractionResult, filename: string) {
  hideImportProgress();

  if (!result.success) {
    showMessage(result.error || 'Extraction failed', 'error');
    return;
  }

  // Store document info for library save
  currentDocumentUrl = null; // No URL for imported files
  currentDocumentTitle = filename;

  // Reset library state for new import
  isSavedToLibrary = false;
  updateSaveButtonState();

  // Populate text input
  if (result.text) {
    textInput.value = result.text;
    updatePlayButtonState();
  }

  // Show import status
  const label = result.pageCount
    ? `${filename} (${result.pageCount} pages, ${result.textLength?.toLocaleString()} chars)`
    : `${filename} (${result.textLength?.toLocaleString()} chars)`;
  importSource.textContent = label;
  importStatus.classList.remove('hidden');

  showMessage('Document imported! Click Play to listen.', 'success');
}

/**
 * Handle cancel import button.
 */
async function handleCancelImport() {
  if (currentExtractionId) {
    await sendToServiceWorker(MessageType.CANCEL_EXTRACTION, {
      extractionId: currentExtractionId
    }).catch(() => {});
    currentExtractionId = null;
  }
  hideImportProgress();
}

/**
 * Clear imported document.
 */
function clearImport() {
  textInput.value = '';
  importStatus.classList.add('hidden');
  currentDocumentUrl = null;
  currentDocumentTitle = null;
  isSavedToLibrary = false;
  updateSaveButtonState();
  updatePlayButtonState();
  showMessage('Ready', 'success');
}

/**
 * Hide import progress UI and re-enable button.
 */
function hideImportProgress() {
  importProgress.classList.add('hidden');
  importFileBtn.disabled = false;
  currentExtractionId = null;
}

// ============================================================================
// Recent Items Functions
// ============================================================================

/**
 * Load recent items from library.
 */
async function loadRecentItems() {
  try {
    const response = await sendToServiceWorker<{ success: boolean; items: LibraryItem[] }>(
      MessageType.GET_RECENT_ITEMS,
      { limit: 5 }
    );

    if (!response.success || !response.items || response.items.length === 0) {
      recentSection.classList.add('hidden');
      return;
    }

    recentSection.classList.remove('hidden');
    renderRecentItems(response.items);
  } catch (error) {
    console.error('Failed to load recent items:', error);
    recentSection.classList.add('hidden');
  }
}

/**
 * Render recent items list using safe DOM methods.
 */
function renderRecentItems(items: LibraryItem[]) {
  // Clear list safely
  while (recentList.firstChild) {
    recentList.removeChild(recentList.firstChild);
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'recent-item';
    if (item.contentDeleted) {
      li.classList.add('content-deleted');
    }

    const progress = calculateItemProgress(item);

    // Build inner content using safe DOM methods
    const content = document.createElement('div');
    content.className = 'recent-item-content';

    const title = document.createElement('div');
    title.className = 'recent-item-title';
    title.textContent = item.title;
    title.title = item.title;
    content.appendChild(title);

    const source = document.createElement('div');
    source.className = 'recent-item-source';
    source.textContent = item.source;
    content.appendChild(source);

    li.appendChild(content);

    // Add progress indicator if available
    if (progress !== null) {
      const progressDiv = document.createElement('div');
      progressDiv.className = 'recent-item-progress';

      const ring = document.createElement('div');
      ring.className = 'progress-ring';

      const circle = document.createElement('div');
      circle.className = 'progress-ring-circle';
      circle.style.setProperty('--progress', `${progress}%`);
      ring.appendChild(circle);
      progressDiv.appendChild(ring);

      const progressText = document.createElement('span');
      progressText.className = 'progress-text';
      progressText.textContent = `${progress}%`;
      progressDiv.appendChild(progressText);

      li.appendChild(progressDiv);
    }

    // Add deleted badge if content was deleted
    if (item.contentDeleted) {
      const badge = document.createElement('span');
      badge.className = 'deleted-badge';
      badge.textContent = 'Re-extract';
      li.appendChild(badge);
    }

    // Click handler - play if not deleted
    if (!item.contentDeleted) {
      li.addEventListener('click', () => playRecentItem(item.id));
    }

    recentList.appendChild(li);
  }
}

/**
 * Calculate reading progress percentage for a library item.
 */
function calculateItemProgress(item: LibraryItem): number | null {
  if (!item.resumeData) return null;

  const { contentLength, charOffset } = item.resumeData;
  if (contentLength && charOffset) {
    return Math.round((charOffset / contentLength) * 100);
  }
  return null;
}

/**
 * Play a recent library item.
 */
async function playRecentItem(itemId: string) {
  try {
    const response = await sendToServiceWorker<{
      success: boolean;
      error?: string;
      item: LibraryItem;
      content: string;
      contentHash?: string;
      startChunkIndex?: number;
    }>(MessageType.PLAY_LIBRARY_ITEM, { itemId });

    if (!response.success) {
      showMessage(response.error || 'Failed to load item', 'error');
      return;
    }

    // Update document info
    currentDocumentUrl = response.item.url;
    currentDocumentTitle = response.item.title;
    isSavedToLibrary = true; // It's from library
    updateSaveButtonState();

    // Set library context for autosave (Phase 7)
    currentLibraryItemId = itemId;
    currentLibraryContentHash = response.contentHash || response.item.contentHash;
    currentLibraryContentLength = response.content.length;

    // Populate text input
    textInput.value = response.content;
    updatePlayButtonState();

    // Show extraction status
    extractionSource.textContent = `Library: ${response.item.title}`;
    extractionSource.title = response.item.url || '';
    extractionStatus.classList.remove('hidden');

    // Start playback if we have content
    if (response.content && isInitialized) {
      // If there's a resume position, we could skip to that chunk
      // For now, just auto-play from the beginning/resume position
      showMessage(`Playing: ${response.item.title}`, 'success');
      handlePlay();
    }
  } catch (error) {
    console.error('Failed to play recent item:', error);
    showMessage('Failed to play item', 'error');
  }
}

// ============================================================================
// Library Panel Functions
// ============================================================================

/**
 * Toggle library panel open/closed.
 */
async function toggleLibraryPanel() {
  if (libraryPanelOpen) {
    closeLibraryPanel();
  } else {
    await openLibraryPanel();
  }
}

/**
 * Open library panel and load data.
 */
async function openLibraryPanel() {
  libraryPanelOpen = true;
  mainSection.classList.add('hidden');
  recentSection.classList.add('hidden');
  librarySection.classList.remove('hidden');

  // Load folders and items
  await loadFolders();
  await loadLibraryItems();

  // Select 'All Items' by default
  currentFolderId = null;
  updateFolderSelection();
}

/**
 * Close library panel and return to main view.
 */
function closeLibraryPanel() {
  libraryPanelOpen = false;
  librarySection.classList.add('hidden');
  mainSection.classList.remove('hidden');

  // Reload recent items (may have changed)
  loadRecentItems();

  // Clear selection
  selectedItemId = null;
  itemActions.classList.add('hidden');
}

/**
 * Load folders from service worker.
 */
async function loadFolders() {
  try {
    const response = await sendToServiceWorker<{ success: boolean; folders: FolderData[] }>(
      MessageType.FOLDER_LIST
    );

    if (response.success) {
      folders = response.folders;
      renderFolders();
      updateMoveToFolderSelect();
    }
  } catch (error) {
    console.error('Failed to load folders:', error);
  }
}

/**
 * Load library items, optionally filtered by folder.
 */
async function loadLibraryItems() {
  try {
    const response = await sendToServiceWorker<{ success: boolean; items: LibraryItemData[] }>(
      MessageType.GET_LIBRARY_ITEMS,
      { folderId: currentFolderId }
    );

    if (response.success) {
      libraryItems = response.items;
      renderLibraryItems();
    }
  } catch (error) {
    console.error('Failed to load library items:', error);
  }
}

/**
 * Render folder list.
 */
function renderFolders() {
  // Clear existing folders (except 'All Items')
  while (folderList.firstChild) {
    folderList.removeChild(folderList.firstChild);
  }

  for (const folder of folders) {
    const folderEl = document.createElement('div');
    folderEl.className = 'folder-item';
    folderEl.dataset.folderId = folder.id;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'folder-icon';
    iconSpan.textContent = '\u{1F4C1}'; // folder icon

    const nameSpan = document.createElement('span');
    nameSpan.className = 'folder-name';
    nameSpan.textContent = folder.name;

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'folder-actions-inline';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'folder-action-btn';
    renameBtn.textContent = '\u{270F}'; // pencil
    renameBtn.title = 'Rename';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRenameFolder(folder.id, folder.name);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'folder-action-btn';
    deleteBtn.textContent = '\u{2716}'; // X
    deleteBtn.title = 'Delete folder';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteFolder(folder.id);
    });

    actionsDiv.appendChild(renameBtn);
    actionsDiv.appendChild(deleteBtn);

    folderEl.appendChild(iconSpan);
    folderEl.appendChild(nameSpan);
    folderEl.appendChild(actionsDiv);

    folderEl.addEventListener('click', () => selectFolder(folder.id));
    folderList.appendChild(folderEl);
  }
}

/**
 * Select a folder and load its items.
 */
async function selectFolder(folderId: string | null) {
  currentFolderId = folderId;
  selectedItemId = null;
  itemActions.classList.add('hidden');
  updateFolderSelection();
  await loadLibraryItems();
}

/**
 * Update folder selection UI.
 */
function updateFolderSelection() {
  // Update 'All Items' folder
  const allItemsEl = document.querySelector('.folder-item[data-folder-id="root"]');
  if (allItemsEl) {
    if (currentFolderId === null) {
      allItemsEl.classList.add('active');
    } else {
      allItemsEl.classList.remove('active');
    }

    // Add click handler for 'All Items' (only once)
    if (!(allItemsEl as HTMLElement).dataset.listenerAttached) {
      allItemsEl.addEventListener('click', () => selectFolder(null));
      (allItemsEl as HTMLElement).dataset.listenerAttached = 'true';
    }
  }

  // Update other folders
  const folderEls = folderList.querySelectorAll('.folder-item');
  folderEls.forEach((el) => {
    const fId = (el as HTMLElement).dataset.folderId;
    if (fId === currentFolderId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}

/**
 * Render library items list.
 */
function renderLibraryItems() {
  // Clear existing items
  while (libraryItemsList.firstChild) {
    libraryItemsList.removeChild(libraryItemsList.firstChild);
  }

  if (libraryItems.length === 0) {
    const emptyState = document.createElement('p');
    emptyState.className = 'empty-state';
    emptyState.textContent = currentFolderId ? 'No items in this folder' : 'No items saved yet';
    libraryItemsList.appendChild(emptyState);
    return;
  }

  for (const item of libraryItems) {
    const itemEl = document.createElement('div');
    itemEl.className = 'library-item';
    if (item.contentDeleted) {
      itemEl.classList.add('library-item-deleted');
    }
    if (item.id === selectedItemId) {
      itemEl.classList.add('selected');
    }
    itemEl.dataset.itemId = item.id;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'library-item-icon';
    iconSpan.textContent = item.source === 'pdf' ? '\u{1F4C4}' : item.source === 'text' ? '\u{1F4DD}' : '\u{1F310}';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'library-item-info';

    const titleSpan = document.createElement('div');
    titleSpan.className = 'library-item-title';
    titleSpan.textContent = item.title || 'Untitled';

    const metaSpan = document.createElement('div');
    metaSpan.className = 'library-item-meta';
    const date = new Date(item.lastReadAt);
    const sizeKb = Math.round(item.contentSize / 1024);
    metaSpan.textContent = `${date.toLocaleDateString()} | ${sizeKb} KB`;

    infoDiv.appendChild(titleSpan);
    infoDiv.appendChild(metaSpan);

    itemEl.appendChild(iconSpan);
    itemEl.appendChild(infoDiv);

    itemEl.addEventListener('click', () => selectItem(item.id));
    libraryItemsList.appendChild(itemEl);
  }
}

/**
 * Select an item and show actions.
 */
function selectItem(itemId: string) {
  selectedItemId = itemId;

  // Update item selection UI
  const itemEls = libraryItemsList.querySelectorAll('.library-item');
  itemEls.forEach((el) => {
    if ((el as HTMLElement).dataset.itemId === itemId) {
      el.classList.add('selected');
    } else {
      el.classList.remove('selected');
    }
  });

  // Show item actions
  itemActions.classList.remove('hidden');

  // Update move to folder select
  const item = libraryItems.find((i) => i.id === itemId);
  if (item) {
    moveToFolderSelect.value = item.folderId || '';
  }
}

/**
 * Update move-to-folder select options.
 */
function updateMoveToFolderSelect() {
  // Clear existing options (except first placeholder)
  while (moveToFolderSelect.options.length > 1) {
    moveToFolderSelect.remove(1);
  }

  // Add root option
  const rootOption = document.createElement('option');
  rootOption.value = '';
  rootOption.textContent = 'Root (no folder)';
  moveToFolderSelect.appendChild(rootOption);

  // Add folders
  for (const folder of folders) {
    const option = document.createElement('option');
    option.value = folder.id;
    option.textContent = folder.name;
    moveToFolderSelect.appendChild(option);
  }
}

/**
 * Handle create folder button click.
 */
async function handleCreateFolder() {
  const name = newFolderInput.value.trim();
  if (!name) return;

  try {
    const response = await sendToServiceWorker<{ success: boolean; folder: FolderData }>(
      MessageType.FOLDER_CREATE,
      { name }
    );

    if (response.success) {
      newFolderInput.value = '';
      await loadFolders();
    }
  } catch (error) {
    console.error('Failed to create folder:', error);
    showMessage('Failed to create folder', 'error');
  }
}

/**
 * Handle rename folder.
 */
async function handleRenameFolder(folderId: string, currentName: string) {
  const newName = prompt('Enter new folder name:', currentName);
  if (!newName || newName.trim() === currentName) return;

  try {
    await sendToServiceWorker(MessageType.FOLDER_RENAME, {
      folderId,
      name: newName.trim()
    });
    await loadFolders();
  } catch (error) {
    console.error('Failed to rename folder:', error);
    showMessage('Failed to rename folder', 'error');
  }
}

/**
 * Handle delete folder.
 */
async function handleDeleteFolder(folderId: string) {
  if (!confirm('Delete this folder? Items will be moved to root.')) return;

  try {
    await sendToServiceWorker(MessageType.FOLDER_DELETE, { folderId });

    // If we were viewing this folder, switch to All Items
    if (currentFolderId === folderId) {
      currentFolderId = null;
      updateFolderSelection();
    }

    await loadFolders();
    await loadLibraryItems();
  } catch (error) {
    console.error('Failed to delete folder:', error);
    showMessage('Failed to delete folder', 'error');
  }
}

/**
 * Handle play item button click.
 */
async function handlePlayItem() {
  if (!selectedItemId) return;

  const item = libraryItems.find((i) => i.id === selectedItemId);
  if (!item) return;

  if (item.contentDeleted) {
    showMessage('Content was removed. Re-extract from original page.', 'error');
    return;
  }

  try {
    const response = await sendToServiceWorker<{
      success: boolean;
      content?: string;
      item?: LibraryItemData;
      error?: string;
    }>(MessageType.PLAY_LIBRARY_ITEM, { itemId: selectedItemId });

    if (!response.success) {
      showMessage(response.error || 'Failed to load item', 'error');
      return;
    }

    // Close library panel and load content into text input
    closeLibraryPanel();

    if (response.content) {
      textInput.value = response.content;
      currentDocumentTitle = item.title;
      currentDocumentUrl = item.url;
      isSavedToLibrary = true;
      updateSaveButtonState();
      updatePlayButtonState();
      showMessage('Item loaded! Click Play to listen.', 'success');
    }
  } catch (error) {
    console.error('Failed to play item:', error);
    showMessage('Failed to load item', 'error');
  }
}

/**
 * Handle delete item button click.
 */
async function handleDeleteItem() {
  if (!selectedItemId) return;

  if (!confirm('Delete this item from library?')) return;

  try {
    await sendToServiceWorker(MessageType.DELETE_LIBRARY_ITEM, {
      itemId: selectedItemId,
      deleteContent: false // Full delete
    });

    selectedItemId = null;
    itemActions.classList.add('hidden');
    await loadLibraryItems();
    showMessage('Item deleted', 'success');
  } catch (error) {
    console.error('Failed to delete item:', error);
    showMessage('Failed to delete item', 'error');
  }
}

/**
 * Handle move item to folder.
 */
async function handleMoveItem() {
  if (!selectedItemId) return;

  const folderId = moveToFolderSelect.value || null;

  try {
    await sendToServiceWorker(MessageType.ITEM_MOVE_TO_FOLDER, {
      itemId: selectedItemId,
      folderId
    });

    // Reload items to reflect new folder assignment
    await loadLibraryItems();
    showMessage('Item moved', 'success');
  } catch (error) {
    console.error('Failed to move item:', error);
    showMessage('Failed to move item', 'error');
  }
}

// Initialize on load
init();
