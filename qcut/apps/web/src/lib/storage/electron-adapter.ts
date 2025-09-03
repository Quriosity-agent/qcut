import { StorageAdapter } from "./types";
import { handleStorageError } from "@/lib/error-handler";

export class ElectronStorageAdapter<T> implements StorageAdapter<T> {
  private prefix: string;

  constructor(dbName: string, storeName: string) {
    this.prefix = `${dbName}_${storeName}_`;
  }

  private getElectronAPI() {
    return (window as any)?.electronAPI;
  }

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
