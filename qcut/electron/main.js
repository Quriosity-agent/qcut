const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  session,
} = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
// Initialize electron-log early
let log = null;
try {
  log = require("electron-log");
} catch (error) {
  // electron-log not available, will use fallback
}
const logger = log || console;

// Auto-updater - wrapped in try-catch for packaged builds
let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch (error) {
  if (log) {
    log.warn(
      "⚠️ [AutoUpdater] electron-updater not available: %s",
      error.message
    );
  } else {
    logger.warn(
      "⚠️ [AutoUpdater] electron-updater not available:",
      error.message
    );
  }
}
const { setupFFmpegIPC } = require("./ffmpeg-handler.js");
const { setupSoundIPC } = require("./sound-handler.js");
const { setupThemeIPC } = require("./theme-handler.js");
const { setupApiKeyIPC } = require("./api-key-handler.js");

let mainWindow;
let staticServer;

// Suppress Electron DevTools Autofill errors
app.commandLine.appendSwitch("disable-features", "Autofill");

// ① 必须在 app.whenReady() 之前注册 app:// 协议，且支持 fetch API
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: false,
      allowServiceWorkers: true,
      stream: true,
    },
  },
]);

// Create HTTP server to serve static files including FFmpeg WASM
function createStaticServer() {
  const server = http.createServer((req, res) => {
    // Parse the URL to get the file path
    const url = new URL(req.url, `http://${req.headers.host}`);
    let filePath = url.pathname;

    // Remove leading slash and decode URI
    filePath = decodeURIComponent(filePath.substring(1));

    // Determine the full file path based on the request
    let fullPath;
    if (filePath.startsWith("ffmpeg/")) {
      // Serve FFmpeg files from the dist directory
      fullPath = path.join(__dirname, "../apps/web/dist", filePath);
    } else {
      // Serve other static files from dist
      fullPath = path.join(__dirname, "../apps/web/dist", filePath);
    }

    logger.log("[Static Server] Request:", req.url, "-> File:", fullPath);

    // Check if file exists
    fs.access(fullPath, fs.constants.F_OK, (err) => {
      if (err) {
        logger.log("[Static Server] File not found:", fullPath);
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("File not found");
        return;
      }

      // Determine content type
      const ext = path.extname(fullPath).toLowerCase();
      const mimeTypes = {
        ".js": "application/javascript",
        ".wasm": "application/wasm",
        ".json": "application/json",
        ".css": "text/css",
        ".html": "text/html",
      };
      const contentType = mimeTypes[ext] || "application/octet-stream";

      // Set CORS headers to allow cross-origin requests
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Content-Type", contentType);

      // Add Cross-Origin-Resource-Policy for COEP compatibility
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

      // Stream the file
      const fileStream = fs.createReadStream(fullPath);
      fileStream.pipe(res);

      fileStream.on("error", (error) => {
        logger.error("[Static Server] Error reading file:", error);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal server error");
      });
    });
  });

  server.listen(8080, "localhost", () => {
    logger.log("[Static Server] Started on http://localhost:8080");
  });

  return server;
}

