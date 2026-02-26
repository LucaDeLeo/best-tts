// Side Panel entry point for Best TTS
// Per CONTEXT.md: Full library view and settings interface

import { getSettings, updateSettings, type Settings } from '../lib/settings-storage';
import { VOICE_IDS, type VoiceId } from '../lib/tts-engine';
import { MessageType } from '../lib/messages';
import { formatVoiceName, GRADE_A_VOICES, formatVoiceDisplayName } from '../lib/voice-storage';
import { sendToServiceWorker } from '../lib/messaging';
import type { MlxServerStatus } from '../lib/mlx-audio-client';
import type { LibraryItem } from '../lib/library-types';
import {
  renderLibraryList,
  renderFolderList,
  createFolderSelect,
  type FolderData,
} from '../lib/ui/library-list';

// Side panel loaded

// State
let currentSettings: Settings | null = null;

// Audio state for voice preview
let previewAudio: HTMLAudioElement | null = null;

// Library state
let folders: FolderData[] = [];
let libraryItems: LibraryItem[] = [];
let currentFolderId: string | null = null;
let selectedItemId: string | null = null;

// DOM Elements
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const themeToggleBtn = document.getElementById('theme-toggle-btn') as HTMLButtonElement;

/**
 * Initialize side panel
 */
async function init() {
  // Set up tab navigation
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')!));
  });

  // Set up theme toggle
  themeToggleBtn.addEventListener('click', toggleTheme);

  // Load saved theme preference
  await loadThemePreference();

  // Load initial tab content
  await loadLibraryTab();

}

/**
 * Switch between tabs
 */
function switchTab(tabId: string) {
  // Update button states
  tabButtons.forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update content visibility
  tabContents.forEach(content => {
    if (content.id === `${tabId}-tab`) {
      content.classList.remove('hidden');
      content.classList.add('active');
    } else {
      content.classList.add('hidden');
      content.classList.remove('active');
    }
  });

  // Load tab content if needed
  if (tabId === 'library') {
    loadLibraryTab();
  } else if (tabId === 'settings') {
    loadSettingsTab();
  }
}

/**
 * Toggle theme between light and dark
 */
async function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark-mode');
  const darkMode = isDark ? 'dark' : 'light';

  // Persist preference using settings storage
  await updateSettings({ darkMode });
}

/**
 * Load saved theme preference from settings
 */
async function loadThemePreference() {
  const settings = await getSettings();
  applyTheme(settings.darkMode);
}

/**
 * Apply theme based on preference
 */
function applyTheme(darkMode: 'system' | 'light' | 'dark') {
  const html = document.documentElement;

  if (darkMode === 'dark') {
    html.classList.add('dark-mode');
    html.classList.remove('light-mode');
  } else if (darkMode === 'light') {
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
 * Load library tab content
 */
async function loadLibraryTab() {
  const libraryTab = document.getElementById('library-tab');
  if (!libraryTab) return;

  // Clear existing content safely
  while (libraryTab.firstChild) {
    libraryTab.removeChild(libraryTab.firstChild);
  }

  // Create layout structure
  const layout = document.createElement('div');
  layout.className = 'library-layout';

  // Sidebar with folders
  const sidebar = document.createElement('div');
  sidebar.className = 'library-sidebar';

  const foldersContainer = document.createElement('div');
  foldersContainer.id = 'folders-container';
  foldersContainer.className = 'folders-list';
  sidebar.appendChild(foldersContainer);

  // New folder input
  const newFolderRow = document.createElement('div');
  newFolderRow.className = 'new-folder-row';

  const newFolderInput = document.createElement('input');
  newFolderInput.type = 'text';
  newFolderInput.id = 'new-folder-input';
  newFolderInput.placeholder = 'New folder name';
  newFolderInput.className = 'folder-input';
  newFolderRow.appendChild(newFolderInput);

  const createFolderBtn = document.createElement('button');
  createFolderBtn.className = 'btn btn-primary small';
  createFolderBtn.textContent = 'Add';
  createFolderBtn.addEventListener('click', handleCreateFolder);
  newFolderRow.appendChild(createFolderBtn);

  newFolderInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleCreateFolder();
  });

  sidebar.appendChild(newFolderRow);
  layout.appendChild(sidebar);

  // Main content with items
  const main = document.createElement('div');
  main.className = 'library-main';

  const itemsContainer = document.createElement('div');
  itemsContainer.id = 'items-container';
  itemsContainer.className = 'items-list';
  main.appendChild(itemsContainer);

  // Item actions bar (hidden by default)
  const actionsBar = document.createElement('div');
  actionsBar.id = 'item-actions-bar';
  actionsBar.className = 'item-actions-bar hidden';
  main.appendChild(actionsBar);

  layout.appendChild(main);
  libraryTab.appendChild(layout);

  // Load data
  await loadFolders();
  await loadLibraryItems();
}

