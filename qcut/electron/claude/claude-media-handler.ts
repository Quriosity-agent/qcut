/**
 * Claude Media API Handler
 * Provides media file management capabilities for Claude Code integration
 */

import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getMediaPath, isPathSafe, getMediaType, generateId, sanitizeFilename } from './utils/helpers';
import { claudeLog } from './utils/logger';
import type { MediaFile } from '../types/claude-api';

const HANDLER_NAME = 'Media';

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
      
      files.push({
        id: generateId('media'),
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
    
    const mediaPath = getMediaPath(projectId);
    
    try {
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
      
      const destPath = path.join(mediaPath, fileName);
      
      // Copy file
      await fs.copyFile(source, destPath);
      
      const stat = await fs.stat(destPath);
      
      const mediaFile: MediaFile = {
        id: generateId('media'),
        name: fileName,
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
  ipcMain.handle('claude:media:delete', async (event, projectId: string, mediaId: string): Promise<boolean> => {
    claudeLog.info(HANDLER_NAME, `Deleting media: ${mediaId}`);
    
    // Note: In a real implementation, you'd need to:
    // 1. Look up the file path from mediaId
    // 2. Check if it's used in the timeline
    // 3. Delete the file
    
    claudeLog.warn(HANDLER_NAME, 'Delete not fully implemented - needs media ID lookup');
    return false;
  });

  // ============================================================================
  // claude:media:rename - Rename a media file
  // ============================================================================
  ipcMain.handle('claude:media:rename', async (event, projectId: string, mediaId: string, newName: string): Promise<boolean> => {
    claudeLog.info(HANDLER_NAME, `Renaming media ${mediaId} to: ${newName}`);
    
    const sanitizedName = sanitizeFilename(newName);
    if (!sanitizedName) {
      claudeLog.error(HANDLER_NAME, 'Invalid new filename');
      return false;
    }
    
    // Note: In a real implementation, you'd need to:
    // 1. Look up the file path from mediaId
    // 2. Rename the file
    // 3. Update any timeline references
    
    claudeLog.warn(HANDLER_NAME, 'Rename not fully implemented - needs media ID lookup');
    return false;
  });

  claudeLog.info(HANDLER_NAME, 'Media IPC handlers registered');
}

// CommonJS export for main.ts compatibility
module.exports = { setupClaudeMediaIPC };
