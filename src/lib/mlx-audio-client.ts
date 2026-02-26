/**
 * mlx-audio HTTP client
 * Self-contained client for the mlx-audio OpenAI-compatible TTS server.
 * Used when engine === 'mlx-audio' to bypass offscreen WASM entirely.
 */

// ── Types ──────────────────────────────────────────────

export interface MlxServerStatus {
  online: boolean;
  models: string[];
  error?: string;
}

export interface MlxSpeechResult {
  success: boolean;
  audioData?: string;       // base64-encoded audio
  audioMimeType?: string;   // e.g. 'audio/wav'
  error?: string;
}

interface MlxModelsResponse {
  data: Array<{ id: string }>;
}

// ── Known voice registries per model family ────────────

const KOKORO_VOICES = [
  'af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky',
  'am_adam', 'am_michael',
  'af_alloy', 'af_aoede', 'af_jessica', 'af_kore', 'af_nova', 'af_river', 'af_shimmer',
  'am_echo', 'am_fable', 'am_liam', 'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
  'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
];

const QWEN3_TTS_VOICES = [
  'Chelsie', 'Aiden', 'Aria', 'Aurora', 'Bailey',
  'Brooklyn', 'Callum', 'Cameron', 'Charlie', 'Chloe',
  'Daniel', 'Ella', 'Emma', 'Ethan', 'Harper',
  'Isabella', 'Jayden', 'Lily', 'Logan', 'Lucas',
  'Mason', 'Mia', 'Noah', 'Oliver', 'Quinn',
  'Riley', 'Savannah', 'Scarlett', 'Sophie', 'Tyler',
];

// ── Utilities ──────────────────────────────────────────

/**
 * Convert ArrayBuffer to base64 string efficiently.
 * Uses chunked btoa to avoid creating massive intermediate strings.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Fetch with AbortController timeout.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// ── Public API ─────────────────────────────────────────

/**
 * Check server health by querying GET /v1/models.
 * Returns online status and list of available model IDs.
 */
export async function checkServerHealth(baseUrl: string): Promise<MlxServerStatus> {
  try {
    const resp = await fetchWithTimeout(`${baseUrl}/v1/models`, { method: 'GET' }, 3000);
    if (!resp.ok) {
      return { online: false, models: [], error: `Server returned ${resp.status}` };
    }
    const data = (await resp.json()) as MlxModelsResponse;
    const models = (data.data || []).map(m => m.id);
    return { online: true, models };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    return { online: false, models: [], error: message };
  }
}

/**
 * Generate speech via POST /v1/audio/speech.
 * Returns base64-encoded audio data compatible with the existing PLAY_AUDIO pipeline.
 */
export async function generateSpeech(opts: {
  baseUrl: string;
  model: string;
  text: string;
  voice: string;
  speed: number;
}): Promise<MlxSpeechResult> {
  try {
    const resp = await fetchWithTimeout(
      `${opts.baseUrl}/v1/audio/speech`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: opts.model,
          input: opts.text,
          voice: opts.voice,
          speed: opts.speed,
          response_format: 'wav',
        }),
      },
      30_000
    );

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { success: false, error: `Server error ${resp.status}: ${errText}` };
    }

    const arrayBuffer = await resp.arrayBuffer();
    const audioData = arrayBufferToBase64(arrayBuffer);
    return { success: true, audioData, audioMimeType: 'audio/wav' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Speech generation failed';
    if (message.includes('aborted')) {
      return { success: false, error: 'Request timed out (30s)' };
    }
    return { success: false, error: message };
  }
}

/**
 * Return known voices for a model based on its ID pattern.
 * Falls back to a generic list if the model is unrecognized.
 */
export function getVoicesForModel(modelId: string): string[] {
  const lower = modelId.toLowerCase();
  if (lower.includes('kokoro')) return KOKORO_VOICES;
  if (lower.includes('qwen') || lower.includes('tts')) return QWEN3_TTS_VOICES;
  // Unknown model — return combined list
  return [...QWEN3_TTS_VOICES, ...KOKORO_VOICES];
}