function createWindow() {
  // 3️⃣ "替换" 而不是 "追加" CSP - 完全覆盖所有现有CSP策略
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };

    // 删除所有现有的CSP相关header，确保没有冲突
    Object.keys(responseHeaders).forEach((key) => {
      if (key.toLowerCase().includes("content-security-policy")) {
        delete responseHeaders[key];
      }
    });

    // 设置完整的新CSP策略，与index.html meta标签完全一致
    responseHeaders["Content-Security-Policy"] = [
      "default-src 'self' blob: data: app:; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: app:; " +
        "worker-src 'self' blob: app:; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "connect-src 'self' blob: app: http://localhost:8080 ws: wss: https://fonts.googleapis.com https://fonts.gstatic.com https://api.github.com https://fal.run https://fal.media https://v3.fal.media https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com https://freesound.org https://cdn.freesound.org; " +
        "media-src 'self' blob: data: app: https://freesound.org https://cdn.freesound.org; " +
        "img-src 'self' blob: data: app: https://fal.run https://fal.media https://v3.fal.media https://api.iconify.design https://api.simplesvg.com https://api.unisvg.com https://avatars.githubusercontent.com;",
    ];

    // 添加 COOP/COEP 头以支持 SharedArrayBuffer（FFmpeg WASM需要）
    responseHeaders["Cross-Origin-Opener-Policy"] = ["same-origin"];
    responseHeaders["Cross-Origin-Embedder-Policy"] = ["require-corp"];

    callback({ responseHeaders });
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, "../build/icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      webSecurity: true,
      // Allow CORS for external APIs while maintaining security
      webviewTag: false,
    },
  });

  // Load the Vite app
  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    // Use custom app protocol to avoid file:// restrictions
    mainWindow.loadURL("app://./index.html");
  }

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  // Register custom protocol for serving static files
  protocol.registerFileProtocol("app", (request, callback) => {
    let url = request.url.replace("app://", "").replace("app:/", "");
    
    // Clean up the URL
    if (url.startsWith("./")) {
      url = url.substring(2);
    }
    if (url.startsWith("/")) {
      url = url.substring(1);
    }
    
    // Default to index.html for root
    if (!url || url === "") {
      url = "index.html";
    }

    // Determine base path based on whether app is packaged
    const basePath = app.isPackaged
      ? path.join(app.getAppPath(), "apps/web/dist")
      : path.join(__dirname, "../apps/web/dist");

    // Handle FFmpeg resources specifically
    if (url.startsWith("ffmpeg/")) {
      const filename = url.replace("ffmpeg/", "");
      // In production, FFmpeg files are in resources/ffmpeg/
      const ffmpegPath = path.join(__dirname, "resources", "ffmpeg", filename);

      // Check if file exists in resources/ffmpeg, fallback to dist
      if (fs.existsSync(ffmpegPath)) {
        callback(ffmpegPath);
        return;
      }

      // Fallback to dist directory
      const distPath = path.join(basePath, "ffmpeg", filename);
      callback(distPath);
    } else {
      // Handle other resources
      const filePath = path.join(basePath, url);
      callback(filePath);
    }
  });

  // Start the static server to serve FFmpeg WASM files
  staticServer = createStaticServer();

  createWindow();
  setupFFmpegIPC(); // Add FFmpeg CLI support
  setupSoundIPC(); // Add sound search support
  setupThemeIPC(); // Add theme switching support
  setupApiKeyIPC(); // Add API key management support

  // Configure auto-updater for production builds
  if (app.isPackaged) {
    setupAutoUpdater();
  }
  
  // Add IPC handler for saving audio files for export
  ipcMain.handle('save-audio-for-export', async (event, { audioData, filename }) => {
    const { saveAudioToTemp } = require('./audio-temp-handler.js');
    try {
      const filePath = await saveAudioToTemp(audioData, filename);
      return { success: true, path: filePath };
    } catch (error) {
      logger.error('Failed to save audio file:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Add IPC handler for GitHub API requests to bypass CORS
  ipcMain.handle("fetch-github-stars", async () => {
    try {
      const https = require("https");
      return new Promise((resolve, reject) => {
        https.get("https://api.github.com/repos/donghaozhang/qcut", {
          headers: {
            "User-Agent": "QCut-Video-Editor"
          }
        }, (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              resolve({ stars: parsed.stargazers_count || 0 });
            } catch (error) {
              resolve({ stars: 0 });
            }
          });
        }).on("error", (error) => {
          logger.error("Failed to fetch GitHub stars:", error);
          resolve({ stars: 0 });
        });
      });
    } catch (error) {
      logger.error("Error fetching GitHub stars:", error);
      return { stars: 0 };
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // Clean up audio temp files
    const { cleanupAllAudioFiles } = require('./audio-temp-handler.js');
    cleanupAllAudioFiles();
    
    // Close the static server when quitting
    if (staticServer) {
      staticServer.close();
    }
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers for file operations
ipcMain.handle("open-file-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      {
        name: "Video Files",
        extensions: [
          "mp4",
          "webm",
          "mov",
          "avi",
          "mkv",
          "wmv",
          "flv",
          "3gp",
          "m4v",
        ],
      },
      {
        name: "Audio Files",
        extensions: ["mp3", "wav", "aac", "ogg", "flac", "m4a", "wma"],
      },
      {
        name: "Image Files",
        extensions: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"],
      },
      {
        name: "All Files",
        extensions: ["*"],
      },
    ],
  });
  return result;
});

