/**
 * Claude Media API Handler
 * Provides media file management capabilities for Claude Code integration
 */

import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getMediaPath, isValidSourcePath, getMediaType, generateId, sanitizeFilename } from './utils/helpers.js';
import { claudeLog } from './utils/logger.js';
import type { MediaFile } from '../types/claude-api';

const HANDLER_NAME = 'Media';

/**
 * Generate a unique filename if file already exists
 * Appends numeric suffix: file.mp4 -> file_1.mp4 -> file_2.mp4
 */
async function getUniqueFilePath(dir: string, fileName: string): Promise<string> {
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
 * Internal function to list media files - shared between handlers
 */
async function listMediaFiles(projectId: string): Promise<MediaFile[]> {
  const mediaPath = getMediaPath(projectId);
  const files: MediaFile[] = [];
  
  try {
    // Check if directory exists
    try {
      await fs.access(mediaPath);
    } catch {
      claudeLog.info(HANDLER_NAME, 'Media directory does not exist, returning empty array');
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
      const deterministicId = `media_${Buffer.from(entry.name).toString('base64url')}`;
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
    claudeLog.error(HANDLER_NAME, 'Failed to list media:', error);
    return [];
  }
}

export function setupClaudeMediaIPC(): void {
  claudeLog.info(HANDLER_NAME, 'Setting up Media IPC handlers...');

  // ============================================================================
  // claude:media:list - List all media files in project
  // ============================================================================
  ipcMain.handle('claude:media:list', async (_event, projectId: string): Promise<MediaFile[]> => {
    claudeLog.info(HANDLER_NAME, `Listing media for project: ${projectId}`);
    return listMediaFiles(projectId);
  });

  // ============================================================================
  // claude:media:info - Get detailed info about a specific media file
  // ============================================================================
  ipcMain.handle('claude:media:info', async (_event, projectId: string, mediaId: string): Promise<MediaFile | null> => {
    claudeLog.info(HANDLER_NAME, `Getting info for media in project ${projectId}`);
    
    // For now, list all and find by ID
    // In production, you might want a more efficient lookup
    const allMedia = await listMediaFiles(projectId);
    return allMedia.find(m => m.id === mediaId) || null;
  });

  // ============================================================================
  // claude:media:import - Import media from source path
  // ============================================================================
  ipcMain.handle('claude:media:import', async (event, projectId: string, source: string): Promise<MediaFile | null> => {
    claudeLog.info(HANDLER_NAME, `Importing media from: ${source}`);

    // Security: Validate source path for import
    if (!isValidSourcePath(source)) {
      claudeLog.error(HANDLER_NAME, 'Source path failed security validation');
      return null;
    }

    const mediaPath = getMediaPath(projectId);

    try {
      // Verify source exists and is a file
      const sourceStat = await fs.stat(source);
      if (!sourceStat.isFile()) {
        claudeLog.error(HANDLER_NAME, 'Source is not a file');
        return null;
      }

      // Ensure media directory exists
      await fs.mkdir(mediaPath, { recursive: true });

      // Get filename and sanitize
      const fileName = sanitizeFilename(path.basename(source));
      if (!fileName) {
        claudeLog.error(HANDLER_NAME, 'Invalid filename');
        return null;
      }
      
      const ext = path.extname(fileName);
      const type = getMediaType(ext);
      if (!type) {
        claudeLog.error(HANDLER_NAME, `Unsupported media type: ${ext}`);
        return null;
      }
      
      // Get unique path to avoid overwriting existing files
      const destPath = await getUniqueFilePath(mediaPath, fileName);
      const actualFileName = path.basename(destPath);

      // Copy file
      await fs.copyFile(source, destPath);

      const stat = await fs.stat(destPath);

      // Use deterministic ID based on filename for consistent lookups (matches listMediaFiles)
      const mediaFile: MediaFile = {
        id: `media_${Buffer.from(actualFileName).toString('base64url')}`,
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
      claudeLog.error(HANDLER_NAME, 'Failed to import media:', error);
      return null;
    }
  });

  // ============================================================================
  // claude:media:delete - Delete a media file
  // ============================================================================
  ipcMain.handle('claude:media:delete', async (_event, projectId: string, mediaId: string): Promise<boolean> => {
    claudeLog.info(HANDLER_NAME, `Deleting media: ${mediaId}`);

    try {
      // Look up the file by ID
      const allMedia = await listMediaFiles(projectId);
      const mediaFile = allMedia.find(m => m.id === mediaId);

      if (!mediaFile) {
        claudeLog.warn(HANDLER_NAME, `Media not found: ${mediaId}`);
        return false;
      }

      // Delete the file
      await fs.unlink(mediaFile.path);
      claudeLog.info(HANDLER_NAME, `Successfully deleted: ${mediaFile.name}`);
      return true;
    } catch (error) {
      claudeLog.error(HANDLER_NAME, 'Failed to delete media:', error);
      return false;
    }
  });

  // ============================================================================
  // claude:media:rename - Rename a media file
  // ============================================================================
  ipcMain.handle('claude:media:rename', async (_event, projectId: string, mediaId: string, newName: string): Promise<boolean> => {
    claudeLog.info(HANDLER_NAME, `Renaming media ${mediaId} to: ${newName}`);

    const sanitizedName = sanitizeFilename(newName);
    if (!sanitizedName) {
      claudeLog.error(HANDLER_NAME, 'Invalid new filename');
      return false;
    }

    try {
      // Look up the file by ID
      const allMedia = await listMediaFiles(projectId);
      const mediaFile = allMedia.find(m => m.id === mediaId);

      if (!mediaFile) {
        claudeLog.warn(HANDLER_NAME, `Media not found: ${mediaId}`);
        return false;
      }

      // Preserve original extension
      const originalExt = path.extname(mediaFile.name);
      const newNameWithExt = sanitizedName.includes('.') ? sanitizedName : sanitizedName + originalExt;

      // Get unique path in case new name already exists
      const mediaPath = getMediaPath(projectId);
      const newPath = await getUniqueFilePath(mediaPath, newNameWithExt);

      // Rename the file
      await fs.rename(mediaFile.path, newPath);
      claudeLog.info(HANDLER_NAME, `Successfully renamed: ${mediaFile.name} -> ${path.basename(newPath)}`);
      return true;
    } catch (error) {
      claudeLog.error(HANDLER_NAME, 'Failed to rename media:', error);
      return false;
    }
  });

  claudeLog.info(HANDLER_NAME, 'Media IPC handlers registered');
}

// CommonJS export for main.ts compatibility
module.exports = { setupClaudeMediaIPC };
