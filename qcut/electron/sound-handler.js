const { ipcMain, app, safeStorage } = require("electron");
const https = require("https");
const path = require("path");
const fs = require("fs");

// Try to load electron-log, fallback to console if not available
let log;
try {
  log = require("electron-log");
} catch (error) {
  // Fallback to console for packaged apps where electron-log might not be available
  log = {
    info: console.log,
    warn: console.warn,
    error: console.error,
  };
}

/**
 * Get Freesound API key with fallback priority:
 * 1. User-configured key from settings (highest priority)
 * 2. Default embedded key
 * 3. Environment variable (development)
 */
async function getFreesoundApiKey() {
  console.log("=== GET API KEY DEBUG ===");

  // Priority 1: Try user-configured key first
  try {
    const userDataPath = app.getPath("userData");
    const apiKeysFilePath = path.join(userDataPath, "api-keys.json");
    console.log("[API Key] Checking user config at:", apiKeysFilePath);

    if (fs.existsSync(apiKeysFilePath)) {
      console.log("[API Key] User config file exists");
      const encryptedData = JSON.parse(
        fs.readFileSync(apiKeysFilePath, "utf8")
      );
      if (encryptedData.freesoundApiKey) {
        console.log("[API Key] Found freesoundApiKey in user config");
        // Decrypt if possible
        if (safeStorage.isEncryptionAvailable()) {
          try {
            const decrypted = safeStorage.decryptString(
              Buffer.from(encryptedData.freesoundApiKey, "base64")
            );
            if (decrypted) {
              console.log("[API Key] Successfully decrypted user key");
              log.info("[Sound Handler] Using user-configured API key");
              return decrypted;
            }
          } catch (e) {
            console.log(
              "[API Key] Decryption failed, trying plain text:",
              e.message
            );
            // Plain text fallback
            if (encryptedData.freesoundApiKey) {
              console.log("[API Key] Using plain text user key");
              log.info("[Sound Handler] Using user-configured API key (plain)");
              return encryptedData.freesoundApiKey;
            }
          }
        } else if (encryptedData.freesoundApiKey) {
          console.log("[API Key] Encryption not available, using plain text");
          log.info(
            "[Sound Handler] Using user-configured API key (no encryption)"
          );
          return encryptedData.freesoundApiKey;
        }
      } else {
        console.log("[API Key] No freesoundApiKey in user config");
      }
    } else {
      console.log("[API Key] User config file does not exist");
    }
  } catch (error) {
    console.error("[API Key] Error reading user config:", error);
    log.warn("[Sound Handler] Error reading stored API key:", error.message);
  }

  // Priority 2: Try default embedded key
  try {
    console.log(
      "[API Key] Trying to load default keys from ./config/default-keys"
    );
    const defaultKeys = require("./config/default-keys");
    console.log("[API Key] Default keys loaded:", !!defaultKeys);
    if (defaultKeys.FREESOUND_API_KEY) {
      console.log("[API Key] Found default FREESOUND_API_KEY");
      log.info("[Sound Handler] Using default embedded API key");
      return defaultKeys.FREESOUND_API_KEY;
    }
    console.log("[API Key] No FREESOUND_API_KEY in default config");
  } catch (error) {
    console.error("[API Key] Failed to load default keys:", error);
    log.warn("[Sound Handler] No default keys available:", error.message);

    // Fallback: Embedded key directly in code for packaged apps
    const EMBEDDED_DEFAULT_KEY = "h650BnTkps2suLENRVXD8LdADgrYzVm1dQxmxQqc";
    console.log("[API Key] Using hardcoded embedded default key");
    log.info("[Sound Handler] Using hardcoded embedded API key");
    return EMBEDDED_DEFAULT_KEY;
  }

  // Priority 3: Fall back to environment variable (development)
  if (process.env.FREESOUND_API_KEY) {
    log.info("[Sound Handler] Using environment variable API key");
    return process.env.FREESOUND_API_KEY;
  }

  // Priority 4: Try loading from .env.local files (legacy support)
  try {
    const dotenv = require("dotenv");
    const envPaths = [
      path.join(__dirname, "../apps/web/.env.local"),
      path.join(__dirname, "../.env.local"),
      path.join(__dirname, "../../apps/web/.env.local"),
    ];

    for (const envPath of envPaths) {
      const result = dotenv.config({ path: envPath });
      if (!result.error && process.env.FREESOUND_API_KEY) {
        log.info(`[Sound Handler] Loaded API key from: ${envPath}`);
        return process.env.FREESOUND_API_KEY;
      }
    }
  } catch (error) {
    log.warn("[Sound Handler] dotenv not available:", error.message);
  }

  return null;
}

/**
 * Setup sound search IPC handlers
 * Handles Freesound API integration for sound search functionality
 */
