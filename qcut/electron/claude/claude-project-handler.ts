/**
 * Claude Project API Handler
 * Provides project settings read/write capabilities for Claude Code integration
 */

import { ipcMain, BrowserWindow, IpcMainInvokeEvent, IpcMainEvent } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getProjectPath, getProjectSettingsPath } from './utils/helpers.js';
import { claudeLog } from './utils/logger.js';
import type { ProjectSettings, ProjectStats } from '../types/claude-api';

const HANDLER_NAME = 'Project';

export function setupClaudeProjectIPC(): void {
  claudeLog.info(HANDLER_NAME, 'Setting up Project IPC handlers...');

  // ============================================================================
  // claude:project:getSettings - Get project settings
  // ============================================================================
  ipcMain.handle('claude:project:getSettings', async (event: IpcMainInvokeEvent, projectId: string): Promise<ProjectSettings> => {
    claudeLog.info(HANDLER_NAME, `Getting settings for project: ${projectId}`);
    
    const settingsPath = getProjectSettingsPath(projectId);
    
    try {
      const content = await fs.readFile(settingsPath, 'utf-8');
      const project = JSON.parse(content);
      
      // Extract canvas size - handle both old and new formats
      const width = project.canvasSize?.width || project.width || 1920;
      const height = project.canvasSize?.height || project.height || 1080;
      
      return {
        name: project.name || 'Untitled',
        width,
        height,
        fps: project.fps || 30,
        aspectRatio: project.aspectRatio || `${width}:${height}`,
        backgroundColor: project.backgroundColor || '#000000',
        exportFormat: project.exportFormat || 'mp4',
        exportQuality: project.exportQuality || 'high',
      };
    } catch (error) {
      claudeLog.error(HANDLER_NAME, 'Failed to read project settings:', error);
      throw new Error(`Failed to read project: ${projectId}`);
    }
  });

  // ============================================================================
  // claude:project:updateSettings - Update project settings
  // ============================================================================
  ipcMain.handle('claude:project:updateSettings', async (event: IpcMainInvokeEvent, projectId: string, settings: Partial<ProjectSettings>): Promise<void> => {
    claudeLog.info(HANDLER_NAME, `Updating settings for project: ${projectId}`);
    
    const settingsPath = getProjectSettingsPath(projectId);
    
    try {
      // Read existing settings
      const content = await fs.readFile(settingsPath, 'utf-8');
      const project = JSON.parse(content);
      
      // Merge settings carefully
      if (settings.name !== undefined) project.name = settings.name;
      if (settings.fps !== undefined) project.fps = settings.fps;
      if (settings.backgroundColor !== undefined) project.backgroundColor = settings.backgroundColor;
      if (settings.exportFormat !== undefined) project.exportFormat = settings.exportFormat;
      if (settings.exportQuality !== undefined) project.exportQuality = settings.exportQuality;
      
      // Handle canvas size separately
      if (settings.width !== undefined || settings.height !== undefined) {
        if (!project.canvasSize) {
          project.canvasSize = { width: 1920, height: 1080 };
        }
        if (settings.width !== undefined) project.canvasSize.width = settings.width;
        if (settings.height !== undefined) project.canvasSize.height = settings.height;
      }
      
      // Update timestamp
      project.updatedAt = new Date().toISOString();
      
      // Write back
      await fs.writeFile(settingsPath, JSON.stringify(project, null, 2), 'utf-8');
      
      // Notify renderer process
      event.sender.send('claude:project:updated', projectId, settings);
      
      claudeLog.info(HANDLER_NAME, `Successfully updated project: ${projectId}`);
    } catch (error) {
      claudeLog.error(HANDLER_NAME, 'Failed to update project settings:', error);
      throw error;
    }
  });

  // ============================================================================
  // claude:project:getStats - Get project statistics
  // ============================================================================
  ipcMain.handle('claude:project:getStats', async (event: IpcMainInvokeEvent, projectId: string): Promise<ProjectStats> => {
    claudeLog.info(HANDLER_NAME, `Getting stats for project: ${projectId}`);
    
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return getEmptyStats();
    }
    
    // Request stats from renderer (which has access to timeline state)
    return new Promise((resolve) => {
      const requestId = `${Date.now()}-${win.webContents.id}`;

      const handler = (responseEvent: IpcMainEvent, stats: ProjectStats, responseId?: string) => {
        // Validate response is from the correct window and request
        if (responseEvent.sender.id !== win.webContents.id || responseId !== requestId) {
          return;
        }
        clearTimeout(timeout);
        ipcMain.removeListener('claude:project:statsResponse', handler);
        resolve(stats);
      };

      const timeout = setTimeout(() => {
        ipcMain.removeListener('claude:project:statsResponse', handler);
        claudeLog.warn(HANDLER_NAME, 'Timeout waiting for stats, returning empty');
        resolve(getEmptyStats());
      }, 3000);

      ipcMain.on('claude:project:statsResponse', handler);
      win.webContents.send('claude:project:statsRequest', { projectId, requestId });
    });
  });

  claudeLog.info(HANDLER_NAME, 'Project IPC handlers registered');
}

function getEmptyStats(): ProjectStats {
  return {
    totalDuration: 0,
    mediaCount: { video: 0, audio: 0, image: 0 },
    trackCount: 0,
    elementCount: 0,
    lastModified: Date.now(),
    fileSize: 0,
  };
}

// CommonJS export for main.ts compatibility
module.exports = { setupClaudeProjectIPC };