/**
 * Load folders from service worker
 */
async function loadFolders() {
  try {
    const response = await sendToServiceWorker<{ success: boolean; folders: FolderData[] }>(
      MessageType.FOLDER_LIST
    );
    if (response.success) {
      folders = response.folders;
      renderFolders();
    }
  } catch (error) {
    console.error('Failed to load folders:', error);
  }
}

/**
 * Render folders in sidebar
 */
function renderFolders() {
  const container = document.getElementById('folders-container');
  if (!container) return;

  renderFolderList(container, folders, currentFolderId, {
    onFolderSelect: selectFolder,
    onFolderRename: handleRenameFolder,
    onFolderDelete: handleDeleteFolder,
  });
}

/**
 * Load library items for current folder
 */
async function loadLibraryItems() {
  try {
    const response = await sendToServiceWorker<{ success: boolean; items: LibraryItem[] }>(
      MessageType.GET_LIBRARY_ITEMS,
      { folderId: currentFolderId }
    );
    if (response.success) {
      libraryItems = response.items;
      renderItems();
    }
  } catch (error) {
    console.error('Failed to load library items:', error);
  }
}

/**
 * Render library items
 */
function renderItems() {
  const container = document.getElementById('items-container');
  if (!container) return;

  renderLibraryList(container, libraryItems, selectedItemId, {
    onItemClick: selectItem,
    onItemDelete: handleDeleteItem,
    onItemMove: handleMoveItem,
  });
}

/**
 * Select a folder
 */
async function selectFolder(folderId: string | null) {
  currentFolderId = folderId;
  selectedItemId = null;
  hideItemActions();
  renderFolders();
  await loadLibraryItems();
}

/**
 * Select a library item
 */
function selectItem(itemId: string) {
  selectedItemId = itemId;
  renderItems();
  showItemActions(itemId);
}

/**
 * Show item actions bar
 */
function showItemActions(itemId: string) {
  const bar = document.getElementById('item-actions-bar');
  if (!bar) return;

  const item = libraryItems.find(i => i.id === itemId);
  if (!item) return;

  // Clear and rebuild
  while (bar.firstChild) {
    bar.removeChild(bar.firstChild);
  }

  // Move to folder dropdown
  const moveLabel = document.createElement('label');
  moveLabel.textContent = 'Move to: ';
  bar.appendChild(moveLabel);

  const folderSelect = createFolderSelect(folders, item.folderId, (folderId) => {
    handleMoveItem(itemId, folderId);
  });
  bar.appendChild(folderSelect);

  // Play button
  const playBtn = document.createElement('button');
  playBtn.className = 'btn btn-primary small';
  playBtn.textContent = 'Play';
  playBtn.disabled = item.contentDeleted;
  playBtn.addEventListener('click', () => handlePlayItem(itemId));
  bar.appendChild(playBtn);

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-secondary small';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => handleDeleteItem(itemId));
  bar.appendChild(deleteBtn);

  bar.classList.remove('hidden');
}

/**
 * Hide item actions bar
 */
function hideItemActions() {
  const bar = document.getElementById('item-actions-bar');
  if (bar) {
    bar.classList.add('hidden');
  }
}

