/**
 * Text file extraction with encoding detection.
 * Per CONTEXT.md Decision #3: Read as ArrayBuffer, decode in offscreen.
 *
 * Supports:
 * - UTF-8 (with and without BOM)
 * - UTF-16 LE/BE (detected via BOM)
 * - ASCII (subset of UTF-8)
 */

/**
 * Result of text file extraction.
 */
export interface TextExtractionResult {
  success: boolean;
  text?: string;
  title?: string;          // Filename
  textLength?: number;     // Character count
  encoding?: string;       // Detected encoding
  error?: string;
}

/**
 * Byte Order Marks for encoding detection.
 */
const BOM = {
  UTF8: [0xEF, 0xBB, 0xBF],
  UTF16_LE: [0xFF, 0xFE],
  UTF16_BE: [0xFE, 0xFF],
} as const;

/**
 * Extract text from a text file (txt, md).
 *
 * Per CONTEXT.md Decision #3:
 * - Decode ArrayBuffer in offscreen document
 * - Handle BOM for UTF-8 and UTF-16
 * - TextDecoder handles UTF-8 BOM automatically
 *
 * @param data ArrayBuffer containing text file data
 * @param filename Original filename (used for title)
 * @returns Extraction result with decoded text
 */
export function extractTextFile(
  data: ArrayBuffer,
  filename: string
): TextExtractionResult {
  try {
    if (data.byteLength === 0) {
      return {
        success: false,
        error: 'File is empty'
      };
    }

    // Detect encoding from BOM
    const bytes = new Uint8Array(data);
    const encoding = detectEncoding(bytes);

    // Decode based on detected encoding
    let text: string;
    let skipBytes = 0;

    switch (encoding) {
      case 'utf-16le':
        skipBytes = 2; // Skip BOM
        text = new TextDecoder('utf-16le').decode(bytes.slice(skipBytes));
        break;

      case 'utf-16be':
        skipBytes = 2; // Skip BOM
        text = new TextDecoder('utf-16be').decode(bytes.slice(skipBytes));
        break;

      case 'utf-8-bom':
        // TextDecoder handles UTF-8 BOM automatically, but we can skip it explicitly
        skipBytes = 3;
        text = new TextDecoder('utf-8').decode(bytes.slice(skipBytes));
        break;

      case 'utf-8':
      default:
        // Standard UTF-8 (TextDecoder default)
        text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        break;
    }

    // Basic text cleanup
    text = normalizeTextContent(text);

    if (!text.trim()) {
      return {
        success: false,
        error: 'File contains no readable text'
      };
    }

    return {
      success: true,
      text,
      title: filename,
      textLength: text.length,
      encoding
    };

  } catch (error) {
    console.error('Text file extraction error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read text file'
    };
  }
}

/**
 * Detect text encoding from BOM (Byte Order Mark).
 *
 * @param bytes First bytes of the file
 * @returns Detected encoding name
 */
function detectEncoding(bytes: Uint8Array): 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' {
  // Check for UTF-8 BOM (EF BB BF)
  if (bytes.length >= 3 &&
      bytes[0] === BOM.UTF8[0] &&
      bytes[1] === BOM.UTF8[1] &&
      bytes[2] === BOM.UTF8[2]) {
    return 'utf-8-bom';
  }

  // Check for UTF-16 LE BOM (FF FE)
  if (bytes.length >= 2 &&
      bytes[0] === BOM.UTF16_LE[0] &&
      bytes[1] === BOM.UTF16_LE[1]) {
    return 'utf-16le';
  }

  // Check for UTF-16 BE BOM (FE FF)
  if (bytes.length >= 2 &&
      bytes[0] === BOM.UTF16_BE[0] &&
      bytes[1] === BOM.UTF16_BE[1]) {
    return 'utf-16be';
  }

  // Default to UTF-8 (also covers ASCII)
  return 'utf-8';
}

/**
 * Normalize text content for TTS readability.
 *
 * - Normalize line endings (CRLF -> LF)
 * - Remove null characters
 * - Collapse excessive blank lines
 */
function normalizeTextContent(text: string): string {
  return text
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove null characters (can appear in malformed files)
    .replace(/\0/g, '')
    // Collapse 3+ consecutive newlines to 2 (preserve paragraph breaks)
    .replace(/\n{3,}/g, '\n\n')
    // Trim leading/trailing whitespace
    .trim();
}

/**
 * Get file extension from filename.
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Check if a filename indicates a supported text file.
 */
export function isSupportedTextFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return ext === 'txt' || ext === 'md';
}
