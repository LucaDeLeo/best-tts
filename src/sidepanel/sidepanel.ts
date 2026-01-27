// Side Panel entry point for Best TTS
// Per CONTEXT.md: Full library view and settings interface

console.log('Side panel loaded');

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

  // Persist preference
  await chrome.storage.local.set({
    darkMode: isDark ? 'dark' : 'light'
  });
}

/**
 * Load saved theme preference
 */
async function loadThemePreference() {
  const { darkMode } = await chrome.storage.local.get(['darkMode']);

  if (darkMode === 'dark') {
    document.documentElement.classList.add('dark-mode');
  } else if (darkMode === 'light') {
    document.documentElement.classList.remove('dark-mode');
  } else {
    // System preference (default)
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark-mode');
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
 * Load settings tab content (placeholder for 08-05)
 * Uses safe DOM manipulation (createElement/appendChild)
 */
async function loadSettingsTab() {
  const settingsTab = document.getElementById('settings-tab');
  if (!settingsTab) return;

  // Clear existing content safely
  while (settingsTab.firstChild) {
    settingsTab.removeChild(settingsTab.firstChild);
  }

  // Placeholder - will be populated in 08-05
  const placeholder = document.createElement('p');
  placeholder.className = 'placeholder';
  placeholder.textContent = 'Settings content will load here';
  settingsTab.appendChild(placeholder);
}

// Initialize when DOM ready
init();
