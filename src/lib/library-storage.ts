import { openDB, IDBPDatabase } from 'idb';
import type {
  LibraryDB,
  LibraryItem,
  LibraryContent,
  LibraryFolder,
  ResumeData,
} from './library-types';

/**
 * Database configuration
 */
const DB_NAME = 'library-db';
const DB_VERSION = 1;

/**
 * Singleton database instance
 */
let dbInstance: IDBPDatabase<LibraryDB> | null = null;

/**
 * Get or open the library database.
 * Uses singleton pattern to avoid multiple connections.
 */
export async function getLibraryDB(): Promise<IDBPDatabase<LibraryDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<LibraryDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Version 1: Initial schema
      if (oldVersion < 1) {
        // Create library-items store with indexes
        const items = db.createObjectStore('library-items', { keyPath: 'id' });
        items.createIndex('by-url', 'url', { unique: false });
        items.createIndex('by-lastReadAt', 'lastReadAt', { unique: false });
        items.createIndex('by-folderId', 'folderId', { unique: false });

        // Create library-contents store (no indexes needed)
        db.createObjectStore('library-contents', { keyPath: 'id' });

        // Create library-folders store
        db.createObjectStore('library-folders', { keyPath: 'id' });
      }
    },
    blocking() {
      // Another tab opened a newer version
      dbInstance?.close();
      dbInstance = null;
    },
    terminated() {
      // Browser abnormally terminated connection
      dbInstance = null;
    },
  });

  return dbInstance;
}

/**
 * Close the library database connection.
 * Call when cleaning up resources.
 */
export function closeLibraryDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Save a library item with its content atomically.
 * Both stores are updated in a single transaction to prevent orphaned data.
 */
export async function saveLibraryItem(
  item: LibraryItem,
  content: string
): Promise<void> {
  const db = await getLibraryDB();
  const tx = db.transaction(['library-items', 'library-contents'], 'readwrite');
  tx.objectStore('library-items').put(item);
  tx.objectStore('library-contents').put({ id: item.id, content });
  await tx.done;
}

/**
 * Delete a library item and its content atomically.
 * Both stores are updated in a single transaction.
 */
export async function deleteLibraryItem(id: string): Promise<void> {
  const db = await getLibraryDB();
  const tx = db.transaction(['library-items', 'library-contents'], 'readwrite');
  tx.objectStore('library-items').delete(id);
  tx.objectStore('library-contents').delete(id);
  await tx.done;
}

/**
 * Options for querying library items
 */
export interface GetLibraryItemsOptions {
  /** Filter by folder ID (null for root-level items) */
  folderId?: string | null;
  /** Sort by lastReadAt descending */
  sortByRecent?: boolean;
}

/**
 * Get all library items, optionally filtered and sorted.
 */
export async function getLibraryItems(
  options: GetLibraryItemsOptions = {}
): Promise<LibraryItem[]> {
  const db = await getLibraryDB();
  let items: LibraryItem[];

  if (options.sortByRecent) {
    // Use index for sorted results
    const tx = db.transaction('library-items', 'readonly');
    const index = tx.store.index('by-lastReadAt');
    items = [];

    // Iterate backwards (most recent first)
    let cursor = await index.openCursor(null, 'prev');
    while (cursor) {
      items.push(cursor.value);
      cursor = await cursor.continue();
    }
  } else {
    // Simple getAll
    items = await db.getAll('library-items');
  }

  // Filter by folderId if specified
  if (options.folderId !== undefined) {
    items = items.filter((item) => item.folderId === options.folderId);
  }

  return items;
}

/**
 * Get a single library item by ID (metadata only).
 */
export async function getLibraryItemById(
  id: string
): Promise<LibraryItem | undefined> {
  const db = await getLibraryDB();
  return db.get('library-items', id);
}

/**
 * Get content for a library item.
 */
export async function getLibraryContent(
  id: string
): Promise<string | undefined> {
  const db = await getLibraryDB();
  const record = await db.get('library-contents', id);
  return record?.content;
}

/**
 * Check if a URL is already saved in the library.
 * Uses the by-url index for efficient lookup.
 */
export async function isUrlSaved(url: string): Promise<LibraryItem | null> {
  const db = await getLibraryDB();
  const item = await db.getFromIndex('library-items', 'by-url', url);
  return item ?? null;
}

/**
 * Update library item position only (for autosave).
 * Single-store transaction for fast updates.
 */
