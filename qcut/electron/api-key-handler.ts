import { ipcMain, safeStorage, app, IpcMainInvokeEvent } from "electron";
import path from "path";
import fs from "fs";

// Type definitions for API key management
interface ApiKeys {
  falApiKey: string;
  freesoundApiKey: string;
  geminiApiKey: string;
  openRouterApiKey: string;
  anthropicApiKey: string;
}

interface ApiKeyData {
  falApiKey?: string;
  freesoundApiKey?: string;
  geminiApiKey?: string;
  openRouterApiKey?: string;
  anthropicApiKey?: string;
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
        return { falApiKey: "", freesoundApiKey: "", geminiApiKey: "", openRouterApiKey: "", anthropicApiKey: "" };
      }

      const encryptedData: EncryptedApiKeyData = JSON.parse(
        fs.readFileSync(apiKeysFilePath, "utf8")
      );

      // Decrypt the stored keys if they exist and safeStorage is available
      const result: ApiKeys = {
        falApiKey: "",
        freesoundApiKey: "",
        geminiApiKey: "",
        openRouterApiKey: "",
        anthropicApiKey: "",
      };

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

      if (encryptedData.geminiApiKey && safeStorage.isEncryptionAvailable()) {
        try {
          const decryptedGemini: string = safeStorage.decryptString(
            Buffer.from(encryptedData.geminiApiKey, "base64")
          );
          result.geminiApiKey = decryptedGemini;
        } catch (error: any) {
          // Failed to decrypt Gemini API key, falling back to plain text
          // Fallback: treat stored value as plain text
          result.geminiApiKey = encryptedData.geminiApiKey || "";
        }
      } else {
        result.geminiApiKey = encryptedData.geminiApiKey || "";
      }

      if (encryptedData.openRouterApiKey && safeStorage.isEncryptionAvailable()) {
        try {
          const decryptedOpenRouter: string = safeStorage.decryptString(
            Buffer.from(encryptedData.openRouterApiKey, "base64")
          );
          result.openRouterApiKey = decryptedOpenRouter;
        } catch (error: any) {
          // Failed to decrypt OpenRouter API key, falling back to plain text
          // Fallback: treat stored value as plain text
          result.openRouterApiKey = encryptedData.openRouterApiKey || "";
        }
      } else {
        result.openRouterApiKey = encryptedData.openRouterApiKey || "";
      }

      if (encryptedData.anthropicApiKey && safeStorage.isEncryptionAvailable()) {
        try {
          const decryptedAnthropic: string = safeStorage.decryptString(
            Buffer.from(encryptedData.anthropicApiKey, "base64")
          );
          result.anthropicApiKey = decryptedAnthropic;
        } catch (error: any) {
          // Failed to decrypt Anthropic API key, falling back to plain text
          // Fallback: treat stored value as plain text
          result.anthropicApiKey = encryptedData.anthropicApiKey || "";
        }
      } else {
        result.anthropicApiKey = encryptedData.anthropicApiKey || "";
      }

      return result;
    } catch (error: any) {
      // Failed to load API keys
      return { falApiKey: "", freesoundApiKey: "", geminiApiKey: "", openRouterApiKey: "", anthropicApiKey: "" };
    }
  });

  /**
   * Store API keys (encrypted)
   */
  ipcMain.handle(
    "api-keys:set",
    async (event: IpcMainInvokeEvent, keys: ApiKeyData): Promise<boolean> => {
      console.log("[API Keys] 💾 Received save request");
      console.log("[API Keys] Keys received:", {
        falApiKey: keys.falApiKey
          ? `${keys.falApiKey.substring(0, 10)}... (${keys.falApiKey.length} chars)`
          : "empty",
        freesoundApiKey: keys.freesoundApiKey
          ? `${keys.freesoundApiKey.substring(0, 10)}... (${keys.freesoundApiKey.length} chars)`
          : "empty",
        geminiApiKey: keys.geminiApiKey
          ? `${keys.geminiApiKey.substring(0, 10)}... (${keys.geminiApiKey.length} chars)`
          : "empty",
        openRouterApiKey: keys.openRouterApiKey
          ? `${keys.openRouterApiKey.substring(0, 10)}... (${keys.openRouterApiKey.length} chars)`
          : "empty",
        anthropicApiKey: keys.anthropicApiKey
          ? `${keys.anthropicApiKey.substring(0, 10)}... (${keys.anthropicApiKey.length} chars)`
          : "empty",
      });

      try {
        const {
          falApiKey = "",
          freesoundApiKey = "",
          geminiApiKey = "",
          openRouterApiKey = "",
          anthropicApiKey = "",
        } = keys;

        const dataToStore: EncryptedApiKeyData = {};

        const encryptionAvailable = safeStorage.isEncryptionAvailable();
        console.log("[API Keys] 🔒 Encryption available:", encryptionAvailable);

        // Encrypt keys if safeStorage is available, otherwise store as plain text
        if (encryptionAvailable) {
          if (falApiKey) {
            const encryptedFal: Buffer = safeStorage.encryptString(falApiKey);
            dataToStore.falApiKey = encryptedFal.toString("base64");
            console.log("[API Keys] 🔐 FAL key encrypted");
          } else {
            dataToStore.falApiKey = "";
          }

          if (freesoundApiKey) {
            const encryptedFreesound: Buffer =
              safeStorage.encryptString(freesoundApiKey);
            dataToStore.freesoundApiKey = encryptedFreesound.toString("base64");
            console.log("[API Keys] 🔐 Freesound key encrypted");
          } else {
            dataToStore.freesoundApiKey = "";
          }

          if (geminiApiKey) {
            const encryptedGemini: Buffer =
              safeStorage.encryptString(geminiApiKey);
            dataToStore.geminiApiKey = encryptedGemini.toString("base64");
            console.log("[API Keys] 🔐 Gemini key encrypted");
          } else {
            dataToStore.geminiApiKey = "";
          }

          if (openRouterApiKey) {
            const encryptedOpenRouter: Buffer =
              safeStorage.encryptString(openRouterApiKey);
            dataToStore.openRouterApiKey = encryptedOpenRouter.toString("base64");
            console.log("[API Keys] 🔐 OpenRouter key encrypted");
          } else {
            dataToStore.openRouterApiKey = "";
          }

          if (anthropicApiKey) {
            const encryptedAnthropic: Buffer =
              safeStorage.encryptString(anthropicApiKey);
            dataToStore.anthropicApiKey = encryptedAnthropic.toString("base64");
            console.log("[API Keys] 🔐 Anthropic key encrypted");
          } else {
            dataToStore.anthropicApiKey = "";
          }
        } else {
          // Fallback to plain text storage if encryption is not available
          console.log(
            "[API Keys] ⚠️ Encryption not available, storing as plain text"
          );
          dataToStore.falApiKey = falApiKey;
          dataToStore.freesoundApiKey = freesoundApiKey;
          dataToStore.geminiApiKey = geminiApiKey;
          dataToStore.openRouterApiKey = openRouterApiKey;
          dataToStore.anthropicApiKey = anthropicApiKey;
        }

        // Ensure the directory exists
        const dir: string = path.dirname(apiKeysFilePath);
        console.log("[API Keys] 📁 Checking directory:", dir);
        if (!fs.existsSync(dir)) {
          console.log("[API Keys] 📁 Creating directory...");
          fs.mkdirSync(dir, { recursive: true });
        }

        // Write encrypted data to file with restrictive permissions
        console.log("[API Keys] 💾 Writing to file:", apiKeysFilePath);
        fs.writeFileSync(
          apiKeysFilePath,
          JSON.stringify(dataToStore, null, 2),
          { mode: 0o600 }
        );

        console.log("[API Keys] ✅ File written successfully");
        console.log(
          "[API Keys] 📝 File size:",
          fs.statSync(apiKeysFilePath).size,
          "bytes"
        );

        // Verify the file was written
        const savedData = JSON.parse(fs.readFileSync(apiKeysFilePath, "utf8"));
        console.log(
          "[API Keys] 🔍 Verification - Keys in file:",
          Object.keys(savedData)
        );

        return true;
      } catch (error: any) {
        console.error("[API Keys] ❌ Error saving:", error);
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
