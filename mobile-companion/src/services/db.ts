/**
 * Shared IndexedDB database for the mobile companion app.
 *
 * All object stores are created in a single `onupgradeneeded` handler
 * to avoid version-conflict errors that occur when multiple modules
 * each try to open the same database at different version numbers.
 */

const DB_NAME = 'mobile-companion';
const DB_VERSION = 4; // Consolidated: ideas(v1) + settings(v2) + conversations(v3) → single v4

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // ideas store (originally v1)
      if (!db.objectStoreNames.contains('ideas')) {
        const ideasStore = db.createObjectStore('ideas', { keyPath: 'id' });
        ideasStore.createIndex('status', 'status', { unique: false });
        ideasStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // settings store (originally v2)
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // conversations store (originally v3)
      if (!db.objectStoreNames.contains('conversations')) {
        const chatStore = db.createObjectStore('conversations', { keyPath: 'id' });
        chatStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Failed to open IndexedDB'));
  });
}

/**
 * Returns a shared IDBDatabase instance (lazy-initialized singleton).
 * Safe to call from any service module — always resolves the same connection.
 */
export function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDb().catch((err) => {
      // Reset so next call retries instead of caching a rejected promise
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}
