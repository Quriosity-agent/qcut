/**
 * FFmpeg Basic IPC Handlers
 *
 * Simple, stateless handlers for FFmpeg path, health, session management,
 * frame saving, and file operations.
 *
 * Location: electron/ffmpeg-basic-handlers.ts
 */

import { ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import path from "path";
import fs from "fs";
import type { TempManager } from "./temp-manager.js";

import type {
  FrameData,
  OpenFolderResult,
  FFmpegHealthResult,
  ExportSession,
} from "./ffmpeg/types";

import { getFFmpegPath } from "./ffmpeg/utils";

/**
 * Registers basic FFmpeg IPC handlers.
 *
 * Handles: ffmpeg-path, ffmpeg-health, create-export-session,
 * save-frame, read-output-file, cleanup-export-session, open-frames-folder
 */
export function setupBasicHandlers(
  tempManager: TempManager,
  getFFmpegHealth: () => Promise<FFmpegHealthResult>
): void {
  // Handle ffmpeg-path request
  ipcMain.handle("ffmpeg-path", async (): Promise<string> => {
    return getFFmpegPath();
  });

  // Handle ffmpeg health check request
  ipcMain.handle("ffmpeg-health", (): Promise<FFmpegHealthResult> => {
    return getFFmpegHealth();
  });

  // Create export session
  ipcMain.handle("create-export-session", async (): Promise<ExportSession> => {
    return tempManager.createExportSession();
  });

  // Save frame to disk
  ipcMain.handle(
    "save-frame",
    async (
      event: IpcMainInvokeEvent,
      { sessionId, frameName, data }: FrameData
    ): Promise<string> => {
      // Sanitize frameName to prevent path traversal
      const safeFrameName = path.basename(frameName);
      const frameDir: string = tempManager.getFrameDir(sessionId);
      const framePath: string = path.join(frameDir, safeFrameName);

      // Verify resolved path stays within frame directory
      const resolvedPath = path.resolve(framePath);
      if (!resolvedPath.startsWith(path.resolve(frameDir))) {
        throw new Error("Invalid frame path: path traversal detected");
      }

      const buffer: Buffer = Buffer.from(data, "base64");

      // Validate buffer
      if (!buffer || buffer.length < 100) {
        throw new Error(`Invalid PNG buffer: ${buffer.length} bytes`);
      }

      // Check PNG signature (first 8 bytes should be PNG signature)
      const pngSignature: Buffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      if (!buffer.subarray(0, 8).equals(pngSignature)) {
        console.warn(
          `[FFmpeg] Warning: Invalid PNG signature for frame ${safeFrameName}`
        );
      }

      fs.writeFileSync(framePath, buffer);

      return framePath;
    }
  );

  // Read output file
  ipcMain.handle(
    "read-output-file",
    async (event: IpcMainInvokeEvent, outputPath: string): Promise<Buffer> => {
      // Validate outputPath is within the temp export directory
      const resolvedOutput = path.resolve(outputPath);
      const tempDir = path.resolve(tempManager.getTempDir());
      if (!resolvedOutput.startsWith(tempDir)) {
        throw new Error("Invalid output path: must be within export directory");
      }
      return fs.readFileSync(outputPath);
    }
  );

  // Cleanup export session
  ipcMain.handle(
    "cleanup-export-session",
    async (event: IpcMainInvokeEvent, sessionId: string): Promise<void> => {
      tempManager.cleanup(sessionId);
    }
  );

  // Open frames folder in file explorer
  ipcMain.handle(
    "open-frames-folder",
    async (
      event: IpcMainInvokeEvent,
      sessionId: string
    ): Promise<OpenFolderResult> => {
      const frameDir: string = tempManager.getFrameDir(sessionId);
      await shell.openPath(frameDir);
      return { success: true, path: frameDir };
    }
  );
}
