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
} from '../lib/messages';
import { getSelectedVoice, setSelectedVoice } from '../lib/voice-storage';
import { getDownloadProgress } from '../lib/model-cache';
import type { VoiceId } from '../lib/tts-engine';

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

/**
 * Initialize popup
 */
async function init() {
  console.log('Popup initializing...');

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

  // Check for pending extraction (from context menu OR popup that closed mid-extraction)
  await loadPendingExtraction();

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
      { text, voice: voiceSelect.value }
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
 * Display extracted content in the UI
 */
function showExtractedContent(result: ExtractionResult) {
  if (!result.text) return;

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

  showMessage('Content extracted! Click Play to listen.', 'success');
}

/**
 * Clear extraction and reset UI
 */
function clearExtraction() {
  textInput.value = '';
  extractionStatus.classList.add('hidden');
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
 */
function cancelFileSizeWarning() {
  pendingFile = null;
  fileSizeWarning.classList.add('hidden');
}

/**
 * Continue with large file after warning.
 */
async function continueWithLargeFile() {
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

// Initialize on load
init();
