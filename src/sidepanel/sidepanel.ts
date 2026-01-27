// Side Panel entry point for Best TTS
// Per CONTEXT.md: Full library view and settings interface

import { getSettings, updateSettings, type Settings } from '../lib/settings-storage';
import { VOICE_IDS, type VoiceId } from '../lib/tts-engine';

console.log('Side panel loaded');

// State
let currentSettings: Settings | null = null;

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

  console.log('Side panel initialized');
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
 * Load library tab content (placeholder for 08-04)
 * Uses safe DOM manipulation (createElement/appendChild)
 */
async function loadLibraryTab() {
  const libraryTab = document.getElementById('library-tab');
  if (!libraryTab) return;

  // Clear existing content safely
  while (libraryTab.firstChild) {
    libraryTab.removeChild(libraryTab.firstChild);
  }

  // Placeholder - will be populated in 08-04
  const placeholder = document.createElement('p');
  placeholder.className = 'placeholder';
  placeholder.textContent = 'Library content will load here';
  libraryTab.appendChild(placeholder);
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

  // Voice selection section
  const voiceSection = createSettingsSection('Voice', 'Select the voice for text-to-speech');

  const voiceSelect = document.createElement('select');
  voiceSelect.id = 'voice-select';
  voiceSelect.className = 'settings-select';

  // Populate voices - Grade A voices shown first
  const gradeAVoices = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky', 'am_adam', 'am_michael'];
  const sortedVoices = [...VOICE_IDS].sort((a, b) => {
    const aIsA = gradeAVoices.includes(a);
    const bIsA = gradeAVoices.includes(b);
    if (aIsA && !bIsA) return -1;
    if (!aIsA && bIsA) return 1;
    return a.localeCompare(b);
  });

  for (const voiceId of sortedVoices) {
    const option = document.createElement('option');
    option.value = voiceId;
    option.textContent = formatVoiceName(voiceId, gradeAVoices.includes(voiceId));
    if (voiceId === currentSettings.voice) {
      option.selected = true;
    }
    voiceSelect.appendChild(option);
  }

  voiceSelect.addEventListener('change', async () => {
    await updateSettings({ voice: voiceSelect.value as VoiceId });
  });

  voiceSection.appendChild(voiceSelect);

  // Voice preview button (will be fully implemented in 08-06)
  const previewBtn = document.createElement('button');
  previewBtn.id = 'voice-preview-btn';
  previewBtn.className = 'btn btn-secondary small';
  previewBtn.textContent = 'Preview Voice';
  previewBtn.style.marginTop = '8px';
  previewBtn.addEventListener('click', handleVoicePreview);
  voiceSection.appendChild(previewBtn);

  settingsTab.appendChild(voiceSection);

  // Speed section
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

  // Theme section
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

  // Keyboard shortcuts section
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

  // About section
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
 * Format voice ID to display name
 */
function formatVoiceName(voiceId: string, isHighQuality: boolean): string {
  const parts = voiceId.split('_');
  if (parts.length !== 2) return voiceId;

  const [prefix, name] = parts;
  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);

  const accents: Record<string, string> = { 'a': 'American', 'b': 'British' };
  const genders: Record<string, string> = { 'f': 'Female', 'm': 'Male' };

  const accent = accents[prefix[0]] || '';
  const gender = genders[prefix[1]] || '';

  let display = capitalizedName;
  if (accent && gender) {
    display = `${capitalizedName} (${accent} ${gender})`;
  }

  return isHighQuality ? `${display} - High Quality` : display;
}

/**
 * Handle voice preview button click
 * Placeholder - full implementation in 08-06
 */
async function handleVoicePreview() {
  const voiceSelect = document.getElementById('voice-select') as HTMLSelectElement;
  const previewBtn = document.getElementById('voice-preview-btn') as HTMLButtonElement;

  if (!voiceSelect || !previewBtn) return;

  previewBtn.disabled = true;
  previewBtn.textContent = 'Generating...';

  try {
    // Placeholder - will be implemented in 08-06
    // For now, just show a brief message
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`Voice preview for "${voiceSelect.value}" will be implemented in plan 08-06`);
  } finally {
    previewBtn.disabled = false;
    previewBtn.textContent = 'Preview Voice';
  }
}

// Initialize when DOM ready
init();
