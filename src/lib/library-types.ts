import type { DBSchema } from 'idb';

/**
 * Chunking version for resume tracking.
 * Increment when the text chunking algorithm changes.
 */
export const CHUNKING_VERSION = '1.0.0';

/**
 * Resume data for position recovery.
 * Contains multiple fallback strategies for stable resume.
 */
export interface ResumeData {
  /** Primary: index into chunked content */
  currentChunkIndex: number;
  /** Version of chunking algorithm used */
  chunkingVersion: string;
  /** First 100 chars of current chunk for snippet fallback */
  contentSnippet: string;
  /** Character offset in full text for percentage fallback */
  charOffset: number;
  /** Total content length at save time (REQUIRED for percentage fallback) */
  contentLength: number;
  /** Hash of stored content at save time */
  contentHash: string;
}

/**
 * Library item metadata.
 * Stored separately from content to keep list queries fast.
 */
export interface LibraryItem {
  /** UUID, primary key */
  id: string;
  /** Display title */
  title: string;
  /** Source URL */
  url: string;
  /** Content source type */
  source: 'webpage' | 'pdf' | 'text';
  /** Folder assignment, null = root */
  folderId: string | null;
  /** Creation timestamp */
  createdAt: number;
  /** Last read timestamp for sorting by recent */
  lastReadAt: number;
  /** True if content was deleted to save space */
  contentDeleted: boolean;
  /** Timestamp when content was deleted */
  contentDeletedAt: number | null;
  /** Content size in bytes for quota tracking */
  contentSize: number;
  /** SHA-256 hash of content */
  contentHash: string;
  /** Resume position data, null if never read */
  resumeData: ResumeData | null;
}

/**
 * Library folder for organization.
 */
export interface LibraryFolder {
  /** UUID, primary key */
  id: string;
  /** Folder name */
  name: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

/**
 * Library content record.
 * Stored separately from metadata to avoid loading large texts on list queries.
 */
export interface LibraryContent {
  /** Same UUID as LibraryItem */
  id: string;
  /** Full text content */
  content: string;
}

/**
 * IndexedDB schema for the library database.
 * Defines stores and indexes for type-safe operations.
 *
 * Note: by-folderId index only includes items with non-null folderId.
 * Root-level items (folderId: null) are queried by filtering all items.
 */
export interface LibraryDB extends DBSchema {
  'library-items': {
    key: string;
    value: LibraryItem;
    indexes: {
      'by-url': string;
      'by-lastReadAt': number;
      'by-folderId': string;
    };
  };
  'library-contents': {
    key: string;
    value: LibraryContent;
  };
  'library-folders': {
    key: string;
    value: LibraryFolder;
  };
}