// Folder handlers
async function handleCreateFolder() {
  const input = document.getElementById('new-folder-input') as HTMLInputElement;
  const name = input.value.trim();
  if (!name) return;

  try {
    await sendToServiceWorker(MessageType.FOLDER_CREATE, { name });
    input.value = '';
    await loadFolders();
  } catch (error) {
    console.error('Failed to create folder:', error);
  }
}

async function handleRenameFolder(folderId: string, currentName: string) {
  // TODO: Replace prompt() with custom modal for better UX
  const newName = prompt('Enter new folder name:', currentName);
  if (!newName || newName.trim() === currentName) return;

  try {
    await sendToServiceWorker(MessageType.FOLDER_RENAME, { folderId, name: newName.trim() });
    await loadFolders();
  } catch (error) {
    console.error('Failed to rename folder:', error);
  }
}

async function handleDeleteFolder(folderId: string) {
  // TODO: Replace confirm() with custom modal for better UX
  if (!confirm('Delete this folder? Items will be moved to root.')) return;

  try {
    await sendToServiceWorker(MessageType.FOLDER_DELETE, { folderId });
    if (currentFolderId === folderId) {
      currentFolderId = null;
    }
    await loadFolders();
    await loadLibraryItems();
  } catch (error) {
    console.error('Failed to delete folder:', error);
  }
}

// Item handlers
async function handlePlayItem(itemId: string) {
  try {
    const response = await sendToServiceWorker<{
      success: boolean;
      item: LibraryItem;
      content: string;
      contentHash?: string;
      startChunkIndex?: number;
      error?: string;
    }>(MessageType.PLAY_LIBRARY_ITEM, { itemId });

    if (!response.success) {
      showStatusMessage(response.error || 'Failed to play item', 'error');
      return;
    }

    // Store as pending extraction so popup picks it up, then start TTS
    // via service worker's TTS_GENERATE which handles chunking + playback
    const ttsResponse = await sendToServiceWorker<{ success: boolean; error?: string }>(
      MessageType.TTS_GENERATE,
      {
        text: response.content,
        voice: currentSettings?.voice || 'af_heart',
        libraryItemId: itemId,
        libraryContentHash: response.contentHash || '',
        libraryContentLength: response.content.length,
        startChunkIndex: response.startChunkIndex
      }
    );

    if (!ttsResponse.success) {
      showStatusMessage(ttsResponse.error || 'Failed to start playback', 'error');
      return;
    }

    showStatusMessage(`Playing: ${response.item.title}`, 'success');
  } catch (error) {
    console.error('Failed to play item:', error);
    showStatusMessage('Failed to play item', 'error');
  }
}

/**
 * Show a temporary status message in the library tab
 */
function showStatusMessage(text: string, type: 'success' | 'error') {
  const existing = document.getElementById('library-status-msg');
  if (existing) existing.remove();

  const msg = document.createElement('div');
  msg.id = 'library-status-msg';
  msg.className = `library-status ${type}`;
  msg.textContent = text;

  const libraryTab = document.getElementById('library-tab');
  if (libraryTab) {
    libraryTab.insertBefore(msg, libraryTab.firstChild);
    setTimeout(() => msg.remove(), 3000);
  }
}

async function handleDeleteItem(itemId: string) {
  // TODO: Replace confirm() with custom modal for better UX
  if (!confirm('Delete this item from library?')) return;

  try {
    await sendToServiceWorker(MessageType.DELETE_LIBRARY_ITEM, { itemId });
    selectedItemId = null;
    hideItemActions();
    await loadLibraryItems();
  } catch (error) {
    console.error('Failed to delete item:', error);
  }
}

async function handleMoveItem(itemId: string, folderId: string | null) {
  try {
    await sendToServiceWorker(MessageType.ITEM_MOVE_TO_FOLDER, { itemId, folderId });
    await loadLibraryItems();
  } catch (error) {
    console.error('Failed to move item:', error);
  }
}

/**
 * Load settings tab content
 */
