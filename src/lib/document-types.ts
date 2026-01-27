/**
 * Document extraction types for Phase 6.
 * Per CONTEXT.md: Single EXTRACT_DOCUMENT message type with documentType field.
 */

/**
 * Supported document types for extraction.
 */
export type DocumentType = 'pdf' | 'txt' | 'md';

/**
 * Extraction state tracked in service worker.
 * Used for pending warnings and cancellation.
 */
export interface ExtractionState {
  extractionId: string;
  status: 'uploading' | 'extracting' | 'warning' | 'complete' | 'cancelled' | 'error';
  documentType: DocumentType;
  filename: string;
  fileSize: number;
  progress?: number;       // 0-100 for chunked uploads
  pageCount?: number;      // PDF only
  textLength?: number;     // After extraction
  pendingWarning?: PendingWarning;
  error?: string;
}

/**
 * Warning types that pause extraction for user confirmation.
 * Per CONTEXT.md Decision #6: Multi-threshold soft limits.
 */
export type WarningType = 'fileSize' | 'pageCount' | 'textLength';

/**
 * Pending warning requiring user confirmation.
 */
export interface PendingWarning {
  type: WarningType;
  value: number;          // The value that triggered the warning
  threshold: number;      // The threshold that was exceeded
  extractionId: string;
}

/**
 * Thresholds for soft limit warnings.
 * Per CONTEXT.md Decision #6.
 */
export const EXTRACTION_THRESHOLDS = {
  FILE_SIZE_BYTES: 50 * 1024 * 1024,    // 50 MB
  PAGE_COUNT: 100,                       // PDF pages
  TEXT_LENGTH: 500_000,                  // Characters
  CHUNK_SIZE_BYTES: 5 * 1024 * 1024,    // 5 MB chunks for large files
  DIRECT_SEND_LIMIT: 10 * 1024 * 1024,  // 10 MB direct send limit
} as const;

/**
 * Message sent from popup to service worker to extract a document.
 * Per CONTEXT.md Decision #5: Single message type with documentType field.
 *
 * For files <= 10 MB: data contains full ArrayBuffer
 * For files > 10 MB: data is null, chunks sent via DOCUMENT_CHUNK messages
 */
export interface ExtractDocumentMessage {
  target: 'service-worker';
  type: 'extract-document';
  documentType: DocumentType;
  data: ArrayBuffer | null;  // null for chunked uploads
  filename: string;
  fileSize: number;          // Always provided for size-based decisions
  extractionId: string;      // Unique ID for tracking
}

/**
 * Chunk message for large file uploads (> 10 MB).
 * Per CONTEXT.md Decision #2: Streamed chunking approach.
 */
export interface DocumentChunkMessage {
  target: 'service-worker';
  type: 'document-chunk';
  extractionId: string;
  chunkIndex: number;
  totalChunks: number;
  data: ArrayBuffer;
}

/**
 * Final message after all chunks sent.
 */
export interface DocumentChunkCompleteMessage {
  target: 'service-worker';
  type: 'document-chunk-complete';
  extractionId: string;
}

/**
 * Message from service worker to offscreen for actual extraction.
 */
export interface OffscreenExtractMessage {
  target: 'offscreen';
  type: 'extract-document';
  documentType: DocumentType;
  data: ArrayBuffer;
  filename: string;
  extractionId: string;
}

/**
 * Result of document extraction.
 */
export interface DocumentExtractionResult {
  success: boolean;
  text?: string;
  title?: string;           // Filename or PDF title
  pageCount?: number;       // PDF only
  textLength?: number;
  error?: string;
  extractionId: string;
}

/**
 * Warning message sent when extraction hits a soft limit.
 * Pauses extraction until user confirms.
 */
export interface ExtractionWarningMessage {
  target: 'popup';
  type: 'extraction-warning';
  warning: PendingWarning;
}

/**
 * User response to a warning (continue or cancel).
 */
export interface WarningResponseMessage {
  target: 'service-worker';
  type: 'warning-response';
  extractionId: string;
  action: 'continue' | 'cancel';
}

/**
 * Cancel extraction request.
 */
export interface CancelExtractionMessage {
  target: 'service-worker';
  type: 'cancel-extraction';
  extractionId: string;
}

/**
 * Request pending warning state (for popup reopen).
 */
export interface GetPendingWarningMessage {
  target: 'service-worker';
  type: 'get-pending-warning';
}

/**
 * Progress update during extraction.
 */
export interface ExtractionProgressMessage {
  target: 'popup';
  type: 'extraction-progress';
  extractionId: string;
  progress: number;        // 0-100
  stage: 'uploading' | 'extracting';
}

/**
 * Generate a unique extraction ID.
 */
export function generateExtractionId(): string {
  return `extraction-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Check if file size exceeds direct send limit.
 */
export function needsChunkedUpload(fileSize: number): boolean {
  return fileSize > EXTRACTION_THRESHOLDS.DIRECT_SEND_LIMIT;
}

/**
 * Calculate number of chunks needed for a file.
 */
export function calculateChunkCount(fileSize: number): number {
  return Math.ceil(fileSize / EXTRACTION_THRESHOLDS.CHUNK_SIZE_BYTES);
}
