import { MessageType, type TTSResponse, type VoiceListResponse } from '../lib/messages';
import { getSelectedVoice, setSelectedVoice } from '../lib/voice-storage';
import { getDownloadProgress } from '../lib/model-cache';

// DOM Elements
const statusIndicator = document.getElementById('status-indicator')!;
const progressSection = document.getElementById('progress-section')!;
const progressPercent = document.getElementById('progress-percent')!;
const progressFill = document.getElementById('progress-fill')!;
const progressFile = document.getElementById('progress-file')!;
const mainSection = document.getElementById('main-section')!;
const textInput = document.getElementById('text-input') as HTMLTextAreaElement;
const voiceSelect = document.getElementById('voice-select') as HTMLSelectElement;
const playBtn = document.getElementById('play-btn')!;
const stopBtn = document.getElementById('stop-btn')!;
const message = document.getElementById('message')!;
const errorSection = document.getElementById('error-section')!;
const errorMessage = document.getElementById('error-message')!;
const retryBtn = document.getElementById('retry-btn')!;

// State
let isInitialized = false;
let isPlaying = false;
let isGenerating = false;

/**
 * Initialize popup
 */
async function init() {
  console.log('Popup initializing...');

  // Set up event listeners
  playBtn.addEventListener('click', handlePlay);
  stopBtn.addEventListener('click', handleStop);
  retryBtn.addEventListener('click', handleRetry);
  voiceSelect.addEventListener('change', handleVoiceChange);
  textInput.addEventListener('input', updatePlayButtonState);

  // Listen for messages from service worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === MessageType.DOWNLOAD_PROGRESS) {
      showProgress(msg.progress);
    }
    if (msg.type === MessageType.GENERATION_COMPLETE) {
      handlePlaybackComplete();
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
    const response = await sendToOffscreen<TTSResponse>(
      MessageType.TTS_GENERATE,
      { text, voice: voiceSelect.value }
    );

    if (!response.success) {
      throw new Error(response.error || 'Failed to generate speech');
    }

    isPlaying = true;
    isGenerating = false;
    playBtn.classList.remove('loading');
    showMessage('Playing...', 'success');
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
    await sendToOffscreen<TTSResponse>(MessageType.TTS_STOP);
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
  playBtn.classList.remove('loading');
  updatePlayButtonState();
  stopBtn.disabled = true;
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
  const voice = voiceSelect.value;
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

// Initialize on load
init();
