import type { VoiceId } from './tts-engine';

const STORAGE_KEY = 'selectedVoice';
const DEFAULT_VOICE: VoiceId = 'af_heart'; // Grade A voice - highest quality

/**
 * Get the currently selected voice
 */
export async function getSelectedVoice(): Promise<VoiceId> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as VoiceId | undefined) || DEFAULT_VOICE;
}

/**
 * Save the selected voice
 */
export async function setSelectedVoice(voice: VoiceId): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: voice });
}

/**
 * Get default voice
 */
export function getDefaultVoice(): VoiceId {
  return DEFAULT_VOICE;
}
