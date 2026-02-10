/**
 * Main Process IPC Handlers
 *
 * All inline ipcMain.handle() registrations extracted from main.ts.
 * Covers: audio/video temp saves, shell ops, GitHub stars, FAL uploads,
 * file dialogs, file I/O, storage, FFmpeg resources, updates, and release notes.
 *
 * @module electron/main-ipc
 */

import {
  ipcMain,
  dialog,
  shell,
  app,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import * as fs from "fs";
import * as path from "path";
import {
  parseReleaseNote as _parseReleaseNote,
  readReleaseNotesFromDir,
} from "./release-notes-utils.js";

// Re-use the shared parseReleaseNote helper
const parseReleaseNote = _parseReleaseNote;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReleaseNote {
  version: string;
  date: string;
  channel: string;
  content: string;
}

interface Logger {
  log(message?: any, ...optionalParams: any[]): void;
  error(message?: any, ...optionalParams: any[]): void;
  warn(message?: any, ...optionalParams: any[]): void;
  info(message?: any, ...optionalParams: any[]): void;
}

interface AutoUpdater {
  checkForUpdatesAndNotify(): Promise<any>;
  quitAndInstall(): void;
}

/** Dependencies injected from main.ts */
export interface MainIpcDeps {
  getMainWindow: () => BrowserWindow | null;
  logger: Logger;
  autoUpdater: AutoUpdater | null;
  getReleasesDir: () => string;
  readChangelogFallback: () => ReleaseNote[];
}

// ---------------------------------------------------------------------------
// FAL content-type maps (shared across video/image/audio upload handlers)
// ---------------------------------------------------------------------------

const FAL_CONTENT_TYPES: Record<string, Record<string, string>> = {
  video: {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    m4v: "video/x-m4v",
  },
  image: {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
  },
  audio: {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    aac: "audio/aac",
    ogg: "audio/ogg",
    flac: "audio/flac",
    m4a: "audio/mp4",
  },
};

const FAL_DEFAULTS: Record<string, string> = {
  video: "video/mp4",
  image: "image/png",
  audio: "audio/mpeg",
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerMainIpcHandlers(deps: MainIpcDeps): void {
  const {
    getMainWindow,
    logger,
    autoUpdater,
    getReleasesDir,
    readChangelogFallback,
  } = deps;

  // ==========================================================================
  // Audio & Video temp handlers
  // ==========================================================================

  ipcMain.handle(
    "audio:save-temp",
    async (
      _event: IpcMainInvokeEvent,
      audioData: Uint8Array,
      filename: string
    ): Promise<string> => {
      const { saveAudioToTemp } = require("./audio-temp-handler.js");
      try {
        const filePath = await saveAudioToTemp(audioData, filename);
        return filePath;
      } catch (error: any) {
        logger.error("Failed to save audio to temp:", error);
        throw new Error(`Failed to save audio: ${error.message}`);
      }
    }
  );

  ipcMain.handle(
    "save-audio-for-export",
    async (
      _event: IpcMainInvokeEvent,
      { audioData, filename }: { audioData: any; filename: string }
    ) => {
      const { saveAudioToTemp } = require("./audio-temp-handler.js");
      try {
        const filePath = await saveAudioToTemp(audioData, filename);
        return { success: true, path: filePath };
      } catch (error: any) {
        logger.error("Failed to save audio file:", error);
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle(
    "video:save-temp",
    async (
      _event: IpcMainInvokeEvent,
      videoData: Uint8Array,
      filename: string,
      sessionId?: string
    ): Promise<string> => {
      const { saveVideoToTemp } = require("./video-temp-handler.js");
      try {
        const filePath = await saveVideoToTemp(videoData, filename, sessionId);
        logger.log(`[Video Temp] Saved video to: ${filePath}`);
        return filePath;
      } catch (error: any) {
        logger.error("[Video Temp] Failed to save video:", error);
        throw new Error(`Failed to save video: ${error.message}`);
      }
    }
  );

  // ==========================================================================
  // Shell & GitHub
  // ==========================================================================

  ipcMain.handle(
    "shell:showItemInFolder",
    async (_event: IpcMainInvokeEvent, filePath: string): Promise<void> => {
      shell.showItemInFolder(filePath);
    }
  );

  ipcMain.handle("fetch-github-stars", async (): Promise<{ stars: number }> => {
    try {
      const https = require("https");
      return new Promise((resolve) => {
        https
          .get(
            "https://api.github.com/repos/donghaozhang/qcut",
            {
              headers: { "User-Agent": "QCut-Video-Editor" },
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
                } catch {
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

  // ==========================================================================
  // FAL upload handlers (shared 2-step signed-URL flow)
  // ==========================================================================

  /** Shared FAL 2-step upload: initiate signed URL, then PUT the file. */
  async function falUpload(
    tag: string,
    data: Uint8Array,
    filename: string,
    apiKey: string,
    mediaType: string
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      logger.info(`[FAL ${tag}] Starting upload: ${filename}`);
      logger.info(`[FAL ${tag}] File size: ${data.length} bytes`);

      const ext = filename.toLowerCase().split(".").pop();
      const contentType =
        FAL_CONTENT_TYPES[mediaType]?.[ext ?? ""] ??
        FAL_DEFAULTS[mediaType] ??
        "application/octet-stream";

      const initResponse = await fetch(
        "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
        {
          method: "POST",
          headers: {
            Authorization: `Key ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            file_name: filename,
            content_type: contentType,
          }),
        }
      );

      if (!initResponse.ok) {
        const errorText = await initResponse.text();
        logger.error(
          `[FAL ${tag}] Initiate failed: ${initResponse.status} - ${errorText}`
        );
        return {
          success: false,
          error: `Upload initiate failed: ${initResponse.status} - ${errorText}`,
        };
      }

      const initData = (await initResponse.json()) as {
        upload_url?: string;
        file_url?: string;
      };
      const { upload_url, file_url } = initData;

      if (!upload_url || !file_url) {
        logger.error(`[FAL ${tag}] Missing URLs in response`);
        return {
          success: false,
          error: "FAL API did not return upload URLs",
        };
      }

      logger.info(`[FAL ${tag}] Step 2: Uploading to signed URL...`);

      const uploadResponse = await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: Buffer.from(data),
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        logger.error(
          `[FAL ${tag}] Upload failed: ${uploadResponse.status} - ${errorText}`
        );
        return {
          success: false,
          error: `Upload failed: ${uploadResponse.status} - ${errorText}`,
        };
      }

      logger.info(`[FAL ${tag}] Success! File URL: ${file_url}`);
      return { success: true, url: file_url };
    } catch (error: any) {
      logger.error(`[FAL ${tag}] Error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  ipcMain.handle(
    "fal:upload-video",
    async (
      _event: IpcMainInvokeEvent,
      data: Uint8Array,
      filename: string,
      apiKey: string
    ) => falUpload("Upload", data, filename, apiKey, "video")
  );

  ipcMain.handle(
    "fal:upload-image",
    async (
      _event: IpcMainInvokeEvent,
      data: Uint8Array,
      filename: string,
      apiKey: string
    ) => falUpload("Image Upload", data, filename, apiKey, "image")
  );

  ipcMain.handle(
    "fal:upload-audio",
    async (
      _event: IpcMainInvokeEvent,
      data: Uint8Array,
      filename: string,
      apiKey: string
    ) => falUpload("Audio Upload", data, filename, apiKey, "audio")
  );

  ipcMain.handle(
    "fal:queue-fetch",
    async (
      _event: IpcMainInvokeEvent,
      url: string,
      apiKey: string
    ): Promise<{ ok: boolean; status: number; data: unknown }> => {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Key ${apiKey}` },
        });
        const data = await response.json().catch(() => ({}));
        return { ok: response.ok, status: response.status, data };
      } catch (error: any) {
        logger.error(`[FAL Queue] Fetch error: ${error.message}`);
        return { ok: false, status: 0, data: { error: error.message } };
      }
    }
  );

  // ==========================================================================
  // File dialog handlers
  // ==========================================================================

  ipcMain.handle(
    "open-file-dialog",
    async (): Promise<Electron.OpenDialogReturnValue> => {
      const result = await dialog.showOpenDialog(getMainWindow()!, {
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
          { name: "All Files", extensions: ["*"] },
        ],
      });
      return result;
    }
  );

  ipcMain.handle(
    "open-multiple-files-dialog",
    async (): Promise<Electron.OpenDialogReturnValue> => {
      const result = await dialog.showOpenDialog(getMainWindow()!, {
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
          { name: "All Files", extensions: ["*"] },
        ],
      });
      return result;
    }
  );

  ipcMain.handle(
    "save-file-dialog",
    async (
      _event: IpcMainInvokeEvent,
      defaultFilename?: string,
      filters?: Electron.FileFilter[]
    ): Promise<Electron.SaveDialogReturnValue> => {
      const result = await dialog.showSaveDialog(getMainWindow()!, {
        defaultPath: defaultFilename,
        filters: filters || [
          { name: "Video Files", extensions: ["mp4"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      return result;
    }
  );

  // ==========================================================================
  // File I/O handlers
  // ==========================================================================

  ipcMain.handle(
    "read-file",
    async (
      _event: IpcMainInvokeEvent,
      filePath: string
    ): Promise<Buffer | null> => {
      try {
        return await fs.promises.readFile(filePath);
      } catch (error: any) {
        logger.error("Error reading file:", error);
        return null;
      }
    }
  );

  ipcMain.handle(
    "write-file",
    async (
      _event: IpcMainInvokeEvent,
      filePath: string,
      data: string | Buffer
    ): Promise<boolean> => {
      try {
        await fs.promises.writeFile(filePath, data);
        return true;
      } catch (error: any) {
        logger.error("Error writing file:", error);
        return false;
      }
    }
  );

  ipcMain.handle(
    "save-blob",
    async (
      _event: IpcMainInvokeEvent,
      data: Buffer | Uint8Array,
      defaultFilename?: string
    ): Promise<{
      success: boolean;
      filePath?: string;
      canceled?: boolean;
      error?: string;
    }> => {
      try {
        const result = await dialog.showSaveDialog(getMainWindow()!, {
          defaultPath: defaultFilename || "download.zip",
          filters: [
            { name: "ZIP Files", extensions: ["zip"] },
            { name: "All Files", extensions: ["*"] },
          ],
        });

        if (!result.canceled && result.filePath) {
          await fs.promises.writeFile(result.filePath, Buffer.from(data));
          return { success: true, filePath: result.filePath };
        }

        return { success: false, canceled: true };
      } catch (error: any) {
        logger.error("Save blob error:", error);
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle(
    "file-exists",
    async (_event: IpcMainInvokeEvent, filePath: string): Promise<boolean> => {
      try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        return true;
      } catch {
        return false;
      }
    }
  );

  ipcMain.handle(
    "validate-audio-file",
    async (_event: IpcMainInvokeEvent, filePath: string) => {
      const { spawn } = require("child_process");

      try {
        const { getFFprobePath } = require("./ffmpeg-handler.js");
        const ffprobePath = getFFprobePath();

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
    }
  );

  ipcMain.handle(
    "get-file-info",
    async (_event: IpcMainInvokeEvent, filePath: string) => {
      try {
        const stats = await fs.promises.stat(filePath);
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
    }
  );

  // ==========================================================================
  // Storage handlers
  // ==========================================================================

  ipcMain.handle(
    "storage:save",
    async (
      _event: IpcMainInvokeEvent,
      key: string,
      data: any
    ): Promise<void> => {
      try {
        const safeKey = path.basename(key);
        const userDataPath = app.getPath("userData");
        const filePath = path.join(userDataPath, "projects", `${safeKey}.json`);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, JSON.stringify(data));
      } catch (error: unknown) {
        logger.error(`[Storage] Failed to save key "${key}":`, error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    "storage:load",
    async (_event: IpcMainInvokeEvent, key: string): Promise<any> => {
      try {
        const safeKey = path.basename(key);
        const userDataPath = app.getPath("userData");
        const filePath = path.join(userDataPath, "projects", `${safeKey}.json`);
        const data = await fs.promises.readFile(filePath, "utf8");
        if (!data || !data.trim()) {
          return null;
        }
        return JSON.parse(data);
      } catch (error: any) {
        if (error.code === "ENOENT") return null;
        if (error instanceof SyntaxError) {
          logger.error(
            `[Storage] Corrupted JSON file for key "${key}":`,
            error.message
          );
          return null;
        }
        throw error;
      }
    }
  );

  ipcMain.handle(
    "storage:remove",
    async (_event: IpcMainInvokeEvent, key: string): Promise<void> => {
      try {
        const safeKey = path.basename(key);
        const userDataPath = app.getPath("userData");
        const filePath = path.join(userDataPath, "projects", `${safeKey}.json`);
        await fs.promises.unlink(filePath);
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  );

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

  // ==========================================================================
  // FFmpeg resource handlers
  // ==========================================================================

  ipcMain.handle(
    "get-ffmpeg-resource-path",
    (_event: IpcMainInvokeEvent, filename: string): string => {
      const resourcesPath = path.join(
        __dirname,
        "resources",
        "ffmpeg",
        filename
      );
      if (fs.existsSync(resourcesPath)) {
        return resourcesPath;
      }

      const distPath = path.join(
        __dirname,
        "../../apps/web/dist/ffmpeg",
        filename
      );
      return distPath;
    }
  );

  ipcMain.handle(
    "check-ffmpeg-resource",
    (_event: IpcMainInvokeEvent, filename: string): boolean => {
      const resourcesPath = path.join(
        __dirname,
        "resources",
        "ffmpeg",
        filename
      );
      if (fs.existsSync(resourcesPath)) {
        return true;
      }

      const distPath = path.join(
        __dirname,
        "../../apps/web/dist/ffmpeg",
        filename
      );
      return fs.existsSync(distPath);
    }
  );

  // ==========================================================================
  // Update handlers
  // ==========================================================================

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

  // ==========================================================================
  // Release notes handlers
  // ==========================================================================

  ipcMain.handle(
    "get-release-notes",
    async (
      _: IpcMainInvokeEvent,
      version?: string
    ): Promise<ReleaseNote | null> => {
      try {
        const releasesDir = getReleasesDir();
        const filename = version ? `v${version}.md` : "latest.md";
        const filePath = path.join(releasesDir, filename);

        if (!fs.existsSync(filePath)) {
          return null;
        }

        const raw = fs.readFileSync(filePath, "utf-8");
        return parseReleaseNote(raw);
      } catch (error: any) {
        logger.error("Error reading release notes:", error);
        return null;
      }
    }
  );

  ipcMain.handle("get-changelog", async (): Promise<ReleaseNote[]> => {
    try {
      const releasesDir = getReleasesDir();
      const notes = readReleaseNotesFromDir(releasesDir);

      if (notes.length === 0) {
        return readChangelogFallback();
      }

      return notes;
    } catch (error: any) {
      logger.error("Error reading changelog:", error);
      return readChangelogFallback();
    }
  });
}
