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
