/**
 * Claude Media API Handler
 * Provides media file management capabilities for Claude Code integration
 */

import { ipcMain } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import {
  getMediaPath,
  isValidSourcePath,
  getMediaType,
  generateId,
  sanitizeFilename,
} from "./utils/helpers.js";
import { claudeLog } from "./utils/logger.js";
import type { MediaFile } from "../types/claude-api";

const HANDLER_NAME = "Media";

/**
 * Generate a unique filename if file already exists
 * Appends numeric suffix: file.mp4 -> file_1.mp4 -> file_2.mp4
 */
async function getUniqueFilePath(
  dir: string,
  fileName: string
): Promise<string> {
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  let destPath = path.join(dir, fileName);
  let counter = 1;

  while (true) {
    try {
      await fs.access(destPath);
      // File exists, try next suffix
      destPath = path.join(dir, `${baseName}_${counter}${ext}`);
      counter++;
    } catch {
      // File doesn't exist, use this path
      return destPath;
    }
  }
}

/**
 * List media files in a project — shared between IPC and HTTP handlers
 */
export async function listMediaFiles(projectId: string): Promise<MediaFile[]> {
  const mediaPath = getMediaPath(projectId);
  const files: MediaFile[] = [];

  try {
    // Check if directory exists
    try {
      await fs.access(mediaPath);
    } catch {
      claudeLog.info(
        HANDLER_NAME,
        "Media directory does not exist, returning empty array"
      );
      return [];
    }

    const entries = await fs.readdir(mediaPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const filePath = path.join(mediaPath, entry.name);
      const stat = await fs.stat(filePath);
      const ext = path.extname(entry.name);

      const type = getMediaType(ext);
      if (!type) continue;

      // Use deterministic ID based on filename for consistent lookups
      const deterministicId = `media_${Buffer.from(entry.name).toString("base64url")}`;
      files.push({
        id: deterministicId,
        name: entry.name,
        type,
        path: filePath,
        size: stat.size,
        createdAt: stat.birthtimeMs,
        modifiedAt: stat.mtimeMs,
      });
    }

    claudeLog.info(HANDLER_NAME, `Found ${files.length} media files`);
    return files;
  } catch (error) {
    claudeLog.error(HANDLER_NAME, "Failed to list media:", error);
    return [];
  }
}

/**
 * Get info for a specific media file by ID
 */
export async function getMediaInfo(
  projectId: string,
  mediaId: string,
): Promise<MediaFile | null> {
  claudeLog.info(
    HANDLER_NAME,
    `Getting info for media in project ${projectId}`,
  );
  const allMedia = await listMediaFiles(projectId);
  return allMedia.find((m) => m.id === mediaId) || null;
}

/**
 * Import a media file from a source path into the project
 */
export async function importMediaFile(
  projectId: string,
  source: string,
): Promise<MediaFile | null> {
  claudeLog.info(HANDLER_NAME, `Importing media from: ${source}`);

  if (!isValidSourcePath(source)) {
    claudeLog.error(HANDLER_NAME, "Source path failed security validation");
    return null;
  }

  const mediaPath = getMediaPath(projectId);

  try {
    const sourceStat = await fs.stat(source);
    if (!sourceStat.isFile()) {
      claudeLog.error(HANDLER_NAME, "Source is not a file");
      return null;
    }

    await fs.mkdir(mediaPath, { recursive: true });

    const fileName = sanitizeFilename(path.basename(source));
    if (!fileName) {
      claudeLog.error(HANDLER_NAME, "Invalid filename");
      return null;
    }

    const ext = path.extname(fileName);
    const type = getMediaType(ext);
    if (!type) {
      claudeLog.error(HANDLER_NAME, `Unsupported media type: ${ext}`);
      return null;
    }

    const destPath = await getUniqueFilePath(mediaPath, fileName);
    const actualFileName = path.basename(destPath);

    await fs.copyFile(source, destPath);
    const stat = await fs.stat(destPath);

    const mediaFile: MediaFile = {
      id: `media_${Buffer.from(actualFileName).toString("base64url")}`,
      name: actualFileName,
      type,
      path: destPath,
      size: stat.size,
      createdAt: stat.birthtimeMs,
      modifiedAt: stat.mtimeMs,
    };

    claudeLog.info(HANDLER_NAME, `Successfully imported: ${fileName}`);
    return mediaFile;
  } catch (error) {
    claudeLog.error(HANDLER_NAME, "Failed to import media:", error);
    return null;
  }
}