export async function updateLibraryItemPosition(
  id: string,
  resumeData: Partial<ResumeData> & { lastReadAt?: number }
): Promise<void> {
  const db = await getLibraryDB();
  const item = await db.get('library-items', id);
  if (!item) return;

  // Merge resume data
  if (resumeData.lastReadAt !== undefined) {
    item.lastReadAt = resumeData.lastReadAt;
  }

  if (item.resumeData) {
    item.resumeData = { ...item.resumeData, ...resumeData };
  } else {
    // Create new resume data if doesn't exist (requires all fields)
    if (
      resumeData.currentChunkIndex !== undefined &&
      resumeData.chunkingVersion !== undefined &&
      resumeData.contentSnippet !== undefined &&
      resumeData.charOffset !== undefined &&
      resumeData.contentLength !== undefined &&
      resumeData.contentHash !== undefined
    ) {
      item.resumeData = resumeData as ResumeData;
    }
  }

  await db.put('library-items', item);
}

// ============================================
// Folder CRUD Operations
// ============================================

/**
 * Create a new folder.
 */
export async function createFolder(name: string): Promise<LibraryFolder> {
  const db = await getLibraryDB();
  const now = Date.now();
  const folder: LibraryFolder = {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
  };
  await db.put('library-folders', folder);
  return folder;
}

/**
 * Rename a folder.
 */
export async function renameFolder(id: string, name: string): Promise<void> {
  const db = await getLibraryDB();
  const folder = await db.get('library-folders', id);
  if (!folder) return;

  folder.name = name;
  folder.updatedAt = Date.now();
  await db.put('library-folders', folder);
}

/**
 * Delete a folder.
 * Items in the folder are moved to root (folderId becomes null).
 */
export async function deleteFolder(id: string): Promise<void> {
  const db = await getLibraryDB();

  // Move items in this folder to root
  const items = await db.getAll('library-items');
  const itemsInFolder = items.filter((item) => item.folderId === id);

  const tx = db.transaction(['library-items', 'library-folders'], 'readwrite');

  // Update items to root
  for (const item of itemsInFolder) {
    item.folderId = null;
    tx.objectStore('library-items').put(item);
  }

  // Delete the folder
  tx.objectStore('library-folders').delete(id);

  await tx.done;
}

/**
 * Get all folders sorted by name.
 */
export async function getFolders(): Promise<LibraryFolder[]> {
  const db = await getLibraryDB();
  const folders = await db.getAll('library-folders');
  return folders.sort((a, b) => a.name.localeCompare(b.name));
}

// ============================================
// Helper Functions
// ============================================

/**
 * Hash content using SHA-256.
 * Uses Web Crypto API for browser-native, secure hashing.
 */
export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get recent items using the by-lastReadAt index.
 */
export async function getRecentItems(limit = 5): Promise<LibraryItem[]> {
  const db = await getLibraryDB();
  const tx = db.transaction('library-items', 'readonly');
  const index = tx.store.index('by-lastReadAt');

  const items: LibraryItem[] = [];
  let cursor = await index.openCursor(null, 'prev');

  while (cursor && items.length < limit) {
    items.push(cursor.value);
    cursor = await cursor.continue();
  }

  return items;
}

/**
 * Storage estimate result
 */
export interface StorageEstimate {
  canSave: boolean;
  available: number;
  usage: number;
}

/**
 * Get storage estimate for the library.
 * Returns null if the API is unavailable or unreliable.
 */
export async function getStorageEstimateForLibrary(): Promise<StorageEstimate | null> {
  if (!navigator.storage?.estimate) return null;

  try {
    const estimate = await navigator.storage.estimate();
    // Some browsers return 0 or undefined for quota
    if (!estimate.quota || estimate.quota === 0) return null;

    return {
      canSave: true,
      available: estimate.quota - (estimate.usage || 0),
      usage: estimate.usage || 0,
    };
  } catch {
    return null;
  }
}

// ============================================
// Error Handling & Retry Logic
// ============================================

/**
 * Check if an error is transient and can be retried.
 */
function isTransientError(error: Error): boolean {
  return error.name === 'AbortError' || error.name === 'InvalidStateError';
}

/**
 * Sleep for a given duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an operation with retry logic for transient errors.
 * Uses exponential backoff: 100ms, 200ms, 400ms.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Error && isTransientError(error)) {
        lastError = error;
        await sleep(100 * Math.pow(2, i)); // Exponential backoff
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}
