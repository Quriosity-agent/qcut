const { ipcMain } = require("electron");
const https = require("https");
const path = require("path");

/**
 * Setup sound search IPC handlers
 * Handles Freesound API integration for sound search functionality
 */
function setupSoundIPC() {
  // Load environment variables if not already loaded
  try {
    require('dotenv').config({ path: path.join(__dirname, '../apps/web/.env.local') });
  } catch (error) {
    console.warn("⚠️ [Sound Handler] dotenv not available:", error.message);
  }

  // Handle sound search requests
  ipcMain.handle("sounds:search", async (event, searchParams) => {
    try {
      const FREESOUND_API_KEY = process.env.FREESOUND_API_KEY;
      if (!FREESOUND_API_KEY) {
        return { success: false, error: "Freesound API key not configured" };
      }

      const baseUrl = "https://freesound.org/apiv2/search/text/";
      
      // Build query parameters
      const params = new URLSearchParams({
        query: searchParams.q || "",
        token: FREESOUND_API_KEY,
        page: (searchParams.page || 1).toString(),
        page_size: (searchParams.page_size || 20).toString(),
        sort: searchParams.sort || "downloads_desc",
        fields: "id,name,description,url,previews,download,duration,filesize,type,channels,bitrate,bitdepth,samplerate,username,tags,license,created,num_downloads,avg_rating,num_ratings",
      });

      // Add sound effect filters
      if (searchParams.type === "effects" || !searchParams.type) {
        params.append("filter", "duration:[* TO 30.0]");
        params.append("filter", `avg_rating:[${searchParams.min_rating || 3} TO *]`);
        
        if (searchParams.commercial_only) {
          params.append("filter", 'license:("Attribution" OR "Creative Commons 0")');
        }
        
        params.append("filter", "tag:sound-effect OR tag:sfx OR tag:foley OR tag:ambient");
      }
      
      const finalUrl = `${baseUrl}?${params.toString()}`;
      
      // Make HTTPS request
      const response = await new Promise((resolve, reject) => {
        const req = https.get(finalUrl, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode,
              body: data,
              ok: res.statusCode >= 200 && res.statusCode < 300
            });
          });
        });
        
        req.on('error', reject);
        req.setTimeout(30000, () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
      });
      
      if (!response.ok) {
        return { success: false, error: "Failed to search sounds", status: response.statusCode };
      }
      
      const rawData = JSON.parse(response.body);
      
      // Transform results to match frontend expectations
      const transformedResults = rawData.results.map((result) => ({
        id: result.id,
        name: result.name,
        description: result.description,
        url: result.url,
        previewUrl: result.previews?.["preview-hq-mp3"] || result.previews?.["preview-lq-mp3"],
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
      
      return { success: true, data: responseData };
      
    } catch (error) {
      return { success: false, error: "Internal server error: " + error.message };
    }
  });
}

module.exports = { setupSoundIPC };