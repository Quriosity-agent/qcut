const { ipcMain, safeStorage, app } = require("electron");
const path = require("path");
const fs = require("fs");

/**
 * Setup API key-related IPC handlers for Electron
 * Uses Electron's safeStorage for encrypted key storage
 */
function setupApiKeyIPC() {
  const userDataPath = app.getPath("userData");
  const apiKeysFilePath = path.join(userDataPath, "api-keys.json");

  /**
   * Get stored API keys (decrypted)
   */
  ipcMain.handle("api-keys:get", async () => {
    try {
      if (!fs.existsSync(apiKeysFilePath)) {
        return { falApiKey: "", freesoundApiKey: "" };
      }

      const encryptedData = JSON.parse(fs.readFileSync(apiKeysFilePath, "utf8"));
      
      // Decrypt the stored keys if they exist and safeStorage is available
      const result = {};
      
      if (encryptedData.falApiKey && safeStorage.isEncryptionAvailable()) {
        try {
          const decryptedFal = safeStorage.decryptString(Buffer.from(encryptedData.falApiKey, "base64"));
          result.falApiKey = decryptedFal;
        } catch (error) {
          console.warn("Failed to decrypt FAL API key:", error.message);
          // Fallback: treat stored value as plain text
          result.falApiKey = encryptedData.falApiKey || "";
        }
      } else {
        result.falApiKey = encryptedData.falApiKey || "";
      }

      if (encryptedData.freesoundApiKey && safeStorage.isEncryptionAvailable()) {
        try {
          const decryptedFreesound = safeStorage.decryptString(Buffer.from(encryptedData.freesoundApiKey, "base64"));
          result.freesoundApiKey = decryptedFreesound;
        } catch (error) {
          console.warn("Failed to decrypt Freesound API key:", error.message);
          // Fallback: treat stored value as plain text
          result.freesoundApiKey = encryptedData.freesoundApiKey || "";
        }
      } else {
        result.freesoundApiKey = encryptedData.freesoundApiKey || "";
      }

      return result;
    } catch (error) {
      console.error("Failed to load API keys:", error);
      return { falApiKey: "", freesoundApiKey: "" };
    }
  });

  /**
   * Store API keys (encrypted)
   */
  ipcMain.handle("api-keys:set", async (event, keys) => {
    try {
      const { falApiKey = "", freesoundApiKey = "" } = keys;
      
      const dataToStore = {};

      // Encrypt keys if safeStorage is available, otherwise store as plain text
      if (safeStorage.isEncryptionAvailable()) {
        if (falApiKey) {
          const encryptedFal = safeStorage.encryptString(falApiKey);
          dataToStore.falApiKey = encryptedFal.toString("base64");
        } else {
          dataToStore.falApiKey = "";
        }

        if (freesoundApiKey) {
          const encryptedFreesound = safeStorage.encryptString(freesoundApiKey);
          dataToStore.freesoundApiKey = encryptedFreesound.toString("base64");
        } else {
          dataToStore.freesoundApiKey = "";
        }
      } else {
        // Fallback to plain text storage if encryption is not available
        console.warn("⚠️ Encryption not available, storing API keys as plain text");
        dataToStore.falApiKey = falApiKey;
        dataToStore.freesoundApiKey = freesoundApiKey;
      }

      // Ensure the directory exists
      const dir = path.dirname(apiKeysFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write encrypted data to file
      fs.writeFileSync(apiKeysFilePath, JSON.stringify(dataToStore, null, 2));
      
      console.log("✅ API keys saved successfully");
      return true;
    } catch (error) {
      console.error("❌ Failed to save API keys:", error);
      throw new Error(`Failed to save API keys: ${error.message}`);
    }
  });

  /**
   * Clear all stored API keys
   */
  ipcMain.handle("api-keys:clear", async () => {
    try {
      if (fs.existsSync(apiKeysFilePath)) {
        fs.unlinkSync(apiKeysFilePath);
      }
      console.log("✅ API keys cleared successfully");
      return true;
    } catch (error) {
      console.error("❌ Failed to clear API keys:", error);
      throw new Error(`Failed to clear API keys: ${error.message}`);
    }
  });
}

module.exports = { setupApiKeyIPC };