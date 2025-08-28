const { ipcMain, app, safeStorage } = require("electron");
const https = require("https");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("node:url");

// Try to load electron-log, fallback to no-op if not available
let log;
try {
  log = require("electron-log");
} catch (error) {
  // Create a no-op logger to avoid console usage (per project guidelines)
  const noop = () => {};
  log = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
  };
}

/**
 * Get Freesound API key with fallback priority:
 * 1. User-configured key from settings (highest priority)
 * 2. Default embedded key
 * 3. Environment variable (development)
 */
async function getFreesoundApiKey() {
  log.info("=== GET API KEY DEBUG ===");

  // Priority 1: Try user-configured key first
  try {
    const userDataPath = app.getPath("userData");
    const apiKeysFilePath = path.join(userDataPath, "api-keys.json");
    log.info("[API Key] Checking user config at:", apiKeysFilePath);

    if (fs.existsSync(apiKeysFilePath)) {
      log.info("[API Key] User config file exists");
      const encryptedData = JSON.parse(
        fs.readFileSync(apiKeysFilePath, "utf8")
      );
      if (encryptedData.freesoundApiKey) {
        log.info("[API Key] Found freesoundApiKey in user config");
        // Decrypt if possible
        if (safeStorage.isEncryptionAvailable()) {
          try {
            const decrypted = safeStorage.decryptString(
              Buffer.from(encryptedData.freesoundApiKey, "base64")
            );
            if (decrypted) {
              log.info("[API Key] Successfully decrypted user key");
              log.info("[Sound Handler] Using user-configured API key");
              return decrypted;
            }
          } catch (e) {
            log.info(
              "[API Key] Decryption failed, trying plain text:",
              e.message
            );
            // Plain text fallback
            if (encryptedData.freesoundApiKey) {
              log.info("[API Key] Using plain text user key");
              log.info("[Sound Handler] Using user-configured API key (plain)");
              return encryptedData.freesoundApiKey;
            }
          }
        } else if (encryptedData.freesoundApiKey) {
          log.info("[API Key] Encryption not available, using plain text");
          log.info(
            "[Sound Handler] Using user-configured API key (no encryption)"
          );
          return encryptedData.freesoundApiKey;
        }
      } else {
        log.info("[API Key] No freesoundApiKey in user config");
      }
    } else {
      log.info("[API Key] User config file does not exist");
    }
  } catch (error) {
    log.error("[API Key] Error reading user config:", error);
    log.warn("[Sound Handler] Error reading stored API key:", error.message);
  }

  // Priority 2: Try default embedded key
  try {
    log.info(
      "[API Key] Trying to load default keys from ./config/default-keys"
    );
    const defaultKeys = require("./config/default-keys");
    log.info("[API Key] Default keys loaded:", !!defaultKeys);
    if (defaultKeys.FREESOUND_API_KEY) {
      log.info("[API Key] Found default FREESOUND_API_KEY");
      log.info("[Sound Handler] Using default embedded API key");
      return defaultKeys.FREESOUND_API_KEY;
    }
    log.info("[API Key] No FREESOUND_API_KEY in default config");
  } catch (error) {
    log.error("[API Key] Failed to load default keys:", error);
    log.warn("[Sound Handler] No default keys available:", error.message);

    // Fallback: Embedded key directly in code for packaged apps
    const EMBEDDED_DEFAULT_KEY = "h650BnTkps2suLENRVXD8LdADgrYzVm1dQxmxQqc";
    log.info("[API Key] Using hardcoded embedded default key");
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
  // Handle sound search requests - ENHANCED to match Next.js API exactly
  ipcMain.handle("sounds:search", async (event, searchParams) => {
    log.info("=== SOUND SEARCH DEBUG START ===");
    log.info(
      "[Sound Handler] Search request received:",
      JSON.stringify(searchParams)
    );

    try {
      // Validate input parameters (same validation as Next.js API)
      const {
        q: query,
        type = "effects",
        page = 1,
        page_size: pageSize = 20,
        sort = "downloads",
        min_rating = 3,
        commercial_only = true,
      } = searchParams;

      // Handle songs limitation (same as Next.js API)
      if (type === "songs") {
        return {
          success: false,
          error: "Songs are not available yet",
          message:
            "Song search functionality is coming soon. Try searching for sound effects instead.",
        };
      }

      log.info("[Sound Handler] Getting API key...");
      const FREESOUND_API_KEY = await getFreesoundApiKey();
      log.info(
        "[Sound Handler] API key available:",
        Boolean(FREESOUND_API_KEY)
      );

      if (!FREESOUND_API_KEY) {
        log.error("[Sound Handler] No API key found!");
        return {
          success: false,
          error: "Freesound API key not configured",
        };
      }

      const baseUrl = "https://freesound.org/apiv2/search/text/";

      // Use score sorting for search queries, downloads for top sounds (same as Next.js)
      const sortParam = query
        ? sort === "score"
          ? "score"
          : `${sort}_desc`
        : `${sort}_desc`;

      // Build query parameters (enhanced to match Next.js exactly)
      const params = new URLSearchParams({
        query: query || "",
        token: FREESOUND_API_KEY,
        page: page.toString(),
        page_size: pageSize.toString(),
        sort: sortParam,
        fields:
          "id,name,description,url,previews,download,duration,filesize,type,channels,bitrate,bitdepth,samplerate,username,tags,license,created,num_downloads,avg_rating,num_ratings",
      });

      // Always apply sound effect filters (same as Next.js API)
      if (type === "effects" || !type) {
        params.append("filter", "duration:[* TO 30.0]");
        params.append("filter", `avg_rating:[${min_rating} TO *]`);

        // Filter by license if commercial_only is true (enhanced from Next.js)
        if (commercial_only) {
          params.append(
            "filter",
            'license:("Attribution" OR "Creative Commons 0" OR "Attribution Noncommercial" OR "Attribution Commercial")'
          );
        }

        params.append(
          "filter",
          "tag:sound-effect OR tag:sfx OR tag:foley OR tag:ambient OR tag:nature OR tag:mechanical OR tag:electronic OR tag:impact OR tag:whoosh OR tag:explosion"
        );
      }

      const finalUrl = `${baseUrl}?${params.toString()}`;
      log.info(
        "[Sound Handler] Final URL (masked):",
        finalUrl.replace(FREESOUND_API_KEY, "***")
      );
      log.info(
        "[Sound Handler] Making request to:",
        finalUrl.replace(FREESOUND_API_KEY, "***")
      );

      // Make HTTPS request
      log.info("[Sound Handler] Starting HTTPS request...");
      const response = await new Promise((resolve, reject) => {
        const req = https.get(finalUrl, (res) => {
          log.info("[Sound Handler] Response status code:", res.statusCode);
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            log.info("[Sound Handler] Response data length:", data.length);
            if (res.statusCode !== 200) {
              log.error(
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
          log.error("[Sound Handler] Request error:", error);
          reject(error);
        });
        req.setTimeout(30_000, () => {
          log.error("[Sound Handler] Request timeout!");
          req.destroy();
          reject(new Error("Request timeout"));
        });
      });

      if (!response.ok) {
        log.error("[Sound Handler] API request failed!");
        log.error("[Sound Handler] Status:", response.statusCode);
        log.error("[Sound Handler] Body:", response.body.substring(0, 500));
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
        query: query || "",
        type: type || "effects",
        page,
        pageSize,
        sort,
        minRating: min_rating,
      };

      log.info(
        "[Sound Handler] Returning",
        transformedResults.length,
        "results"
      );
      log.info("=== SOUND SEARCH DEBUG END (SUCCESS) ===");

      // Return format that matches Next.js API exactly
      return {
        success: true,
        ...responseData, // Spread response data directly (matches Next.js format)
      };
    } catch (error) {
      log.error("=== SOUND SEARCH ERROR ===");
      log.error("[Sound Handler] Error type:", error.constructor.name);
      log.error("[Sound Handler] Error message:", error.message);
      log.error("[Sound Handler] Error stack:", error.stack);
      log.error("[Sound Handler] Full error:", error);
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
    log.info("[Sound Handler] Downloading preview for sound:", id);
    try {
      const tempDir = path.join(app.getPath("temp"), "qcut-previews");

      // Create temp directory if it doesn't exist
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Sanitize the ID to prevent path traversal
      const safeId = String(id).replace(/[^a-z0-9_-]/gi, "_");
      const fileName = `preview-${safeId}.mp3`;
      const filePath = path.join(tempDir, fileName);

      // Check if already cached
      if (fs.existsSync(filePath)) {
        log.info("[Sound Handler] Preview already cached:", filePath);
        return { success: true, path: pathToFileURL(filePath).href };
      }

      // Download the file
      return new Promise((resolve) => {
        // Validate URL for security
        let target;
        try {
          target = new URL(url);
        } catch {
          return resolve({ success: false, error: "Invalid URL" });
        }

        // Allow only HTTPS and specific Freesound domains
        const allowedHosts = ["freesound.org", "cdn.freesound.org"];
        const isAllowedHost = allowedHosts.some(
          (h) => target.hostname === h || target.hostname.endsWith(`.${h}`)
        );

        if (target.protocol !== "https:" || !isAllowedHost) {
          log.error("[Sound Handler] Blocked URL:", url);
          return resolve({
            success: false,
            error: "URL not allowed - must be HTTPS Freesound domain",
          });
        }

        const file = fs.createWriteStream(filePath);

        https
          .get(target, (response) => {
            if (response.statusCode !== 200) {
              log.error(
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
              log.info("[Sound Handler] Preview downloaded:", filePath);
              resolve({
                success: true,
                path: pathToFileURL(filePath).href,
              });
            });

            file.on("error", (err) => {
              fs.unlink(filePath, () => {}); // Delete partial file
              log.error("[Sound Handler] File write error:", err);
              resolve({
                success: false,
                error: err.message,
              });
            });
          })
          .on("error", (err) => {
            log.error("[Sound Handler] Download error:", err);
            resolve({
              success: false,
              error: err.message,
            });
          });
      });
    } catch (error) {
      log.error("[Sound Handler] Preview download error:", error);
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
