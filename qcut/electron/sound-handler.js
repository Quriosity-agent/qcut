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
    error: console.error
  };
}

/**
 * Get Freesound API key with fallback priority:
 * 1. User-configured key from settings (highest priority)
 * 2. Default embedded key
 * 3. Environment variable (development)
 */
async function getFreesoundApiKey() {
  // Priority 1: Try user-configured key first
  try {
    const userDataPath = app.getPath("userData");
    const apiKeysFilePath = path.join(userDataPath, "api-keys.json");
    
    if (fs.existsSync(apiKeysFilePath)) {
      const encryptedData = JSON.parse(fs.readFileSync(apiKeysFilePath, "utf8"));
      if (encryptedData.freesoundApiKey) {
        // Decrypt if possible
        if (safeStorage.isEncryptionAvailable()) {
          try {
            const decrypted = safeStorage.decryptString(Buffer.from(encryptedData.freesoundApiKey, "base64"));
            if (decrypted) {
              log.info("[Sound Handler] Using user-configured API key");
              return decrypted;
            }
          } catch (e) {
            // Plain text fallback
            if (encryptedData.freesoundApiKey) {
              log.info("[Sound Handler] Using user-configured API key (plain)");
              return encryptedData.freesoundApiKey;
            }
          }
        } else if (encryptedData.freesoundApiKey) {
          log.info("[Sound Handler] Using user-configured API key (no encryption)");
          return encryptedData.freesoundApiKey;
        }
      }
    }
  } catch (error) {
    log.warn("[Sound Handler] Error reading stored API key:", error.message);
  }
  
  // Priority 2: Try default embedded key
  try {
    const defaultKeys = require("./config/default-keys");
    if (defaultKeys.FREESOUND_API_KEY) {
      log.info("[Sound Handler] Using default embedded API key");
      return defaultKeys.FREESOUND_API_KEY;
    }
  } catch (error) {
    log.warn("[Sound Handler] No default keys available:", error.message);
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
    log.info("[Sound Handler] Search request received:", searchParams);
    try {
      const FREESOUND_API_KEY = await getFreesoundApiKey();
      log.info("[Sound Handler] API key available:", !!FREESOUND_API_KEY);
      if (!FREESOUND_API_KEY) {
        return { success: false, error: "Freesound API key not configured. Please configure it in Settings → API Keys" };
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
      log.info(
        "[Sound Handler] Making request to:",
        finalUrl.replace(FREESOUND_API_KEY, "***")
      );

      // Make HTTPS request
      const response = await new Promise((resolve, reject) => {
        const req = https.get(finalUrl, (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            resolve({
              statusCode: res.statusCode,
              body: data,
              ok: res.statusCode >= 200 && res.statusCode < 300,
            });
          });
        });

        req.on("error", reject);
        req.setTimeout(30_000, () => {
          req.destroy();
          reject(new Error("Request timeout"));
        });
      });

      if (!response.ok) {
        log.error(
          "[Sound Handler] API request failed:",
          response.statusCode,
          response.body
        );
        return {
          success: false,
          error: "Failed to search sounds",
          status: response.statusCode,
        };
      }

      log.info(
        "[Sound Handler] API request successful, parsing response..."
      );

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
      return { success: true, data: responseData };
    } catch (error) {
      log.error("[Sound Handler] Error occurred:", error);
      return {
        success: false,
        error: "Internal server error: " + error.message,
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
          message: "No API key provided" 
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
              body: data
            });
          });
        });
        
        req.on("error", reject);
        req.setTimeout(10000, () => {
          req.destroy();
          reject(new Error("Request timeout"));
        });
      });
      
      if (response.statusCode === 200) {
        log.info("[Sound Handler] API key is valid");
        return { 
          success: true, 
          message: "API key is valid" 
        };
      } else if (response.statusCode === 401) {
        log.warn("[Sound Handler] Invalid API key");
        return { 
          success: false, 
          message: "Invalid API key" 
        };
      } else {
        log.warn("[Sound Handler] Unexpected response:", response.statusCode);
        return { 
          success: false, 
          message: `Unexpected response: ${response.statusCode}` 
        };
      }
    } catch (error) {
      log.error("[Sound Handler] Test key error:", error);
      return { 
        success: false, 
        message: error.message || "Test failed" 
      };
    }
  });
}

module.exports = { setupSoundIPC };
