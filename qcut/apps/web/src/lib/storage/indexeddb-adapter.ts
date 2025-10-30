import { StorageAdapter } from "./types";

/**
 * IndexedDB-based storage adapter for persistent browser storage
 * Provides a key-value interface backed by IndexedDB
 * @template T - The type of data to be stored
 */
export class IndexedDBAdapter<T> implements StorageAdapter<T> {
  private dbName: string;
  private storeName: string;
  private version: number;

  /**
   * Creates a new IndexedDB storage adapter
   * @param dbName - Name of the IndexedDB database
   * @param storeName - Name of the object store within the database
   * @param version - Database version number (default: 1)
   */
  constructor(dbName: string, storeName: string, version = 1) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.version = version;

    // DEBUG: Track database creation with stack trace
    if (
      dbName.startsWith("video-editor-media-") ||
      dbName.startsWith("video-editor-timelines-")
    ) {
      const debugError = new Error("Stack trace for database creation");
      console.log(`[IndexedDBAdapter] Creating database: ${dbName}`);
      console.log("[IndexedDBAdapter] Call stack:", debugError.stack);
    }
  }

  private async getDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!indexedDB) {
        reject(new Error("IndexedDB not available"));
        return;
      }

      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        reject(request.error);
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
      };
    });
  }

  /**
   * Retrieves a value from storage by key
   * @param key - The key to retrieve
   * @returns Promise resolving to the stored value, or null if not found
   */
  async get(key: string): Promise<T | null> {
    const db = await this.getDB();
    const transaction = db.transaction([this.storeName], "readonly");
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  /**
   * Stores a value in IndexedDB with the specified key
   * @param key - The key to store the value under
   * @param value - The value to store
   * @returns Promise that resolves when the value is stored
   */
  async set(key: string, value: T): Promise<void> {
    const db = await this.getDB();
    const transaction = db.transaction([this.storeName], "readwrite");
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.put({ id: key, ...value });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Removes a value from storage by key
   * @param key - The key to remove
   * @returns Promise that resolves when the value is removed
   */
  async remove(key: string): Promise<void> {
    const db = await this.getDB();
    const transaction = db.transaction([this.storeName], "readwrite");
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Lists all keys in the storage
   * @returns Promise resolving to an array of all keys in the store
   */
  async list(): Promise<string[]> {
    const db = await this.getDB();
    const transaction = db.transaction([this.storeName], "readonly");
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.getAllKeys();
      request.onerror = () => {
        reject(request.error);
      };
      request.onsuccess = () => {
        resolve(request.result as string[]);
      };
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDB();
    const transaction = db.transaction([this.storeName], "readwrite");
    const store = transaction.objectStore(this.storeName);

    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}
