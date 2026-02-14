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

const EMPTY_API_KEYS: ApiKeys = {
  falApiKey: "",
  freesoundApiKey: "",
  geminiApiKey: "",
  openRouterApiKey: "",
  anthropicApiKey: "",
};

function getEmptyApiKeys(): ApiKeys {
  return { ...EMPTY_API_KEYS };
}

function getApiKeysFilePath(): string {
  try {
    const userDataPath = app.getPath("userData");
    return path.join(userDataPath, "api-keys.json");
  } catch (error) {
    console.error("[API Keys] Failed to resolve userData path:", error);
    return path.join(process.cwd(), "api-keys.json");
  }
}

function decryptStoredValue({ encryptedValue }: { encryptedValue?: string }): string {
  if (!encryptedValue) {
    return "";
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return encryptedValue;
  }

  try {
    return safeStorage.decryptString(Buffer.from(encryptedValue, "base64"));
  } catch {
    return encryptedValue;
  }
}

function decryptStoredApiKeys({ encryptedData }: { encryptedData: EncryptedApiKeyData }): ApiKeys {
  try {
    return {
      falApiKey: decryptStoredValue({ encryptedValue: encryptedData.falApiKey }),
      freesoundApiKey: decryptStoredValue({
        encryptedValue: encryptedData.freesoundApiKey,
      }),
      geminiApiKey: decryptStoredValue({ encryptedValue: encryptedData.geminiApiKey }),
      openRouterApiKey: decryptStoredValue({
        encryptedValue: encryptedData.openRouterApiKey,
      }),
      anthropicApiKey: decryptStoredValue({
        encryptedValue: encryptedData.anthropicApiKey,
      }),
    };
  } catch (error) {
    console.error("[API Keys] Failed to decrypt API keys:", error);
    return getEmptyApiKeys();
  }
}

export async function getDecryptedApiKeys(): Promise<ApiKeys> {
  const apiKeysFilePath = getApiKeysFilePath();

  try {
    if (!fs.existsSync(apiKeysFilePath)) {
      return getEmptyApiKeys();
    }

    const rawData = fs.readFileSync(apiKeysFilePath, "utf8");
    const encryptedData = JSON.parse(rawData) as EncryptedApiKeyData;
    return decryptStoredApiKeys({ encryptedData });
  } catch (error) {
    console.error("[API Keys] Failed to load API keys:", error);
    return getEmptyApiKeys();
  }
}

/**
 * Setup API key-related IPC handlers for Electron
 * Uses Electron's safeStorage for encrypted key storage
 */
export function setupApiKeyIPC(): void {
  const apiKeysFilePath = getApiKeysFilePath();

  /**
   * Get stored API keys (decrypted)
   */
  ipcMain.handle("api-keys:get", async (): Promise<ApiKeys> => {
    return getDecryptedApiKeys();
  });

  /**
   * Store API keys (encrypted)
   */
  ipcMain.handle(
    "api-keys:set",
    async (_event: IpcMainInvokeEvent, keys: ApiKeyData): Promise<boolean> => {
      console.log("[API Keys] Save request received");

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
        console.log("[API Keys] Encryption available:", encryptionAvailable);

        if (encryptionAvailable) {
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

          if (geminiApiKey) {
            const encryptedGemini: Buffer =
              safeStorage.encryptString(geminiApiKey);
            dataToStore.geminiApiKey = encryptedGemini.toString("base64");
          } else {
            dataToStore.geminiApiKey = "";
          }

          if (openRouterApiKey) {
            const encryptedOpenRouter: Buffer =
              safeStorage.encryptString(openRouterApiKey);
            dataToStore.openRouterApiKey = encryptedOpenRouter.toString("base64");
          } else {
            dataToStore.openRouterApiKey = "";
          }

          if (anthropicApiKey) {
            const encryptedAnthropic: Buffer =
              safeStorage.encryptString(anthropicApiKey);
            dataToStore.anthropicApiKey = encryptedAnthropic.toString("base64");
          } else {
            dataToStore.anthropicApiKey = "";
          }
        } else {
          console.log("[API Keys] Encryption unavailable, storing plain text");
          dataToStore.falApiKey = falApiKey;
          dataToStore.freesoundApiKey = freesoundApiKey;
          dataToStore.geminiApiKey = geminiApiKey;
          dataToStore.openRouterApiKey = openRouterApiKey;
          dataToStore.anthropicApiKey = anthropicApiKey;
        }

        const dir: string = path.dirname(apiKeysFilePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(apiKeysFilePath, JSON.stringify(dataToStore, null, 2), {
          mode: 0o600,
        });

        return true;
      } catch (error: any) {
        console.error("[API Keys] Error saving:", error);
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
      return true;
    } catch (error: any) {
      throw new Error(`Failed to clear API keys: ${error?.message || error}`);
    }
  });
}

// CommonJS export for backward compatibility with main.js
module.exports = { setupApiKeyIPC, getDecryptedApiKeys };

// ES6 export for TypeScript files
export default { setupApiKeyIPC, getDecryptedApiKeys };
export type { ApiKeys, ApiKeyData, ApiKeyHandlers };
