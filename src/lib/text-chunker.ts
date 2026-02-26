/**
 * Text chunking module using Intl.Segmenter for sentence boundaries
 *
 * Per CONTEXT.md decisions:
 * - Intl.Segmenter for proper sentence boundaries (handles abbreviations like "Dr.", "U.S.")
 * - Preserves punctuation (keeps "Hello!" as "Hello!", not "Hello")
 * - MAX_CHUNK_LENGTH fallback for texts without sentence-ending punctuation
 * - Locale fallback chain: provided -> navigator.language -> 'en'
 * - Empty chunk filtering
 *
 * Sentences are grouped into ~TARGET_WORDS_PER_CHUNK word blocks for efficient
 * TTS generation. Fewer, larger chunks dramatically reduce message-passing overhead
 * and allow the generation loop to pre-buffer well ahead of playback.
 */

const MAX_CHUNK_LENGTH = 2000; // Max chars per chunk (for text without punctuation)
// Kokoro-82M tokenizer has model_max_length=512 (character-level on IPA phonemes).
// ~5.8 phoneme tokens per English word → 512 / 5.8 ≈ 87 words max before truncation.
// Target 60 for safety margin while still giving ~5x fewer chunks than sentence-level.
export const TARGET_WORDS_PER_CHUNK = 60;

/**
 * Count words in a string (splits on whitespace).
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Create a sentence segmenter with locale fallback.
 */
export function createSegmenter(locale?: string): Intl.Segmenter {
  const effectiveLocale = locale || navigator.language || 'en';
  try {
    return new Intl.Segmenter(effectiveLocale, { granularity: 'sentence' });
  } catch {
    try {
      return new Intl.Segmenter(navigator.language, { granularity: 'sentence' });
    } catch {
      return new Intl.Segmenter('en', { granularity: 'sentence' });
    }
  }
}

/**
 * Group an array of sentence strings into larger chunks targeting
 * TARGET_WORDS_PER_CHUNK words each. Returns an array where each element
 * contains the indices of the sentences in that group.
 */
export function groupSentences(sentences: string[]): number[][] {
  const groups: number[][] = [];
  let currentGroup: number[] = [];
  let currentWords = 0;

  for (let i = 0; i < sentences.length; i++) {
    const words = countWords(sentences[i]);
    currentGroup.push(i);
    currentWords += words;

    if (currentWords >= TARGET_WORDS_PER_CHUNK) {
      groups.push(currentGroup);
      currentGroup = [];
      currentWords = 0;
    }
  }

  // Don't leave a trailing group that's tiny — merge into last group
  if (currentGroup.length > 0) {
    if (groups.length > 0 && currentWords < TARGET_WORDS_PER_CHUNK / 3) {
      groups[groups.length - 1].push(...currentGroup);
    } else {
      groups.push(currentGroup);
    }
  }

  return groups;
}

/**
 * Split text into chunks using Intl.Segmenter, grouped into ~150-word blocks.
 *
 * Locale priority (per CONTEXT.md):
 * 1. Provided locale parameter
 * 2. navigator.language fallback
 *
 * If Intl.Segmenter throws for a locale, falls back to navigator.language.
 */
export function splitIntoChunks(text: string, locale?: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const segmenter = createSegmenter(locale);
  const segments = Array.from(segmenter.segment(trimmed));

  // First pass: extract individual sentences
  const sentences: string[] = [];
  for (const segment of segments) {
    const sentence = segment.segment.trim();
    if (!sentence) continue;

    if (sentence.length > MAX_CHUNK_LENGTH) {
      for (let i = 0; i < sentence.length; i += MAX_CHUNK_LENGTH) {
        const subChunk = sentence.slice(i, i + MAX_CHUNK_LENGTH).trim();
        if (subChunk) sentences.push(subChunk);
      }
    } else {
      sentences.push(sentence);
    }
  }

  // Second pass: group sentences into larger chunks
  const groups = groupSentences(sentences);
  return groups.map(indices => indices.map(i => sentences[i]).join(' '));
}
