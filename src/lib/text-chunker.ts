/**
 * Text chunking module using Intl.Segmenter for sentence boundaries
 *
 * Per CONTEXT.md decisions:
 * - Intl.Segmenter for proper sentence boundaries (handles abbreviations like "Dr.", "U.S.")
 * - Preserves punctuation (keeps "Hello!" as "Hello!", not "Hello")
 * - MAX_CHUNK_LENGTH fallback for texts without sentence-ending punctuation
 * - Locale fallback chain: provided -> navigator.language -> 'en'
 * - Empty chunk filtering
 */

const MAX_CHUNK_LENGTH = 500; // Fallback for text without punctuation

/**
 * Split text into sentence chunks using Intl.Segmenter.
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

  // Determine locale with fallback
  const effectiveLocale = locale || navigator.language || 'en';

  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(effectiveLocale, { granularity: 'sentence' });
  } catch {
    // Invalid locale, fall back to navigator.language then 'en'
    try {
      segmenter = new Intl.Segmenter(navigator.language, { granularity: 'sentence' });
    } catch {
      segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    }
  }

  const segments = Array.from(segmenter.segment(trimmed));
  const chunks: string[] = [];

  for (const segment of segments) {
    const sentence = segment.segment.trim();
    if (!sentence) continue; // Skip empty chunks

    // If sentence is too long (no punctuation case), split by max length
    if (sentence.length > MAX_CHUNK_LENGTH) {
      // Split long sentence into smaller chunks
      for (let i = 0; i < sentence.length; i += MAX_CHUNK_LENGTH) {
        const subChunk = sentence.slice(i, i + MAX_CHUNK_LENGTH).trim();
        if (subChunk) chunks.push(subChunk);
      }
    } else {
      chunks.push(sentence);
    }
  }

  return chunks;
}
