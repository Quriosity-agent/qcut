import { StorageAdapter } from "./types";
import { handleStorageError } from "@/lib/error-handler";

export class ElectronStorageAdapter<T> implements StorageAdapter<T> {
  private prefix: string;

  constructor(dbName: string, storeName: string) {
    this.prefix = `${dbName}_${storeName}_`;
  }

  async get(key: string): Promise<T | null> {
    try {
      const fullKey = this.prefix + key;
      return await (window as any).electronAPI.storage.load(fullKey);
    } catch (error) {
      handleStorageError(error, "Get data from Electron storage", { 
        key,
        operation: 'get'
      });
      return null;
    }
  }

  async set(key: string, value: T): Promise<void> {
    try {
      const fullKey = this.prefix + key;
      await (window as any).electronAPI.storage.save(fullKey, value);
    } catch (error) {
      handleStorageError(error, "Save data to Electron storage", { 
        key,
        operation: 'set'
      });
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      const fullKey = this.prefix + key;
      await (window as any).electronAPI.storage.remove(fullKey);
    } catch (error) {
      handleStorageError(error, "Remove data from Electron storage", { 
        key,
        operation: 'remove'
      });
      throw error;
    }
  }

  async list(): Promise<string[]> {
    try {
      const allKeys = await (window as any).electronAPI.storage.list();
      return allKeys
        .filter((key: string) => key.startsWith(this.prefix))
        .map((key: string) => key.substring(this.prefix.length));
    } catch (error) {
      handleStorageError(error, "List Electron storage keys", { 
        operation: 'list'
      });
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      const allKeys = await (window as any).electronAPI.storage.list();
      const keysToRemove = allKeys.filter((key: string) =>
        key.startsWith(this.prefix)
      );
      await Promise.all(
        keysToRemove.map((key: string) =>
          (window as any).electronAPI.storage.remove(key)
        )
      );
    } catch (error) {
      handleStorageError(error, "Clear Electron storage", { 
        operation: 'clear'
      });
      throw error;
    }
  }
}