async function loadSettingsTab() {
  const settingsTab = document.getElementById('settings-tab');
  if (!settingsTab) return;

  // Clear existing content safely
  while (settingsTab.firstChild) {
    settingsTab.removeChild(settingsTab.firstChild);
  }

  // Load current settings
  currentSettings = await getSettings();

  // ── Engine section ──────────────────────────────────────
  const engineSection = createSettingsSection('Engine', 'Choose your TTS engine');

  const engineSelect = document.createElement('select');
  engineSelect.id = 'engine-select';
  engineSelect.className = 'settings-select';

  const engineOptions = [
    { value: 'kokoro', label: 'Kokoro (local, zero setup)' },
    { value: 'mlx-audio', label: 'mlx-audio (local server)' },
  ];

  for (const opt of engineOptions) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === currentSettings.engine) option.selected = true;
    engineSelect.appendChild(option);
  }

  engineSection.appendChild(engineSelect);

  // mlx-audio controls container (shown/hidden based on engine)
  const mlxControls = document.createElement('div');
  mlxControls.id = 'mlx-controls';
  mlxControls.className = currentSettings.engine === 'mlx-audio' ? '' : 'hidden';

  // Server status row
  const statusRow = document.createElement('div');
  statusRow.className = 'mlx-status-row';

  const statusDot = document.createElement('span');
  statusDot.id = 'mlx-status-dot';
  statusDot.className = 'status-dot checking';

  const statusText = document.createElement('span');
  statusText.id = 'mlx-status-text';
  statusText.className = 'mlx-status-text';
  statusText.textContent = 'Checking...';

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn btn-secondary small';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.addEventListener('click', refreshMlxStatus);

  statusRow.appendChild(statusDot);
  statusRow.appendChild(statusText);
  statusRow.appendChild(refreshBtn);
  mlxControls.appendChild(statusRow);

  // Server URL input
  const urlLabel = document.createElement('label');
  urlLabel.className = 'settings-label';
  urlLabel.textContent = 'Server URL';
  mlxControls.appendChild(urlLabel);

  const urlInput = document.createElement('input');
  urlInput.id = 'mlx-url-input';
  urlInput.type = 'text';
  urlInput.className = 'settings-input';
  urlInput.value = currentSettings.mlxAudioUrl;
  urlInput.placeholder = 'http://localhost:8000';

  let urlDebounce: ReturnType<typeof setTimeout>;
  urlInput.addEventListener('input', () => {
    clearTimeout(urlDebounce);
    urlDebounce = setTimeout(async () => {
      await updateSettings({ mlxAudioUrl: urlInput.value.trim() });
      refreshMlxStatus();
    }, 600);
  });
  mlxControls.appendChild(urlInput);

  // Model select
  const modelLabel = document.createElement('label');
  modelLabel.className = 'settings-label';
  modelLabel.textContent = 'Model';
  mlxControls.appendChild(modelLabel);

  const modelSelect = document.createElement('select');
  modelSelect.id = 'mlx-model-select';
  modelSelect.className = 'settings-select';
  mlxControls.appendChild(modelSelect);

  modelSelect.addEventListener('change', async () => {
    await updateSettings({ mlxAudioModel: modelSelect.value });
    // Refresh voice list for selected model
    await refreshVoiceDropdown();
  });

  engineSection.appendChild(mlxControls);
  settingsTab.appendChild(engineSection);

  engineSelect.addEventListener('change', async () => {
    const engine = engineSelect.value as Settings['engine'];
    await updateSettings({ engine });
    currentSettings = await getSettings();

    if (engine === 'mlx-audio') {
      mlxControls.classList.remove('hidden');
      refreshMlxStatus();
    } else {
      mlxControls.classList.add('hidden');
    }
    refreshVoiceDropdown();
  });

  // ── Voice section ───────────────────────────────────────
  const voiceSection = createSettingsSection('Voice', 'Select the voice for text-to-speech');

  const voiceSelect = document.createElement('select');
  voiceSelect.id = 'voice-select';
  voiceSelect.className = 'settings-select';
  voiceSection.appendChild(voiceSelect);

  // Voice preview button
  const previewBtn = document.createElement('button');
  previewBtn.id = 'voice-preview-btn';
  previewBtn.className = 'btn btn-secondary small';
  previewBtn.textContent = 'Preview Voice';
  previewBtn.style.marginTop = '8px';
  previewBtn.addEventListener('click', handleVoicePreview);
  voiceSection.appendChild(previewBtn);

  settingsTab.appendChild(voiceSection);

  // Populate voice dropdown for current engine
  await refreshVoiceDropdown();

  // If mlx-audio is selected, trigger initial status check
  if (currentSettings.engine === 'mlx-audio') {
    refreshMlxStatus();
  }

  // ── Speed section ───────────────────────────────────────
  const speedSection = createSettingsSection('Playback Speed', 'Adjust the reading speed');

  const speedRow = document.createElement('div');
  speedRow.className = 'settings-row';

  const speedSlider = document.createElement('input');
  speedSlider.type = 'range';
  speedSlider.id = 'speed-slider';
  speedSlider.min = '0.5';
  speedSlider.max = '4';
  speedSlider.step = '0.25';
  speedSlider.value = String(currentSettings.speed);
  speedSlider.className = 'settings-slider';

  const speedValue = document.createElement('span');
  speedValue.id = 'speed-value';
  speedValue.className = 'settings-value';
  speedValue.textContent = `${currentSettings.speed}x`;

  speedSlider.addEventListener('input', async () => {
    const speed = parseFloat(speedSlider.value);
    speedValue.textContent = `${speed}x`;
    await updateSettings({ speed });
  });

  speedRow.appendChild(speedSlider);
  speedRow.appendChild(speedValue);
  speedSection.appendChild(speedRow);
  settingsTab.appendChild(speedSection);

  // ── Theme section ───────────────────────────────────────
  const themeSection = createSettingsSection('Theme', 'Choose your preferred color scheme');

  const themeSelect = document.createElement('select');
  themeSelect.id = 'theme-select';
  themeSelect.className = 'settings-select';

  const themeOptions = [
    { value: 'system', label: 'System (follow OS)' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  for (const opt of themeOptions) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === currentSettings.darkMode) {
      option.selected = true;
    }
    themeSelect.appendChild(option);
  }

  themeSelect.addEventListener('change', async () => {
    const darkMode = themeSelect.value as 'system' | 'light' | 'dark';
    await updateSettings({ darkMode });
    applyTheme(darkMode);
  });

  themeSection.appendChild(themeSelect);
  settingsTab.appendChild(themeSection);

  // ── Keyboard shortcuts section ──────────────────────────
  const shortcutsSection = createSettingsSection(
    'Keyboard Shortcuts',
    'Shortcuts for controlling playback'
  );

  const shortcutsList = document.createElement('div');
  shortcutsList.className = 'shortcuts-list';

  const shortcuts = [
    { key: 'Space', action: 'Play/Pause' },
    { key: 'ArrowLeft', action: 'Skip Back' },
    { key: 'ArrowRight', action: 'Skip Forward' },
    { key: '+ / -', action: 'Speed Up/Down' },
    { key: 'Escape', action: 'Dismiss Player' },
  ];

  for (const shortcut of shortcuts) {
    const row = document.createElement('div');
    row.className = 'shortcut-row';

    const key = document.createElement('kbd');
    key.className = 'shortcut-key';
    key.textContent = shortcut.key;
    row.appendChild(key);

    const action = document.createElement('span');
    action.className = 'shortcut-action';
    action.textContent = shortcut.action;
    row.appendChild(action);

    shortcutsList.appendChild(row);
  }

  shortcutsSection.appendChild(shortcutsList);

  // Link to Chrome shortcuts manager
  const shortcutsNote = document.createElement('p');
  shortcutsNote.className = 'settings-note';
  shortcutsNote.textContent = 'Global shortcuts can be configured in ';

  const shortcutsLink = document.createElement('a');
  shortcutsLink.href = '#';
  shortcutsLink.textContent = 'Chrome Extension Shortcuts';
  shortcutsLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
  shortcutsNote.appendChild(shortcutsLink);

  shortcutsSection.appendChild(shortcutsNote);
  settingsTab.appendChild(shortcutsSection);

  // ── About section ───────────────────────────────────────
  const aboutSection = createSettingsSection('About', '');
  const version = document.createElement('p');
  version.className = 'about-text';
  version.textContent = `Best TTS v${chrome.runtime.getManifest().version}`;
  aboutSection.appendChild(version);

  const description = document.createElement('p');
  description.className = 'about-text muted';
  description.textContent = 'High-quality local TTS that works offline.';
  aboutSection.appendChild(description);

  settingsTab.appendChild(aboutSection);
}

