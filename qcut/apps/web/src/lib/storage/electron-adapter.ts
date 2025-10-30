import { StorageAdapter } from "./types";
import { handleStorageError } from "@/lib/error-handler";

/**
 * Electron IPC-based storage adapter for desktop application
 * Delegates storage operations to the Electron main process via IPC
 * @template T - The type of data to be stored
 */
export class ElectronStorageAdapter<T> implements StorageAdapter<T> {
  private prefix: string;

  /**
   * Creates a new Electron storage adapter
   * @param dbName - Database name used for key prefixing
   * @param storeName - Store name used for key prefixing
   */
  constructor(dbName: string, storeName: string) {
    this.prefix = `${dbName}_${storeName}_`;
  }

  private getElectronAPI() {
    return (window as any)?.electronAPI;
  }

  /**
   * Retrieves a value from Electron storage by key
   * @param key - The key to retrieve
   * @returns Promise resolving to the stored value, or null if not found or on error
   */
  async get(key: string): Promise<T | null> {
    try {
      const fullKey = `${this.prefix}${key}`;
      const api = this.getElectronAPI();
      if (!api?.storage?.load) {
        handleStorageError(
          new Error("Electron API unavailable"),
          "Get data from Electron storage",
          { key, operation: "get" }
        );
        return null;
      }
      const value = await api.storage.load(fullKey);
      return value ?? null;
    } catch (error) {
      handleStorageError(error, "Get data from Electron storage", {
        key,
        operation: "get",
      });
      return null;
    }
  }

  /**
   * Stores a value in Electron storage with the specified key
   * @param key - The key to store the value under
   * @param value - The value to store
   * @returns Promise that resolves when the value is stored
   * @throws Error if storage operation fails
   */
  async set(key: string, value: T): Promise<void> {
    try {
      const fullKey = `${this.prefix}${key}`;
      const api = this.getElectronAPI();
      if (!api?.storage?.save) {
        handleStorageError(
          new Error("Electron API unavailable"),
          "Save data to Electron storage",
          { key, operation: "set" }
        );
        throw new Error("Electron API unavailable");
      }
      await api.storage.save(fullKey, value);
    } catch (error) {
      handleStorageError(error, "Save data to Electron storage", {
        key,
        operation: "set",
      });
      throw error;
    }
  }

  /**
   * Removes a value from Electron storage by key
   * @param key - The key to remove
   * @returns Promise that resolves when the value is removed
   * @throws Error if removal fails
   */
  async remove(key: string): Promise<void> {
    try {
      const fullKey = `${this.prefix}${key}`;
      const api = this.getElectronAPI();
      if (!api?.storage?.remove) {
        handleStorageError(
          new Error("Electron API unavailable"),
          "Remove data from Electron storage",
          { key, operation: "remove" }
        );
        throw new Error("Electron API unavailable");
      }
      await api.storage.remove(fullKey);
    } catch (error) {
      handleStorageError(error, "Remove data from Electron storage", {
        key,
        operation: "remove",
      });
      throw error;
    }
  }

  /**
   * Lists all keys in Electron storage with the current prefix
   * @returns Promise resolving to an array of keys (without prefix)
   * @throws Error if listing fails
   */
  async list(): Promise<string[]> {
    try {
      const api = this.getElectronAPI();
      if (!api?.storage?.list) {
        handleStorageError(
          new Error("Electron API unavailable"),
          "List Electron storage keys",
          { operation: "list" }
        );
        throw new Error("Electron API unavailable");
      }
      const allKeys = await api.storage.list();
      if (!Array.isArray(allKeys)) {
        handleStorageError(
          new Error("Electron storage.list returned non-array"),
          "List Electron storage keys",
          { operation: "list" }
        );
        throw new Error("Electron storage.list returned non-array");
      }
      return allKeys
        .filter((key: string) => key.startsWith(this.prefix))
        .map((key: string) => key.substring(this.prefix.length));
    } catch (error) {
      handleStorageError(error, "List Electron storage keys", {
        operation: "list",
      });
      throw error;
    }
  }

  /**
   * Clears all keys with the current prefix from Electron storage
   * @returns Promise that resolves when all prefixed keys are removed
   * @throws Error if clearing fails
   */
  async clear(): Promise<void> {
    try {
      const api = this.getElectronAPI();
      if (!api?.storage?.list || !api?.storage?.remove) {
        handleStorageError(
          new Error("Electron API unavailable"),
          "Clear Electron storage",
          { operation: "clear" }
        );
        throw new Error("Electron API unavailable");
      }
      const allKeys = await api.storage.list();
      const keysToRemove = allKeys.filter((key: string) =>
        key.startsWith(this.prefix)
      );
      await Promise.all(
        keysToRemove.map((key: string) => api.storage.remove(key))
      );
    } catch (error) {
      handleStorageError(error, "Clear Electron storage", {
        operation: "clear",
      });
      throw error;
    }
  }
}
