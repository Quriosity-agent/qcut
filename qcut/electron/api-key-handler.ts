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

interface KeyStatus {
  set: boolean;
  source: "environment" | "electron" | "aicp-cli" | "not-set";
}

interface ApiKeysStatus {
  falApiKey: KeyStatus;
  freesoundApiKey: KeyStatus;
  geminiApiKey: KeyStatus;
  openRouterApiKey: KeyStatus;
  anthropicApiKey: KeyStatus;
}

interface ApiKeyHandlers {
  "api-keys:get": () => Promise<ApiKeys>;
  "api-keys:set": (keys: ApiKeyData) => Promise<boolean>;
  "api-keys:clear": () => Promise<boolean>;
  "api-keys:status": () => Promise<ApiKeysStatus>;
}

// AICP env var name → QCut ApiKeys field mapping
const AICP_KEY_MAP: Record<string, keyof ApiKeys> = {
  FAL_KEY: "falApiKey",
  GEMINI_API_KEY: "geminiApiKey",
  OPENROUTER_API_KEY: "openRouterApiKey",
};

// Reverse: QCut ApiKeys field → AICP env var name (for syncing to credentials.env)
const AICP_REVERSE_MAP: Partial<Record<keyof ApiKeys, string>> = {
  falApiKey: "FAL_KEY",
  geminiApiKey: "GEMINI_API_KEY",
  openRouterApiKey: "OPENROUTER_API_KEY",
};

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

function decryptStoredValue({
  encryptedValue,
}: {
  encryptedValue?: string;
}): string {
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

function decryptStoredApiKeys({
  encryptedData,
}: {
  encryptedData: EncryptedApiKeyData;
}): ApiKeys {
  try {
    return {
      falApiKey: decryptStoredValue({
        encryptedValue: encryptedData.falApiKey,
      }),
      freesoundApiKey: decryptStoredValue({
        encryptedValue: encryptedData.freesoundApiKey,
      }),
      geminiApiKey: decryptStoredValue({
        encryptedValue: encryptedData.geminiApiKey,
      }),
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

/**
 * Returns the platform-correct path to AICP's credential store.
 * macOS/Linux: ~/.config/video-ai-studio/credentials.env
 * Windows: %APPDATA%/video-ai-studio/credentials.env
 */
function getAicpCredentialsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "video-ai-studio", "credentials.env");
  }
  return path.join(home, ".config", "video-ai-studio", "credentials.env");
}

/**
 * Read AICP CLI credential store (Tier 3 fallback).
 * Parses ~/.config/video-ai-studio/credentials.env as KEY=VALUE lines.
 */
function loadAicpCredentials(): Partial<ApiKeys> {
  try {
    const credPath = getAicpCredentialsPath();
    if (!fs.existsSync(credPath)) return {};

    const content = fs.readFileSync(credPath, "utf-8");
    const keys: Partial<ApiKeys> = {};

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const name = trimmed.slice(0, eqIdx);
      const value = trimmed.slice(eqIdx + 1);
      const field = AICP_KEY_MAP[name];
      if (field && value) {
        keys[field] = value;
      }
    }
    return keys;
  } catch (error) {
    console.warn("[API Keys] Failed to read AICP credentials:", error);
    return {};
  }
}

/**
 * Sync AICP-compatible keys to the CLI credential store so external tools
 * (Claude Code, aicp CLI) can read them without Electron's safeStorage.
 * Preserves any existing keys in the file that QCut doesn't manage.
 */