ipcMain.handle("open-multiple-files-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Media Files",
        extensions: [
          "mp4",
          "webm",
          "mov",
          "avi",
          "mkv",
          "mp3",
          "wav",
          "jpg",
          "jpeg",
          "png",
          "gif",
        ],
      },
      {
        name: "All Files",
        extensions: ["*"],
      },
    ],
  });
  return result;
});

ipcMain.handle("save-file-dialog", async (event, defaultFilename, filters) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultFilename,
    filters: filters || [
      { name: "Video Files", extensions: ["mp4", "webm", "mov"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  return result;
});

ipcMain.handle("read-file", async (event, filePath) => {
  try {
    const data = await fs.promises.readFile(filePath);
    return data;
  } catch (error) {
    logger.error("Error reading file:", error);
    throw error;
  }
});

ipcMain.handle("write-file", async (event, filePath, data) => {
  try {
    await fs.promises.writeFile(filePath, data);
    return { success: true };
  } catch (error) {
    logger.error("Error writing file:", error);
    throw error;
  }
});

ipcMain.handle("file-exists", async (event, filePath) => {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
});

ipcMain.handle("validate-audio-file", async (event, filePath) => {
  const { spawn } = require('child_process');
  const path = require('path');
  
  try {
    // Get ffprobe path (should be in same directory as ffmpeg)
    const { getFFmpegPath } = require('./ffmpeg-handler.js');
    const ffmpegPath = getFFmpegPath();
    const ffmpegDir = path.dirname(ffmpegPath);
    const ffprobePath = path.join(ffmpegDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    
    return new Promise((resolve) => {
      console.log(`[Main] Running ffprobe on: ${filePath}`);
      console.log(`[Main] ffprobe path: ${ffprobePath}`);
      
      const ffprobe = spawn(ffprobePath, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ], { windowsHide: true });
      
      // Add timeout
      const timeout = setTimeout(() => {
        console.log(`[Main] ffprobe timeout, killing process`);
        ffprobe.kill();
        resolve({
          valid: false,
          error: 'ffprobe timeout after 10 seconds'
        });
      }, 10000);
      
      let stdout = '';
      let stderr = '';
      
      ffprobe.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      ffprobe.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ffprobe.on('close', (code) => {
        clearTimeout(timeout);
        console.log(`[Main] ffprobe finished with code: ${code}`);
        console.log(`[Main] ffprobe stdout length: ${stdout.length}`);
        console.log(`[Main] ffprobe stderr: ${stderr}`);
        
        if (code === 0 && stdout) {
          try {
            const info = JSON.parse(stdout);
            const hasAudio = info.streams && info.streams.some(s => s.codec_type === 'audio');
            
            resolve({
              valid: true,
              info: info,
              hasAudio: hasAudio,
              duration: info.format?.duration || 0
            });
          } catch (parseError) {
            resolve({
              valid: false,
              error: `Failed to parse ffprobe output: ${parseError.message}`,
              stderr: stderr
            });
          }
        } else {
          resolve({
            valid: false,
            error: `ffprobe failed with code ${code}`,
            stderr: stderr
          });
        }
      });
      
      ffprobe.on('error', (error) => {
        clearTimeout(timeout);
        console.log(`[Main] ffprobe spawn error: ${error.message}`);
        resolve({
          valid: false,
          error: `ffprobe spawn error: ${error.message}`
        });
      });
    });
  } catch (error) {
    return {
      valid: false,
      error: `Validation setup failed: ${error.message}`
    };
  }
});

ipcMain.handle("get-file-info", async (event, filePath) => {
  try {
    const stats = await fs.promises.stat(filePath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
    };
  } catch (error) {
    logger.error("Error getting file info:", error);
    throw error;
  }
});

// Storage IPC handlers
ipcMain.handle("storage:save", async (event, key, data) => {
  const userDataPath = app.getPath("userData");
  const filePath = path.join(userDataPath, "projects", `${key}.json`);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(data));
});

ipcMain.handle("storage:load", async (event, key) => {
  try {
    const userDataPath = app.getPath("userData");
    const filePath = path.join(userDataPath, "projects", `${key}.json`);
    const data = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
});

ipcMain.handle("storage:remove", async (event, key) => {
  try {
    const userDataPath = app.getPath("userData");
    const filePath = path.join(userDataPath, "projects", `${key}.json`);
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
});

ipcMain.handle("storage:list", async (event) => {
  try {
    const userDataPath = app.getPath("userData");
    const projectsDir = path.join(userDataPath, "projects");
    const files = await fs.promises.readdir(projectsDir);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
});

ipcMain.handle("storage:clear", async (event) => {
  try {
    const userDataPath = app.getPath("userData");
    const projectsDir = path.join(userDataPath, "projects");
    const files = await fs.promises.readdir(projectsDir);
    await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map((f) => fs.promises.unlink(path.join(projectsDir, f)))
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
});

// FFmpeg resource IPC handlers
ipcMain.handle("get-ffmpeg-resource-path", (event, filename) => {
  // Try resources/ffmpeg first (production)
  const resourcesPath = path.join(__dirname, "resources", "ffmpeg", filename);
  if (fs.existsSync(resourcesPath)) {
    return resourcesPath;
  }

  // Fallback to dist directory (development)
  const distPath = path.join(__dirname, "../apps/web/dist/ffmpeg", filename);
  return distPath;
});

ipcMain.handle("check-ffmpeg-resource", (event, filename) => {
  // Check resources/ffmpeg first (production)
  const resourcesPath = path.join(__dirname, "resources", "ffmpeg", filename);
  if (fs.existsSync(resourcesPath)) {
    return true;
  }

  // Check dist directory (development)
  const distPath = path.join(__dirname, "../apps/web/dist/ffmpeg", filename);
  return fs.existsSync(distPath);
});

// Auto-updater configuration and handlers
function setupAutoUpdater() {
  if (!autoUpdater) {
    logger.log("⚠️ [AutoUpdater] Auto-updater not available - skipping setup");
    return;
  }

  logger.log("🔄 [AutoUpdater] Setting up auto-updater...");

  // Configure auto-updater settings
  autoUpdater.checkForUpdatesAndNotify();

  // Auto-updater event handlers
  autoUpdater.on("checking-for-update", () => {
    logger.log("🔄 [AutoUpdater] Checking for updates...");
  });

  autoUpdater.on("update-available", (info) => {
    logger.log("📦 [AutoUpdater] Update available:", info.version);

    // Send to renderer process
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-available", {
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseDate: info.releaseDate,
      });
    }
  });

  autoUpdater.on("update-not-available", () => {
    logger.log("✅ [AutoUpdater] App is up to date");
  });

  autoUpdater.on("error", (err) => {
    logger.error("❌ [AutoUpdater] Error:", err);
  });

  autoUpdater.on("download-progress", (progressObj) => {
    const percent = Math.round(progressObj.percent);
    logger.log(`📥 [AutoUpdater] Download progress: ${percent}%`);

    // Send progress to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("download-progress", {
        percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
      });
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    logger.log("✅ [AutoUpdater] Update downloaded, will install on quit");

    // Send to renderer process
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-downloaded", {
        version: info.version,
      });
    }
  });

  // Check for updates every hour in production
  setInterval(
    () => {
      autoUpdater.checkForUpdatesAndNotify();
    },
    60 * 60 * 1000
  ); // 1 hour
}

// IPC handlers for manual update checks
ipcMain.handle("check-for-updates", async () => {
  if (!app.isPackaged) {
    return {
      available: false,
      message: "Updates only available in production builds",
    };
  }

  if (!autoUpdater) {
    return { available: false, message: "Auto-updater not available" };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      available: true,
      version: result?.updateInfo?.version || "unknown",
      message: "Checking for updates...",
    };
  } catch (error) {
    logger.error("Error checking for updates:", error);
    return {
      available: false,
      error: error.message,
      message: "Failed to check for updates",
    };
  }
});

ipcMain.handle("install-update", async () => {
  if (!app.isPackaged) {
    return {
      success: false,
      message: "Updates only available in production builds",
    };
  }

  if (!autoUpdater) {
    return { success: false, message: "Auto-updater not available" };
  }

  try {
    autoUpdater.quitAndInstall();
    return { success: true, message: "Installing update..." };
  } catch (error) {
    logger.error("Error installing update:", error);
    return { success: false, error: error.message };
  }
});
