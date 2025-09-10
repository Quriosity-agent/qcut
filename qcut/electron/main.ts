import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  session,
  shell,
  IpcMainInvokeEvent,
  WebRequestFilter,
  OnHeadersReceivedListenerDetails,
  HeadersReceivedResponse,
} from "electron";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";

// Type definitions
interface Logger {
  log(message?: any, ...optionalParams: any[]): void;
  error(message?: any, ...optionalParams: any[]): void;
  warn(message?: any, ...optionalParams: any[]): void;
  info(message?: any, ...optionalParams: any[]): void;
}

interface AutoUpdater {
  checkForUpdatesAndNotify(): Promise<any>;
  on(event: string, listener: (...args: any[]) => void): void;
  quitAndInstall(): void;
}

interface MimeTypeMap {
  [key: string]: string;
}

interface HandlerFunction {
  (): void;
}

// Initialize electron-log early
let log: any = null;
try {
  log = require("electron-log");
} catch (error) {
  // electron-log not available, will use fallback
}
const logger: Logger = log || console;

// Auto-updater - wrapped in try-catch for packaged builds
let autoUpdater: AutoUpdater | null = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch (error: any) {
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

// Import handlers (compiled TypeScript)
const { setupFFmpegIPC } = require("../dist/electron/ffmpeg-handler.js");
const { setupSoundIPC } = require("../dist/electron/sound-handler.js");
const { setupThemeIPC } = require("../dist/electron/theme-handler.js");
const { setupApiKeyIPC } = require("../dist/electron/api-key-handler.js");
let setupTranscribeHandlers: HandlerFunction | null = null;
try {
  setupTranscribeHandlers = require("../dist/electron/transcribe-handler.js");
} catch (err: any) {
  logger.warn("[Transcribe] handler not available:", err?.message || err);
}

let mainWindow: BrowserWindow | null = null;
let staticServer: http.Server | null = null;

// Suppress Electron DevTools Autofill errors
app.commandLine.appendSwitch("disable-features", "Autofill");

// ① Register app:// protocol with required privileges
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

function setupAutoUpdater(): void {
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

  autoUpdater.on("update-available", (info: any) => {
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

  autoUpdater.on("error", (err: Error) => {
    logger.error("❌ [AutoUpdater] Error:", err);
  });

  autoUpdater.on("download-progress", (progressObj: any) => {
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

  autoUpdater.on("update-downloaded", (info: any) => {
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

function createStaticServer(): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    let filePath = url.pathname;

    // Remove leading slash and decode URI
    filePath = decodeURIComponent(filePath.substring(1));

    // Determine the full file path based on the request
    let fullPath: string;
    if (filePath.startsWith("ffmpeg/")) {
      // Serve FFmpeg files from the dist directory
      fullPath = path.join(__dirname, "../apps/web/dist", filePath);
    } else {
      // Serve other static files from dist
      fullPath = path.join(__dirname, "../apps/web/dist", filePath);
    }

    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("File not found");
      return;
    }

    // Determine content type
    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes: MimeTypeMap = {
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

    fileStream.on("error", (error: Error) => {
      logger.error("[Static Server] Error reading file:", error);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal server error");
    });
  });

  server.listen(8080, "localhost", () => {
    logger.log("[Static Server] Started on http://localhost:8080");
  });

  return server;
}

function createWindow(): void {
  // ③ "Replace" rather than "append" CSP - completely override all existing CSP policies
  session.defaultSession.webRequest.onHeadersReceived(
    (details: OnHeadersReceivedListenerDetails, callback: (response: HeadersReceivedResponse) => void) => {
      const responseHeaders = { ...details.responseHeaders };

      // Delete all existing CSP-related headers to ensure no conflicts
      Object.keys(responseHeaders).forEach((key: string) => {
        if (key.toLowerCase().includes("content-security-policy")) {
          delete responseHeaders[key];
        }
      });

      // Set complete new CSP policy, exactly matching index.html meta tag
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

      // Add COOP/COEP headers to support SharedArrayBuffer (required for FFmpeg WASM)
      responseHeaders["Cross-Origin-Opener-Policy"] = ["same-origin"];
      responseHeaders["Cross-Origin-Embedder-Policy"] = ["require-corp"];

      callback({ responseHeaders });
    }
  );

  // Create the main window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, "../build/icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../dist/electron/preload.js"),
      webSecurity: true,
      // Allow CORS for external APIs while maintaining security
      webviewTag: false,
    },
  });

  // Load the app
  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // Use custom app protocol to avoid file:// restrictions
    mainWindow.loadURL("app://./index.html");
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Window event handlers
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
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
        callback({ path: ffmpegPath });
        return;
      }

      // Fallback to dist directory
      const distPath = path.join(basePath, "ffmpeg", filename);
      callback({ path: distPath });
    } else {
      // Handle other resources
      const filePath = path.join(basePath, url);
      callback({ path: filePath });
    }
  });

  // Start the static server to serve FFmpeg WASM files
  staticServer = createStaticServer();

  createWindow();
  setupFFmpegIPC(); // Add FFmpeg CLI support
  setupSoundIPC(); // Add sound search support
  setupThemeIPC(); // Add theme switching support
  setupApiKeyIPC(); // Add API key management support
  if (typeof setupTranscribeHandlers === "function") {
    setupTranscribeHandlers(); // Add transcription support
  } else {
    logger.warn("[Transcribe] Skipping setup; handler not initialized");
  }

  // Configure auto-updater for production builds
  if (app.isPackaged) {
    setupAutoUpdater();
  }

  // Add IPC handler for saving audio files for export
  ipcMain.handle(
    "save-audio-for-export",
    async (event: IpcMainInvokeEvent, { audioData, filename }: { audioData: any; filename: string }) => {
      const { saveAudioToTemp } = require("../dist/electron/audio-temp-handler.js");
      try {
        const filePath = await saveAudioToTemp(audioData, filename);
        return { success: true, path: filePath };
      } catch (error: any) {
        logger.error("Failed to save audio file:", error);
        return { success: false, error: error.message };
      }
    }
  );

  // Add IPC handler for GitHub API requests to bypass CORS
  ipcMain.handle("fetch-github-stars", async (): Promise<{ stars: number }> => {
    try {
      const https = require("https");
      return new Promise((resolve, reject) => {
        https
          .get(
            "https://api.github.com/repos/donghaozhang/qcut",
            {
              headers: {
                "User-Agent": "QCut-Video-Editor",
              },
            },
            (res: any) => {
              let data = "";
              res.on("data", (chunk: string) => {
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
            }
          )
          .on("error", (error: Error) => {
            logger.error("Failed to fetch GitHub stars:", error);
            resolve({ stars: 0 });
          });
      });
    } catch (error: any) {
      logger.error("Error fetching GitHub stars:", error);
      return { stars: 0 };
    }
  });

  // File operation IPC handlers
  ipcMain.handle("open-file-dialog", async (): Promise<Electron.OpenDialogReturnValue> => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile"],
      filters: [
        {
          name: "Video Files",
          extensions: [
            "mp4", "webm", "mov", "avi", "mkv", "wmv", "flv", "3gp", "m4v",
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

  ipcMain.handle("open-multiple-files-dialog", async (): Promise<Electron.OpenDialogReturnValue> => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Media Files",
          extensions: [
            "mp4", "webm", "mov", "avi", "mkv", "mp3", "wav", "jpg", "jpeg", "png", "gif",
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

  ipcMain.handle("save-file-dialog", async (
    event: IpcMainInvokeEvent,
    defaultFilename?: string,
    filters?: Electron.FileFilter[]
  ): Promise<Electron.SaveDialogReturnValue> => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: defaultFilename,
      filters: filters || [
        {
          name: "Video Files",
          extensions: ["mp4"],
        },
        {
          name: "All Files",
          extensions: ["*"],
        },
      ],
    });
    return result;
  });

  ipcMain.handle("read-file", async (event: IpcMainInvokeEvent, filePath: string): Promise<Buffer | null> => {
    try {
      return fs.readFileSync(filePath);
    } catch (error: any) {
      logger.error("Error reading file:", error);
      return null;
    }
  });

  ipcMain.handle("write-file", async (
    event: IpcMainInvokeEvent,
    filePath: string,
    data: string | Buffer
  ): Promise<boolean> => {
    try {
      fs.writeFileSync(filePath, data);
      return true;
    } catch (error: any) {
      logger.error("Error writing file:", error);
      return false;
    }
  });

  ipcMain.handle("file-exists", async (event: IpcMainInvokeEvent, filePath: string): Promise<boolean> => {
    try {
      fs.accessSync(filePath, fs.constants.F_OK);
      return true;
    } catch (error) {
      return false;
    }
  });

  ipcMain.handle("validate-audio-file", async (event: IpcMainInvokeEvent, filePath: string) => {
    const { spawn } = require("child_process");

    try {
      // Get ffprobe path (should be in same directory as ffmpeg)
      const { getFFmpegPath } = require("../dist/electron/ffmpeg-handler.js");
      const ffmpegPath = getFFmpegPath();
      const ffmpegDir = path.dirname(ffmpegPath);
      const ffprobePath = path.join(
        ffmpegDir,
        process.platform === "win32" ? "ffprobe.exe" : "ffprobe"
      );

      return new Promise((resolve) => {
        logger.log(`[Main] Running ffprobe on: ${filePath}`);
        logger.log(`[Main] ffprobe path: ${ffprobePath}`);

        const ffprobe = spawn(
          ffprobePath,
          [
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            filePath,
          ],
          { windowsHide: true }
        );

        // Add timeout
        const timeout = setTimeout(() => {
          logger.log("[Main] ffprobe timeout, killing process");
          ffprobe.kill();
          resolve({
            valid: false,
            error: "ffprobe timeout after 10 seconds",
          });
        }, 10_000);

        let stdout = "";
        let stderr = "";

        ffprobe.stdout.on("data", (data: any) => {
          stdout += data.toString();
        });

        ffprobe.stderr.on("data", (data: any) => {
          stderr += data.toString();
        });

        ffprobe.on("close", (code: number) => {
          clearTimeout(timeout);
          logger.log(`[Main] ffprobe finished with code: ${code}`);
          logger.log(`[Main] ffprobe stdout length: ${stdout.length}`);
          logger.log(`[Main] ffprobe stderr: ${stderr}`);

          if (code === 0 && stdout) {
            try {
              const info = JSON.parse(stdout);
              const hasAudio =
                info.streams &&
                info.streams.some((s: any) => s.codec_type === "audio");

              resolve({
                valid: true,
                info,
                hasAudio,
                duration: info.format?.duration || 0,
              });
            } catch (parseError: any) {
              resolve({
                valid: false,
                error: `Failed to parse ffprobe output: ${parseError.message}`,
                stderr,
              });
            }
          } else {
            resolve({
              valid: false,
              error: `ffprobe failed with code ${code}`,
              stderr,
            });
          }
        });

        ffprobe.on("error", (error: Error) => {
          clearTimeout(timeout);
          logger.log(`[Main] ffprobe spawn error: ${error.message}`);
          resolve({
            valid: false,
            error: `ffprobe spawn error: ${error.message}`,
          });
        });
      });
    } catch (error: any) {
      return {
        valid: false,
        error: `Validation setup failed: ${error.message}`,
      };
    }
  });

  ipcMain.handle("get-file-info", async (event: IpcMainInvokeEvent, filePath: string) => {
    try {
      const stats = fs.statSync(filePath);
      return {
        name: path.basename(filePath),
        path: filePath,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        lastModified: stats.mtime,
        type: path.extname(filePath),
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
      };
    } catch (error: any) {
      logger.error("Error getting file info:", error);
      throw error;
    }
  });

  // Storage IPC handlers with file persistence
  ipcMain.handle("storage:save", async (event: IpcMainInvokeEvent, key: string, data: any): Promise<void> => {
    const userDataPath = app.getPath("userData");
    const filePath = path.join(userDataPath, "projects", `${key}.json`);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(data));
  });

  ipcMain.handle("storage:load", async (event: IpcMainInvokeEvent, key: string): Promise<any> => {
    try {
      const userDataPath = app.getPath("userData");
      const filePath = path.join(userDataPath, "projects", `${key}.json`);
      const data = await fs.promises.readFile(filePath, "utf8");
      return JSON.parse(data);
    } catch (error: any) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  });

  ipcMain.handle("storage:remove", async (event: IpcMainInvokeEvent, key: string): Promise<void> => {
    try {
      const userDataPath = app.getPath("userData");
      const filePath = path.join(userDataPath, "projects", `${key}.json`);
      await fs.promises.unlink(filePath);
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  });

  ipcMain.handle("storage:list", async (): Promise<string[]> => {
    try {
      const userDataPath = app.getPath("userData");
      const projectsDir = path.join(userDataPath, "projects");
      const files = await fs.promises.readdir(projectsDir);
      return files
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(".json", ""));
    } catch (error: any) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  });

  ipcMain.handle("storage:clear", async (): Promise<void> => {
    try {
      const userDataPath = app.getPath("userData");
      const projectsDir = path.join(userDataPath, "projects");
      const files = await fs.promises.readdir(projectsDir);
      await Promise.all(
        files
          .filter((f) => f.endsWith(".json"))
          .map((f) => fs.promises.unlink(path.join(projectsDir, f)))
      );
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  });

  // FFmpeg resource IPC handlers
  ipcMain.handle("get-ffmpeg-resource-path", (event: IpcMainInvokeEvent, filename: string): string => {
    // Try resources/ffmpeg first (production)
    const resourcesPath = path.join(__dirname, "resources", "ffmpeg", filename);
    if (fs.existsSync(resourcesPath)) {
      return resourcesPath;
    }

    // Fallback to dist directory (development)
    const distPath = path.join(__dirname, "../apps/web/dist/ffmpeg", filename);
    return distPath;
  });

  ipcMain.handle("check-ffmpeg-resource", (event: IpcMainInvokeEvent, filename: string): boolean => {
    // Check resources/ffmpeg first (production)
    const resourcesPath = path.join(__dirname, "resources", "ffmpeg", filename);
    if (fs.existsSync(resourcesPath)) {
      return true;
    }

    // Check dist directory (development)
    const distPath = path.join(__dirname, "../apps/web/dist/ffmpeg", filename);
    return fs.existsSync(distPath);
  });

  // IPC handlers for manual update checks
  ipcMain.handle("check-for-updates", async (): Promise<any> => {
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
      const result = await autoUpdater.checkForUpdatesAndNotify();
      return {
        available: true,
        version: (result as any)?.updateInfo?.version || "unknown",
        message: "Checking for updates...",
      };
    } catch (error: any) {
      logger.error("Error checking for updates:", error);
      return {
        available: false,
        error: error.message,
        message: "Failed to check for updates",
      };
    }
  });

  ipcMain.handle("install-update", async (): Promise<any> => {
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
    } catch (error: any) {
      logger.error("Error installing update:", error);
      return { success: false, error: error.message };
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // Clean up audio temp files
    const { cleanupAllAudioFiles } = require("../dist/electron/audio-temp-handler.js");
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

// Export types for other modules
export type { Logger, AutoUpdater, MimeTypeMap, HandlerFunction };