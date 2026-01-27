/**
 * Settings Storage Module
 * Per CONTEXT.md Decision #4: Consolidated settings storage with migration
 */

import type { VoiceId } from './tts-engine';

/**
 * Settings interface
 * Shape per CONTEXT.md: { voice, speed, darkMode, shortcuts }
 */
export interface Settings {
  /** Selected voice ID */
  voice: VoiceId;
  /** Playback speed (0.5 - 4.0) */
  speed: number;
  /** Dark mode preference: 'system' (follow OS), 'light', or 'dark' */
  darkMode: 'system' | 'light' | 'dark';
  /** In-panel keyboard shortcuts (not global Chrome shortcuts) */
  shortcuts: ShortcutBindings;
}

/**
 * Keyboard shortcut bindings for in-panel actions
 * Per CONTEXT.md Decision #7: Only in-panel shortcuts can be customized
 */
export interface ShortcutBindings {
  playPause: string;    // Default: 'Space'
  skipBack: string;     // Default: 'ArrowLeft'
  skipForward: string;  // Default: 'ArrowRight'
  speedUp: string;      // Default: 'Equal' (+ key)
  speedDown: string;    // Default: 'Minus'
}

/**
 * Default settings values
 */
export const DEFAULT_SETTINGS: Settings = {
  voice: 'af_heart',
  speed: 1.0,
  darkMode: 'system',
  shortcuts: {
    playPause: 'Space',
    skipBack: 'ArrowLeft',
    skipForward: 'ArrowRight',
    speedUp: 'Equal',
    speedDown: 'Minus',
  },
};

const SETTINGS_KEY = 'settings';

/**
 * Get all settings, merging with defaults for any missing keys
 */
export async function getSettings(): Promise<Settings> {
  const { [SETTINGS_KEY]: stored } = await chrome.storage.local.get(SETTINGS_KEY);

  if (!stored) {
    return { ...DEFAULT_SETTINGS };
  }

  // Merge with defaults to handle missing keys (forward compatibility)
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    shortcuts: {
      ...DEFAULT_SETTINGS.shortcuts,
      ...(stored.shortcuts || {}),
    },
  };
}

/**
 * Update settings (partial update supported)
 */
export async function updateSettings(updates: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();

  const newSettings: Settings = {
    ...current,
    ...updates,
    // Handle nested shortcuts object
    shortcuts: updates.shortcuts
      ? { ...current.shortcuts, ...updates.shortcuts }
      : current.shortcuts,
  };

  await chrome.storage.local.set({ [SETTINGS_KEY]: newSettings });

  return newSettings;
}

/**
 * Get a single setting value
 */
export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const settings = await getSettings();
  return settings[key];
}

/**
 * Migrate legacy settings to consolidated format
 * Per CONTEXT.md Decision #4: Check for legacy keys, migrate, then delete old keys
 *
 * Legacy keys:
 * - 'playbackSpeed' -> settings.speed
 * - 'selectedVoice' -> settings.voice
 * - 'darkMode' -> settings.darkMode (already matches new format)
 *
 * Call this once on extension startup (service worker load)
 */
export async function migrateSettings(): Promise<boolean> {
  const legacyKeys = ['playbackSpeed', 'selectedVoice', 'darkMode'];
  const legacy = await chrome.storage.local.get(legacyKeys);

  // Check if any legacy keys exist
  const hasLegacyData = Object.keys(legacy).some(key => legacy[key] !== undefined);

  if (!hasLegacyData) {
    // No migration needed
    return false;
  }

  console.log('Migrating legacy settings:', Object.keys(legacy).filter(k => legacy[k] !== undefined));

  // Get current settings (may have partial data from new format)
  const current = await getSettings();

  // Build migrated settings
  const migrated: Settings = {
    ...current,
    speed: typeof legacy.playbackSpeed === 'number' ? legacy.playbackSpeed : current.speed,
    voice: typeof legacy.selectedVoice === 'string' ? (legacy.selectedVoice as VoiceId) : current.voice,
    darkMode: ['system', 'light', 'dark'].includes(legacy.darkMode)
      ? legacy.darkMode
      : current.darkMode,
  };

  // Save migrated settings
  await chrome.storage.local.set({ [SETTINGS_KEY]: migrated });

  // Delete legacy keys
  await chrome.storage.local.remove(legacyKeys);

  console.log('Settings migration complete');
  return true;
}

/**
 * Reset all settings to defaults
 */
export async function resetSettings(): Promise<Settings> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
}
