import { ipcMain, safeStorage, app, IpcMainInvokeEvent } from "electron";
import path from "path";
import fs from "fs";

// Type definitions for API key management
interface ApiKeys {
  falApiKey: string;
  freesoundApiKey: string;
}

interface ApiKeyData {
  falApiKey?: string;
  freesoundApiKey?: string;
}

interface EncryptedApiKeyData {
  [key: string]: string;
}

interface ApiKeyHandlers {
  "api-keys:get": () => Promise<ApiKeys>;
  "api-keys:set": (keys: ApiKeyData) => Promise<boolean>;
  "api-keys:clear": () => Promise<boolean>;
}

/**
 * Setup API key-related IPC handlers for Electron
 * Uses Electron's safeStorage for encrypted key storage
 */
export function setupApiKeyIPC(): void {
  const userDataPath: string = app.getPath("userData");
  const apiKeysFilePath: string = path.join(userDataPath, "api-keys.json");

  /**
   * Get stored API keys (decrypted)
   */
  ipcMain.handle("api-keys:get", async (): Promise<ApiKeys> => {
    try {
      if (!fs.existsSync(apiKeysFilePath)) {
        return { falApiKey: "", freesoundApiKey: "" };
      }

      const encryptedData: EncryptedApiKeyData = JSON.parse(
        fs.readFileSync(apiKeysFilePath, "utf8")
      );

      // Decrypt the stored keys if they exist and safeStorage is available
      const result: ApiKeys = { falApiKey: "", freesoundApiKey: "" };

      if (encryptedData.falApiKey && safeStorage.isEncryptionAvailable()) {
        try {
          const decryptedFal: string = safeStorage.decryptString(
            Buffer.from(encryptedData.falApiKey, "base64")
          );
          result.falApiKey = decryptedFal;
        } catch (error: any) {
          // Failed to decrypt FAL API key, falling back to plain text
          // Fallback: treat stored value as plain text
          result.falApiKey = encryptedData.falApiKey || "";
        }
      } else {
        result.falApiKey = encryptedData.falApiKey || "";
      }

      if (
        encryptedData.freesoundApiKey &&
        safeStorage.isEncryptionAvailable()
      ) {
        try {
          const decryptedFreesound: string = safeStorage.decryptString(
            Buffer.from(encryptedData.freesoundApiKey, "base64")
          );
          result.freesoundApiKey = decryptedFreesound;
        } catch (error: any) {
          // Failed to decrypt Freesound API key, falling back to plain text
          // Fallback: treat stored value as plain text
          result.freesoundApiKey = encryptedData.freesoundApiKey || "";
        }
      } else {
        result.freesoundApiKey = encryptedData.freesoundApiKey || "";
      }

      return result;
    } catch (error: any) {
      // Failed to load API keys
      return { falApiKey: "", freesoundApiKey: "" };
    }
  });

  /**
   * Store API keys (encrypted)
   */
  ipcMain.handle(
    "api-keys:set",
    async (event: IpcMainInvokeEvent, keys: ApiKeyData): Promise<boolean> => {
      try {
        const { falApiKey = "", freesoundApiKey = "" } = keys;

        const dataToStore: EncryptedApiKeyData = {};

        // Encrypt keys if safeStorage is available, otherwise store as plain text
        if (safeStorage.isEncryptionAvailable()) {
          if (falApiKey) {
            const encryptedFal: Buffer = safeStorage.encryptString(falApiKey);
            dataToStore.falApiKey = encryptedFal.toString("base64");
          } else {
            dataToStore.falApiKey = "";
          }

          if (freesoundApiKey) {
            const encryptedFreesound: Buffer =
              safeStorage.encryptString(freesoundApiKey);
            dataToStore.freesoundApiKey = encryptedFreesound.toString("base64");
          } else {
            dataToStore.freesoundApiKey = "";
          }
        } else {
          // Fallback to plain text storage if encryption is not available
          // Encryption not available, storing API keys as plain text
          dataToStore.falApiKey = falApiKey;
          dataToStore.freesoundApiKey = freesoundApiKey;
        }

        // Ensure the directory exists
        const dir: string = path.dirname(apiKeysFilePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Write encrypted data to file
        fs.writeFileSync(apiKeysFilePath, JSON.stringify(dataToStore, null, 2));

        // API keys saved successfully
        return true;
      } catch (error: any) {
        // Failed to save API keys
        throw new Error(`Failed to save API keys: ${error?.message || error}`);
      }
    }
  );

  /**
   * Clear all stored API keys
   */
  ipcMain.handle("api-keys:clear", async (): Promise<boolean> => {
    try {
      if (fs.existsSync(apiKeysFilePath)) {
        fs.unlinkSync(apiKeysFilePath);
      }
      // API keys cleared successfully
      return true;
    } catch (error: any) {
      // Failed to clear API keys
      throw new Error(`Failed to clear API keys: ${error?.message || error}`);
    }
  });
}

// CommonJS export for backward compatibility with main.js
module.exports = { setupApiKeyIPC };

// ES6 export for TypeScript files
export default { setupApiKeyIPC };
export type { ApiKeys, ApiKeyData, ApiKeyHandlers };
