// CRITICAL: Import ONNX setup FIRST before any module that uses transformers.js
// This configures onnxruntime-web wasmPaths before transformers.js checks it.
// Without this, transformers.js defaults to loading from jsdelivr CDN which violates CSP.
import './onnx-setup';

// Now we can safely import transformers.js env (after onnx-setup has configured it)
import { env } from '@huggingface/transformers';

// Configure additional transformers.js settings
env.useBrowserCache = true;        // Enable browser caching (IndexedDB)
env.useCustomCache = false;        // Don't use custom cache (use browser default)
env.cacheDir = '';                 // Use browser's default IndexedDB location
env.allowLocalModels = false;      // We download from HuggingFace, not local files

// Import kokoro-js (which depends on transformers.js, now properly configured)
import { KokoroTTS } from 'kokoro-js';

// Voice ID type - all available Kokoro voices
// Using a const assertion to get the exact literal types
export const VOICE_IDS = [
  'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore',
  'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael',
  'am_onyx', 'am_puck', 'am_santa',
  'bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily',
  'bm_george', 'bm_lewis', 'bm_daniel', 'bm_fable'
] as const;

export type VoiceId = (typeof VOICE_IDS)[number];

// Progress callback type
export type ProgressCallback = (progress: {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}) => void;

/**
 * Singleton TTS engine wrapper
 * Loads model once, reuses for all subsequent generations
 */
class TTSEngineClass {
  private instance: KokoroTTS | null = null;
  private loading: Promise<KokoroTTS> | null = null;

  /**
   * Get or create the TTS engine instance
   * @param onProgress Optional callback for download progress
   */
  async getInstance(onProgress?: ProgressCallback): Promise<KokoroTTS> {
    // Return existing instance
    if (this.instance) {
      return this.instance;
    }

    // Return pending load
    if (this.loading) {
      return this.loading;
    }

    // Start loading
    console.log('Initializing Kokoro TTS engine...');

    this.loading = KokoroTTS.from_pretrained(
      'onnx-community/Kokoro-82M-v1.0-ONNX',
      {
        dtype: 'q8',      // 92MB quantized model - good quality/size balance
        device: 'wasm',   // Universal browser support
        progress_callback: (progress) => {
          // Log progress for debugging
          if (progress.status === 'progress') {
            // Note: progress.progress is already a percentage (0-100), not a fraction (0-1)
            const percent = progress.progress
              ? Math.round(progress.progress)
              : Math.round((progress.loaded! / progress.total!) * 100);
            console.log(`Loading ${progress.file}: ${percent}%`);
          }

          // Forward to callback
          if (onProgress) {
            onProgress(progress);
          }
        }
      }
    );

    try {
      this.instance = await this.loading;
      console.log('Kokoro TTS engine initialized successfully');
      return this.instance;
    } catch (error) {
      console.error('Failed to initialize TTS engine:', error);
      this.loading = null;
      throw error;
    }
  }

  /**
   * Check if engine is initialized
   */
  isInitialized(): boolean {
    return this.instance !== null;
  }

  /**
   * Check if engine is currently loading
   */
  isLoading(): boolean {
    return this.loading !== null && this.instance === null;
  }

  /**
   * Get list of available voices
   */
  async getVoices(): Promise<VoiceId[]> {
    const tts = await this.getInstance();
    // tts.voices is a readonly object with voice IDs as keys
    return Object.keys(tts.voices) as VoiceId[];
  }

  /**
   * Generate audio from text
   * @param text Text to synthesize
   * @param voice Voice ID to use
   * @returns Audio blob for playback
   */
  async generate(text: string, voice: VoiceId): Promise<Blob> {
    const tts = await this.getInstance();

    console.log(`Generating speech: "${text.substring(0, 50)}..." with voice ${voice}`);
    const startTime = performance.now();

    const audio = await tts.generate(text, { voice });

    const duration = Math.round(performance.now() - startTime);
    console.log(`Speech generated in ${duration}ms`);

    return audio.toBlob();
  }

  /**
   * Reset the engine (for testing/debugging)
   */
  reset(): void {
    this.instance = null;
    this.loading = null;
  }
}

// Export singleton instance
export const TTSEngine = new TTSEngineClass();