function setupSoundIPC() {
  // Handle sound search requests
  ipcMain.handle("sounds:search", async (event, searchParams) => {
    console.log("=== SOUND SEARCH DEBUG START ===");
    console.log(
      "[Sound Handler] Search request received:",
      JSON.stringify(searchParams)
    );
    log.info("[Sound Handler] Search request received:", searchParams);

    try {
      console.log("[Sound Handler] Getting API key...");
      const FREESOUND_API_KEY = await getFreesoundApiKey();
      console.log(
        "[Sound Handler] API key retrieved:",
        FREESOUND_API_KEY ? `${FREESOUND_API_KEY.substring(0, 10)}...` : "NONE"
      );
      log.info("[Sound Handler] API key available:", !!FREESOUND_API_KEY);

      if (!FREESOUND_API_KEY) {
        console.error("[Sound Handler] No API key found!");
        return {
          success: false,
          error:
            "Freesound API key not configured. Please configure it in Settings → API Keys",
        };
      }

      const baseUrl = "https://freesound.org/apiv2/search/text/";

      // Build query parameters
      const params = new URLSearchParams({
        query: searchParams.q || "",
        token: FREESOUND_API_KEY,
        page: (searchParams.page || 1).toString(),
        page_size: (searchParams.page_size || 20).toString(),
        sort: searchParams.sort || "downloads_desc",
        fields:
          "id,name,description,url,previews,download,duration,filesize,type,channels,bitrate,bitdepth,samplerate,username,tags,license,created,num_downloads,avg_rating,num_ratings",
      });

      // Add sound effect filters
      if (searchParams.type === "effects" || !searchParams.type) {
        params.append("filter", "duration:[* TO 30.0]");
        params.append(
          "filter",
          `avg_rating:[${searchParams.min_rating || 3} TO *]`
        );

        if (searchParams.commercial_only) {
          params.append(
            "filter",
            'license:("Attribution" OR "Creative Commons 0")'
          );
        }

        params.append(
          "filter",
          "tag:sound-effect OR tag:sfx OR tag:foley OR tag:ambient"
        );
      }

      const finalUrl = `${baseUrl}?${params.toString()}`;
      console.log(
        "[Sound Handler] Final URL (masked):",
        finalUrl.replace(FREESOUND_API_KEY, "***")
      );
      log.info(
        "[Sound Handler] Making request to:",
        finalUrl.replace(FREESOUND_API_KEY, "***")
      );

      // Make HTTPS request
      console.log("[Sound Handler] Starting HTTPS request...");
      const response = await new Promise((resolve, reject) => {
        const req = https.get(finalUrl, (res) => {
          console.log("[Sound Handler] Response status code:", res.statusCode);
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            console.log("[Sound Handler] Response data length:", data.length);
            if (res.statusCode !== 200) {
              console.error(
                "[Sound Handler] Response body:",
                data.substring(0, 500)
              );
            }
            resolve({
              statusCode: res.statusCode,
              body: data,
              ok: res.statusCode >= 200 && res.statusCode < 300,
            });
          });
        });

        req.on("error", (error) => {
          console.error("[Sound Handler] Request error:", error);
          reject(error);
        });
        req.setTimeout(30_000, () => {
          console.error("[Sound Handler] Request timeout!");
          req.destroy();
          reject(new Error("Request timeout"));
        });
      });

      if (!response.ok) {
        console.error("[Sound Handler] API request failed!");
        console.error("[Sound Handler] Status:", response.statusCode);
        console.error("[Sound Handler] Body:", response.body.substring(0, 500));
        log.error(
          "[Sound Handler] API request failed:",
          response.statusCode,
          response.body
        );

        let errorMessage = "Failed to search sounds";
        if (response.statusCode === 401) {
          errorMessage =
            "Invalid API key. Please check your API key in Settings → API Keys";
        } else if (response.statusCode === 403) {
          errorMessage = "API key rate limit exceeded. Please try again later";
        } else if (response.statusCode === 404) {
          errorMessage = "API endpoint not found";
        } else if (response.statusCode >= 500) {
          errorMessage = "Freesound server error. Please try again later";
        }

        return {
          success: false,
          error: `${errorMessage} (Status: ${response.statusCode})`,
          status: response.statusCode,
        };
      }

      log.info("[Sound Handler] API request successful, parsing response...");

      const rawData = JSON.parse(response.body);

      // Transform results to match frontend expectations
      const transformedResults = rawData.results.map((result) => ({
        id: result.id,
        name: result.name,
        description: result.description,
        url: result.url,
        previewUrl:
          result.previews?.["preview-hq-mp3"] ||
          result.previews?.["preview-lq-mp3"],
        downloadUrl: result.download,
        duration: result.duration,
        filesize: result.filesize,
        type: result.type,
        channels: result.channels,
        bitrate: result.bitrate,
        bitdepth: result.bitdepth,
        samplerate: result.samplerate,
        username: result.username,
        tags: result.tags,
        license: result.license,
        created: result.created,
        downloads: result.num_downloads || 0,
        rating: result.avg_rating || 0,
        ratingCount: result.num_ratings || 0,
      }));

      const responseData = {
        count: rawData.count,
        next: rawData.next,
        previous: rawData.previous,
        results: transformedResults,
        query: searchParams.q || "",
        type: searchParams.type || "effects",
        page: searchParams.page || 1,
        pageSize: searchParams.page_size || 20,
        sort: searchParams.sort || "downloads_desc",
        minRating: searchParams.min_rating || 3,
      };

      log.info(
        "[Sound Handler] Returning",
        transformedResults.length,
        "results"
      );
      console.log("=== SOUND SEARCH DEBUG END (SUCCESS) ===");
      return { success: true, data: responseData };
    } catch (error) {
      console.error("=== SOUND SEARCH ERROR ===");
      console.error("[Sound Handler] Error type:", error.constructor.name);
      console.error("[Sound Handler] Error message:", error.message);
      console.error("[Sound Handler] Error stack:", error.stack);
      console.error("[Sound Handler] Full error:", error);
      log.error("[Sound Handler] Error occurred:", error);

      // Provide more specific error messages
      let errorMessage = error.message || "Unknown error occurred";
      if (error.code === "ENOTFOUND") {
        errorMessage =
          "Cannot connect to Freesound. Check your internet connection";
      } else if (error.code === "ETIMEDOUT") {
        errorMessage = "Request timed out. Check your internet connection";
      } else if (error.message.includes("Request timeout")) {
        errorMessage = "Request timed out after 30 seconds";
      }

      return {
        success: false,
        error: `Sound search failed: ${errorMessage}`,
      };
    }
  });

  // Download and cache audio preview
  ipcMain.handle("sounds:download-preview", async (event, { url, id }) => {
    console.log("[Sound Handler] Downloading preview for sound:", id);
    try {
      const tempDir = path.join(app.getPath("temp"), "qcut-previews");

      // Create temp directory if it doesn't exist
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const fileName = `preview-${id}.mp3`;
      const filePath = path.join(tempDir, fileName);

      // Check if already cached
      if (fs.existsSync(filePath)) {
        console.log("[Sound Handler] Preview already cached:", filePath);
        return { success: true, path: `file://${filePath}` };
      }

      // Download the file
      return new Promise((resolve) => {
        const file = fs.createWriteStream(filePath);

        https
          .get(url, (response) => {
            if (response.statusCode !== 200) {
              console.error(
                "[Sound Handler] Preview download failed:",
                response.statusCode
              );
              resolve({
                success: false,
                error: `Download failed: ${response.statusCode}`,
              });
              return;
            }

            response.pipe(file);

            file.on("finish", () => {
              file.close();
              console.log("[Sound Handler] Preview downloaded:", filePath);
              resolve({
                success: true,
                path: `file://${filePath}`,
              });
            });

            file.on("error", (err) => {
              fs.unlink(filePath, () => {}); // Delete partial file
              console.error("[Sound Handler] File write error:", err);
              resolve({
                success: false,
                error: err.message,
              });
            });
          })
          .on("error", (err) => {
            console.error("[Sound Handler] Download error:", err);
            resolve({
              success: false,
              error: err.message,
            });
          });
      });
    } catch (error) {
      console.error("[Sound Handler] Preview download error:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // Test API key validity
  ipcMain.handle("sounds:test-key", async (event, apiKey) => {
    log.info("[Sound Handler] Testing API key validity");
    try {
      if (!apiKey) {
        return {
          success: false,
          message: "No API key provided",
        };
      }

      const testUrl = `https://freesound.org/apiv2/search/text/?query=test&token=${apiKey}&page_size=1`;

      const response = await new Promise((resolve, reject) => {
        const req = https.get(testUrl, (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            resolve({
              statusCode: res.statusCode,
              body: data,
            });
          });
        });

        req.on("error", reject);
        req.setTimeout(10_000, () => {
          req.destroy();
          reject(new Error("Request timeout"));
        });
      });

      if (response.statusCode === 200) {
        log.info("[Sound Handler] API key is valid");
        return {
          success: true,
          message: "API key is valid",
        };
      }
      if (response.statusCode === 401) {
        log.warn("[Sound Handler] Invalid API key");
        return {
          success: false,
          message: "Invalid API key",
        };
      }
      log.warn("[Sound Handler] Unexpected response:", response.statusCode);
      return {
        success: false,
        message: `Unexpected response: ${response.statusCode}`,
      };
    } catch (error) {
      log.error("[Sound Handler] Test key error:", error);
      return {
        success: false,
        message: error.message || "Test failed",
      };
    }
  });
}

module.exports = { setupSoundIPC };