function syncToAicpCredentials(keys: Partial<ApiKeys>): void {
  try {
    const credPath = getAicpCredentialsPath();

    // Read existing lines to preserve keys not managed by QCut
    const managedVars = new Set(Object.values(AICP_REVERSE_MAP));
    const preserved: string[] = [];
    if (fs.existsSync(credPath)) {
      for (const line of fs.readFileSync(credPath, "utf-8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const eqIdx = trimmed.indexOf("=");
        const varName = eqIdx > 0 ? trimmed.slice(0, eqIdx) : "";
        if (!managedVars.has(varName)) {
          preserved.push(line);
        }
      }
    }

    // Build new lines for AICP-mapped keys
    const newLines: string[] = [];
    for (const [field, envName] of Object.entries(AICP_REVERSE_MAP)) {
      const value = keys[field as keyof ApiKeys];
      if (value) {
        newLines.push(`${envName}=${value}`);
      }
    }

    const content = [...preserved, ...newLines].join("\n") + "\n";

    const dir = path.dirname(credPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(credPath, content, { mode: 0o600 });
    console.log("[API Keys] Synced to AICP credential store:", credPath);
  } catch (error) {
    console.warn("[API Keys] Failed to sync to AICP credentials:", error);
  }
}

/**
 * Load keys from QCut's Electron safeStorage store (Tier 2).
 */
async function loadElectronStoredKeys(): Promise<ApiKeys> {
  const apiKeysFilePath = getApiKeysFilePath();
  try {
    if (!fs.existsSync(apiKeysFilePath)) {
      return getEmptyApiKeys();
    }
    const rawData = fs.readFileSync(apiKeysFilePath, "utf8");
    const encryptedData = JSON.parse(rawData) as EncryptedApiKeyData;
    return decryptStoredApiKeys({ encryptedData });
  } catch (error) {
    console.error("[API Keys] Failed to load Electron stored keys:", error);
    return getEmptyApiKeys();
  }
}

/**
 * Get decrypted API keys with 3-tier fallback:
 *   1. Environment variables (handled at spawn time by ai-pipeline-handler)
 *   2. QCut Electron safeStorage store
 *   3. AICP CLI credential store (~/.config/video-ai-studio/credentials.env)
 */
export async function getDecryptedApiKeys(): Promise<ApiKeys> {
  const electronKeys = await loadElectronStoredKeys();
  const aicpKeys = loadAicpCredentials();

  return {
    falApiKey: electronKeys.falApiKey || aicpKeys.falApiKey || "",
    freesoundApiKey: electronKeys.freesoundApiKey || "",
    geminiApiKey: electronKeys.geminiApiKey || aicpKeys.geminiApiKey || "",
    openRouterApiKey:
      electronKeys.openRouterApiKey || aicpKeys.openRouterApiKey || "",
    anthropicApiKey: electronKeys.anthropicApiKey || "",
  };
}

/**
 * Setup API key-related IPC handlers for Electron
 * Uses Electron's safeStorage for encrypted key storage
 */
export function setupApiKeyIPC(): void {
  const apiKeysFilePath = getApiKeysFilePath();

  // Auto-sync existing encrypted keys to AICP credential store on startup
  // so CLI tools can access keys saved before syncToAicpCredentials was added.
  loadElectronStoredKeys()
    .then((keys) => {
      const hasKeys = keys.falApiKey || keys.geminiApiKey || keys.openRouterApiKey;
      if (hasKeys) {
        syncToAicpCredentials(keys);
      }
    })
    .catch((error) => {
      console.warn("[API Keys] Startup sync failed:", error);
    });

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
            dataToStore.openRouterApiKey =
              encryptedOpenRouter.toString("base64");
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

        fs.writeFileSync(
          apiKeysFilePath,
          JSON.stringify(dataToStore, null, 2),
          {
            mode: 0o600,
          }
        );

        // Sync plaintext keys to AICP credential store so CLI tools can read them
        syncToAicpCredentials({ falApiKey, geminiApiKey, openRouterApiKey });

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

  /**
   * Get key status with source info (env / electron / aicp-cli / not-set)
   */
  ipcMain.handle("api-keys:status", async (): Promise<ApiKeysStatus> => {
    const electronKeys = await loadElectronStoredKeys();
    const aicpKeys = loadAicpCredentials();

    function resolveStatus(envName: string, field: keyof ApiKeys): KeyStatus {
      if (process.env[envName]) return { set: true, source: "environment" };
      if (electronKeys[field]) return { set: true, source: "electron" };
      if (aicpKeys[field]) return { set: true, source: "aicp-cli" };
      return { set: false, source: "not-set" };
    }

    return {
      falApiKey: resolveStatus("FAL_KEY", "falApiKey"),
      freesoundApiKey: resolveStatus("FREESOUND_API_KEY", "freesoundApiKey"),
      geminiApiKey: resolveStatus("GEMINI_API_KEY", "geminiApiKey"),
      openRouterApiKey: resolveStatus("OPENROUTER_API_KEY", "openRouterApiKey"),
      anthropicApiKey: resolveStatus("ANTHROPIC_API_KEY", "anthropicApiKey"),
    };
  });
}

// CommonJS export for backward compatibility with main.js
module.exports = {
  setupApiKeyIPC,
  getDecryptedApiKeys,
  loadAicpCredentials,
  getAicpCredentialsPath,
};

export { loadAicpCredentials, getAicpCredentialsPath, loadElectronStoredKeys };
export type { ApiKeys, ApiKeyData, ApiKeyHandlers, KeyStatus, ApiKeysStatus };
