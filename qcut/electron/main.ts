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
const originalConsoleWarn = console.warn;
console.warn = (...args: any[]) => {
  const message = args[0];
  if (
    typeof message === "string" &&
    message.includes("Autofill.enable failed") &&
    message.includes("session not found")
  ) {
    return; // Suppress this specific warning
  }
  originalConsoleWarn.apply(console, args);
};

function setupAutoUpdater(): void {
  if (!autoUpdater) return;

  // Basic update handling for packaged app
  autoUpdater.on("update-available", () => {
    logger.log("🔄 [AutoUpdater] Update available, downloading...");
  });

  autoUpdater.on("update-downloaded", () => {
    logger.log("✅ [AutoUpdater] Update downloaded, will install on quit");
  });

  autoUpdater.on("error", (error: Error) => {
    logger.error("❌ [AutoUpdater] Error:", error);
  });

  // Check for updates (silent)
  autoUpdater.checkForUpdatesAndNotify().catch((error: Error) => {
    logger.warn("⚠️ [AutoUpdater] Check failed:", error.message);
  });
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
  // Replace CSP headers to ensure no conflicts
  session.defaultSession.webRequest.onHeadersReceived(
    (details: OnHeadersReceivedListenerDetails, callback: (response: HeadersReceivedResponse) => void) => {
      const responseHeaders = { ...details.responseHeaders };

      // Remove all existing CSP-related headers to ensure no conflicts
      Object.keys(responseHeaders).forEach((key: string) => {
        if (key.toLowerCase().includes("content-security-policy")) {
          delete responseHeaders[key];
        }
      });

      // Add comprehensive CSP policy
      responseHeaders["Content-Security-Policy"] = [
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: " +
          "http://localhost:8080 " +
          "https://freesound.org https://cdn.freesound.org " +
          "https://fal.run https://queue.fal.run " +
          "https://storage.googleapis.com " +
          "https://api.github.com " +
          "wss://socket.fal.run; " +
          "img-src 'self' data: blob: *; " +
          "media-src 'self' data: blob: *; " +
          "font-src 'self' data:; " +
          "worker-src 'self' blob:; " +
          "frame-src 'none';"
      ];

      callback({ cancel: false, responseHeaders });
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
  if (app.isPackaged) {
    // Production: load the built app
    const indexPath = path.join(__dirname, "../apps/web/dist/index.html");
    mainWindow.loadFile(indexPath);
  } else {
    // Development: load from Vite dev server
    mainWindow.loadURL("http://localhost:5173");
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
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

  ipcMain.handle("get-file-info", async (event: IpcMainInvokeEvent, filePath: string) => {
    try {
      const stats = fs.statSync(filePath);
      return {
        name: path.basename(filePath),
        path: filePath,
        size: stats.size,
        lastModified: stats.mtime,
        type: path.extname(filePath),
      };
    } catch (error: any) {
      logger.error("Error getting file info:", error);
      return null;
    }
  });

  // Storage IPC handlers (basic key-value storage)
  const storage = new Map<string, any>();

  ipcMain.handle("storage:save", async (event: IpcMainInvokeEvent, key: string, data: any): Promise<boolean> => {
    try {
      storage.set(key, data);
      return true;
    } catch (error: any) {
      logger.error("Storage save error:", error);
      return false;
    }
  });

  ipcMain.handle("storage:load", async (event: IpcMainInvokeEvent, key: string): Promise<any> => {
    return storage.get(key) || null;
  });

  ipcMain.handle("storage:remove", async (event: IpcMainInvokeEvent, key: string): Promise<boolean> => {
    return storage.delete(key);
  });

  ipcMain.handle("storage:list", async (): Promise<string[]> => {
    return Array.from(storage.keys());
  });

  ipcMain.handle("storage:clear", async (): Promise<boolean> => {
    storage.clear();
    return true;
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