/**
 * Handle voice selection change — routes to correct setting based on engine
 */
async function handleVoiceSelectChange() {
  const voiceSelect = document.getElementById('voice-select') as HTMLSelectElement;
  if (!voiceSelect) return;

  const settings = currentSettings || await getSettings();
  if (settings.engine === 'mlx-audio') {
    await updateSettings({ mlxAudioVoice: voiceSelect.value });
  } else {
    await updateSettings({ voice: voiceSelect.value as VoiceId });
  }
}

// Track whether voice select listener is attached
let voiceSelectListenerAttached = false;

/**
 * Refresh the voice dropdown based on current engine
 */
async function refreshVoiceDropdown() {
  const voiceSelect = document.getElementById('voice-select') as HTMLSelectElement;
  if (!voiceSelect) return;

  // Attach change handler once
  if (!voiceSelectListenerAttached) {
    voiceSelect.addEventListener('change', handleVoiceSelectChange);
    voiceSelectListenerAttached = true;
  }

  // Clear existing options
  while (voiceSelect.firstChild) {
    voiceSelect.removeChild(voiceSelect.firstChild);
  }

  const settings = currentSettings || await getSettings();

  if (settings.engine === 'mlx-audio') {
    // Get voices for current mlx-audio model
    const model = settings.mlxAudioModel;
    if (!model) {
      const placeholder = document.createElement('option');
      placeholder.textContent = 'Select a model first';
      placeholder.disabled = true;
      placeholder.selected = true;
      voiceSelect.appendChild(placeholder);
      return;
    }

    const response = await sendToServiceWorker<{ success: boolean; voices: string[] }>(
      MessageType.MLX_LIST_VOICES,
      { model }
    );

    if (response.success && response.voices) {
      for (const voiceId of response.voices) {
        const option = document.createElement('option');
        option.value = voiceId;
        option.textContent = formatVoiceDisplayName(voiceId, 'mlx-audio');
        if (voiceId === settings.mlxAudioVoice) option.selected = true;
        voiceSelect.appendChild(option);
      }
    }
  } else {
    // Kokoro voices - Grade A first
    const sortedVoices = [...VOICE_IDS].sort((a, b) => {
      const aIsA = GRADE_A_VOICES.includes(a);
      const bIsA = GRADE_A_VOICES.includes(b);
      if (aIsA && !bIsA) return -1;
      if (!aIsA && bIsA) return 1;
      return a.localeCompare(b);
    });

    for (const voiceId of sortedVoices) {
      const option = document.createElement('option');
      option.value = voiceId;
      option.textContent = formatVoiceName(voiceId, GRADE_A_VOICES.includes(voiceId));
      if (voiceId === settings.voice) option.selected = true;
      voiceSelect.appendChild(option);
    }
  }
}