/**
 * Delete a media file by ID
 */
export async function deleteMediaFile(
  projectId: string,
  mediaId: string,
): Promise<boolean> {
  claudeLog.info(HANDLER_NAME, `Deleting media: ${mediaId}`);

  try {
    const allMedia = await listMediaFiles(projectId);
    const mediaFile = allMedia.find((m) => m.id === mediaId);

    if (!mediaFile) {
      claudeLog.warn(HANDLER_NAME, `Media not found: ${mediaId}`);
      return false;
    }

    await fs.unlink(mediaFile.path);
    claudeLog.info(HANDLER_NAME, `Successfully deleted: ${mediaFile.name}`);
    return true;
  } catch (error) {
    claudeLog.error(HANDLER_NAME, "Failed to delete media:", error);
    return false;
  }
}

/**
 * Rename a media file by ID
 */
export async function renameMediaFile(
  projectId: string,
  mediaId: string,
  newName: string,
): Promise<boolean> {
  claudeLog.info(HANDLER_NAME, `Renaming media ${mediaId} to: ${newName}`);

  const sanitizedName = sanitizeFilename(newName);
  if (!sanitizedName) {
    claudeLog.error(HANDLER_NAME, "Invalid new filename");
    return false;
  }

  try {
    const allMedia = await listMediaFiles(projectId);
    const mediaFile = allMedia.find((m) => m.id === mediaId);

    if (!mediaFile) {
      claudeLog.warn(HANDLER_NAME, `Media not found: ${mediaId}`);
      return false;
    }

    const originalExt = path.extname(mediaFile.name);
    const newNameWithExt = sanitizedName.includes(".")
      ? sanitizedName
      : sanitizedName + originalExt;

    const mediaPath = getMediaPath(projectId);
    const newPath = await getUniqueFilePath(mediaPath, newNameWithExt);

    await fs.rename(mediaFile.path, newPath);
    claudeLog.info(
      HANDLER_NAME,
      `Successfully renamed: ${mediaFile.name} -> ${path.basename(newPath)}`,
    );
    return true;
  } catch (error) {
    claudeLog.error(HANDLER_NAME, "Failed to rename media:", error);
    return false;
  }
}

export function setupClaudeMediaIPC(): void {
  claudeLog.info(HANDLER_NAME, "Setting up Media IPC handlers...");

  ipcMain.handle(
    "claude:media:list",
    async (_event, projectId: string) => listMediaFiles(projectId),
  );

  ipcMain.handle(
    "claude:media:info",
    async (_event, projectId: string, mediaId: string) =>
      getMediaInfo(projectId, mediaId),
  );

  ipcMain.handle(
    "claude:media:import",
    async (_event, projectId: string, source: string) =>
      importMediaFile(projectId, source),
  );

  ipcMain.handle(
    "claude:media:delete",
    async (_event, projectId: string, mediaId: string) =>
      deleteMediaFile(projectId, mediaId),
  );

  ipcMain.handle(
    "claude:media:rename",
    async (_event, projectId: string, mediaId: string, newName: string) =>
      renameMediaFile(projectId, mediaId, newName),
  );

  claudeLog.info(HANDLER_NAME, "Media IPC handlers registered");
}

// CommonJS export for main.ts compatibility
module.exports = {
  setupClaudeMediaIPC,
  listMediaFiles,
  getMediaInfo,
  importMediaFile,
  deleteMediaFile,
  renameMediaFile,
};
