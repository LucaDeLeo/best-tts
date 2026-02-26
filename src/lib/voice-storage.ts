import type { VoiceId } from './tts-engine';
import { getSetting, updateSettings, type Settings } from './settings-storage';

const DEFAULT_VOICE: VoiceId = 'af_heart'; // Grade A voice - highest quality

/** Voices with the highest quality ratings */
export const GRADE_A_VOICES: readonly string[] = [
  'af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky', 'am_adam', 'am_michael'
];

/**
 * Format voice ID to human-readable display name.
 * e.g., 'af_heart' -> 'Heart (American Female)'
 */
export function formatVoiceName(voiceId: string, isHighQuality?: boolean): string {
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
 * Get the currently selected voice from unified settings
 */
export async function getSelectedVoice(): Promise<VoiceId> {
  return await getSetting('voice');
}

/**
 * Save the selected voice to unified settings
 */
export async function setSelectedVoice(voice: VoiceId): Promise<void> {
  await updateSettings({ voice });
}

/**
 * Get default voice
 */
export function getDefaultVoice(): VoiceId {
  return DEFAULT_VOICE;
}

/**
 * Get the effective voice for the current engine.
 * mlx-audio uses its own voice setting; Kokoro uses the standard voice.
 */
export function getEffectiveVoice(settings: Settings): string {
  if (settings.engine === 'mlx-audio' && settings.mlxAudioVoice) {
    return settings.mlxAudioVoice;
  }
  return settings.voice;
}

/**
 * Format voice display name for any engine.
 * Kokoro uses the existing prefix-based formatter; mlx-audio just capitalizes.
 */
export function formatVoiceDisplayName(voiceId: string, engine: Settings['engine']): string {
  if (engine === 'kokoro') {
    return formatVoiceName(voiceId, GRADE_A_VOICES.includes(voiceId));
  }
  // mlx-audio voices are plain names like 'Chelsie', 'af_heart'
  return voiceId.charAt(0).toUpperCase() + voiceId.slice(1);
}