/**
 * Refresh mlx-audio server status, populate model dropdown
 */
async function refreshMlxStatus() {
  const dot = document.getElementById('mlx-status-dot');
  const text = document.getElementById('mlx-status-text');
  const modelSelect = document.getElementById('mlx-model-select') as HTMLSelectElement;

  if (dot) { dot.className = 'status-dot checking'; }
  if (text) { text.textContent = 'Checking...'; }

  try {
    const response = await sendToServiceWorker<{
      success: boolean;
      online: boolean;
      models: string[];
      error?: string;
    }>(MessageType.MLX_SERVER_STATUS);

    if (response.online) {
      if (dot) dot.className = 'status-dot connected';
      if (text) text.textContent = `Connected (${response.models.length} model${response.models.length !== 1 ? 's' : ''})`;

      // Populate model dropdown
      if (modelSelect) {
        while (modelSelect.firstChild) {
          modelSelect.removeChild(modelSelect.firstChild);
        }

        const settings = currentSettings || await getSettings();
        for (const modelId of response.models) {
          const option = document.createElement('option');
          option.value = modelId;
          option.textContent = modelId;
          if (modelId === settings.mlxAudioModel) option.selected = true;
          modelSelect.appendChild(option);
        }

        // Auto-select first model if none set
        if (!settings.mlxAudioModel && response.models.length > 0) {
          modelSelect.value = response.models[0];
          await updateSettings({ mlxAudioModel: response.models[0] });
          currentSettings = await getSettings();
        }
      }

      // Refresh voice dropdown with model-appropriate voices
      await refreshVoiceDropdown();
    } else {
      if (dot) dot.className = 'status-dot disconnected';
      if (text) text.textContent = response.error || 'Server not running';
    }
  } catch (error) {
    if (dot) dot.className = 'status-dot disconnected';
    if (text) text.textContent = 'Failed to check server';
  }
}

/**
 * Create a settings section with title and description
 */
function createSettingsSection(title: string, description: string): HTMLElement {
  const section = document.createElement('div');
  section.className = 'settings-section';

  const heading = document.createElement('h3');
  heading.className = 'settings-title';
  heading.textContent = title;
  section.appendChild(heading);

  if (description) {
    const desc = document.createElement('p');
    desc.className = 'settings-description';
    desc.textContent = description;
    section.appendChild(desc);
  }

  return section;
}

/**
 * Stop any playing preview audio
 * Per CONTEXT.md: Cancel previous preview before starting new one
 */
function stopPreviewAudio() {
  if (previewAudio) {
    previewAudio.pause();
    const currentSrc = previewAudio.src;
    previewAudio.src = '';
    // Revoke the object URL to free memory
    if (currentSrc.startsWith('blob:')) {
      URL.revokeObjectURL(currentSrc);
    }
    previewAudio = null;
  }
}

/**
 * Handle voice preview button click
 * Per CONTEXT.md Decision #5: Play preview directly in side panel
 */
async function handleVoicePreview() {
  const voiceSelect = document.getElementById('voice-select') as HTMLSelectElement;
  const previewBtn = document.getElementById('voice-preview-btn') as HTMLButtonElement;

  if (!voiceSelect || !previewBtn) return;

  // Cancel any existing preview per CONTEXT.md
  stopPreviewAudio();

  previewBtn.disabled = true;
  previewBtn.textContent = 'Generating...';

  try {
    // Request preview from service worker
    const response = await sendToServiceWorker<{
      success: boolean;
      audioData?: string;
      audioMimeType?: string;
      error?: string;
    }>(MessageType.VOICE_PREVIEW, { voice: voiceSelect.value });

    if (!response.success || !response.audioData) {
      throw new Error(response.error || 'No audio data received');
    }

    // Convert base64 to blob
    const binaryString = atob(response.audioData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: response.audioMimeType || 'audio/wav' });

    // Create audio element and play
    const audioUrl = URL.createObjectURL(blob);
    previewAudio = new Audio(audioUrl);

    // Update button state during playback
    previewBtn.textContent = 'Playing...';

    previewAudio.addEventListener('ended', () => {
      stopPreviewAudio();
      previewBtn.disabled = false;
      previewBtn.textContent = 'Preview Voice';
    });

    previewAudio.addEventListener('error', () => {
      console.error('Preview audio playback error');
      stopPreviewAudio();
      previewBtn.disabled = false;
      previewBtn.textContent = 'Preview Voice';
    });

    await previewAudio.play();
  } catch (error) {
    console.error('Voice preview failed:', error);
    previewBtn.disabled = false;
    previewBtn.textContent = 'Preview Voice';

    // Show error to user
    const errorMsg = error instanceof Error ? error.message : 'Preview failed';
    alert(`Could not preview voice: ${errorMsg}`);
  }
}

// Initialize when DOM ready
init();
