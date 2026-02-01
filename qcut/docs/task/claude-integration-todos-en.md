# Claude Code Integration - Implementation TODOs

> **Core Principle**: Long-term support rather than short-term gain
> 
> Every implementation should consider: maintainability, scalability, and backward compatibility

---

## 📋 Table of Contents

1. [Infrastructure](#1-infrastructure)
2. [Claude API Layer](#2-claude-api-layer)
3. [Media API](#3-media-api)
4. [Timeline API](#4-timeline-api)
5. [Project API](#5-project-api)
6. [Export API](#6-export-api)
7. [Error Handling & Diagnostics](#7-error-handling--diagnostics)
8. [UI Integration](#8-ui-integration)
9. [Documentation & Testing](#9-documentation--testing)

---

## 1. Infrastructure

### 1.1 Create Claude Handler Base Type Definitions

- [ ] **TODO: Create shared type definitions for all Claude APIs**
  - **File Path**: `electron/types/claude-api.ts`
  - **Operation**: Create new file
  - **Content**:
    ```typescript
    // Shared type definitions for all Claude APIs
    export interface ClaudeAPIResponse<T> {
      success: boolean;
      data?: T;
      error?: string;
      timestamp: number;
    }
    
    export interface ClaudeAPIContext {
      projectId: string;
      userId?: string;
      sessionId?: string;
    }
    
    export interface MediaFile {
      id: string;
      name: string;
      type: 'video' | 'audio' | 'image';
      path: string;
      size: number;
      duration?: number;
      dimensions?: { width: number; height: number };
      createdAt: number;
      modifiedAt: number;
    }
    
    export interface TimelineElement {
      id: string;
      trackIndex: number;
      startTime: number;
      endTime: number;
      type: 'video' | 'audio' | 'image' | 'text' | 'effect';
      sourceId?: string;
      sourceName?: string;
      content?: string;
      style?: Record<string, any>;
      effects?: any[];
    }
    
    export interface Timeline {
      name: string;
      duration: number;
      width: number;
      height: number;
      fps: number;
      tracks: TimelineTrack[];
    }
    
    export interface TimelineTrack {
      index: number;
      name: string;
      type: string;
      elements: TimelineElement[];
    }
    
    export interface ProjectSettings {
      name: string;
      width: number;
      height: number;
      fps: number;
      aspectRatio: string;
      backgroundColor: string;
      exportFormat: string;
      exportQuality: string;
    }
    
    export interface ProjectStats {
      totalDuration: number;
      mediaCount: { video: number; audio: number; image: number };
      trackCount: number;
      elementCount: number;
      lastModified: number;
      fileSize: number;
    }
    
    export interface ExportPreset {
      id: string;
      name: string;
      platform: string;
      width: number;
      height: number;
      fps: number;
      bitrate: string;
      format: string;
    }
    ```
  - **Reason**: Unified response format for all Claude APIs, easier error handling and logging

### 1.2 Create Claude Handler Registry

- [ ] **TODO: Create unified handler registration entry point**
  - **File Path**: `electron/claude/index.ts`
  - **Operation**: Create new file
  - **⚠️ IMPORTANT**: Must use CommonJS exports to match existing pattern in main.ts
  - **Content**:
    ```typescript
    // Unified export for all Claude handlers
    // NOTE: main.ts uses require() for compiled JS, so we need CommonJS exports
    
    import { setupClaudeMediaIPC } from './claude-media-handler';
    import { setupClaudeTimelineIPC } from './claude-timeline-handler';
    import { setupClaudeProjectIPC } from './claude-project-handler';
    import { setupClaudeExportIPC } from './claude-export-handler';
    import { setupClaudeDiagnosticsIPC } from './claude-diagnostics-handler';
    
    // One-time registration for all handlers
    export function setupAllClaudeIPC(): void {
      setupClaudeMediaIPC();
      setupClaudeTimelineIPC();
      setupClaudeProjectIPC();
      setupClaudeExportIPC();
      setupClaudeDiagnosticsIPC();
      console.log('[Claude API] All handlers registered');
    }
    
    // CommonJS export for main.ts compatibility
    module.exports = { setupAllClaudeIPC };
    ```
  - **Reason**: Modular management, easy to add new APIs
  - **Compatibility Note**: main.ts uses `require('./handler.js')` pattern

### 1.3 Modify main.ts to Register Claude Handlers

- [ ] **TODO: Register Claude API in main process**
  - **File Path**: `electron/main.ts`
  - **Operation**: Modify file
  - **Modification Location**: After line ~68 where other handlers are imported
  - **⚠️ IMPORTANT**: Must use `require()` pattern like existing handlers
  - **Add Import** (around line 68):
    ```typescript
    // Add after other handler imports
    const { setupAllClaudeIPC } = require("./claude/index.js");
    ```
  - **Add Registration** (inside `app.whenReady()` callback, after other setup calls):
    ```typescript
    // Setup Claude Code integration API
    setupAllClaudeIPC();
    ```
  - **Reason**: Ensure Claude API is available when app starts
  - **Compatibility Note**: Uses `require()` to match existing handler pattern (compiled TS to JS)

### 1.4 Add Preload Exposure

- [ ] **TODO: Expose Claude API in preload**
  - **File Path**: `electron/preload.ts`
  - **Operation**: Modify file
  - **Location**: Add inside the `electronAPI` object (around line 500, before `isElectron: true`)
  - **⚠️ IMPORTANT**: Follow existing patterns (geminiChat, pty) for event listeners
  - **Add Content**:
    ```typescript
    // Claude Code Integration API
    claude: {
      // Media operations
      media: {
        list: (projectId: string): Promise<any[]> =>
          ipcRenderer.invoke('claude:media:list', projectId),
        info: (projectId: string, mediaId: string): Promise<any> =>
          ipcRenderer.invoke('claude:media:info', projectId, mediaId),
        import: (projectId: string, source: string): Promise<any> =>
          ipcRenderer.invoke('claude:media:import', projectId, source),
        delete: (projectId: string, mediaId: string): Promise<boolean> =>
          ipcRenderer.invoke('claude:media:delete', projectId, mediaId),
        rename: (projectId: string, mediaId: string, newName: string): Promise<boolean> =>
          ipcRenderer.invoke('claude:media:rename', projectId, mediaId, newName),
      },
      
      // Timeline operations
      timeline: {
        export: (projectId: string, format: 'json' | 'md'): Promise<string> =>
          ipcRenderer.invoke('claude:timeline:export', projectId, format),
        import: (projectId: string, data: string, format: 'json' | 'md'): Promise<void> =>
          ipcRenderer.invoke('claude:timeline:import', projectId, data, format),
        addElement: (projectId: string, element: any): Promise<string> =>
          ipcRenderer.invoke('claude:timeline:addElement', projectId, element),
        updateElement: (projectId: string, elementId: string, changes: any): Promise<void> =>
          ipcRenderer.invoke('claude:timeline:updateElement', projectId, elementId, changes),
        removeElement: (projectId: string, elementId: string): Promise<void> =>
          ipcRenderer.invoke('claude:timeline:removeElement', projectId, elementId),
        // Event listeners for timeline sync (follows geminiChat pattern)
        onRequest: (callback: () => void): void => {
          ipcRenderer.removeAllListeners('claude:timeline:request');
          ipcRenderer.on('claude:timeline:request', () => callback());
        },
        onApply: (callback: (timeline: any) => void): void => {
          ipcRenderer.removeAllListeners('claude:timeline:apply');
          ipcRenderer.on('claude:timeline:apply', (_, timeline) => callback(timeline));
        },
        onAddElement: (callback: (element: any) => void): void => {
          ipcRenderer.removeAllListeners('claude:timeline:addElement');
          ipcRenderer.on('claude:timeline:addElement', (_, element) => callback(element));
        },
        onUpdateElement: (callback: (data: { elementId: string; changes: any }) => void): void => {
          ipcRenderer.removeAllListeners('claude:timeline:updateElement');
          ipcRenderer.on('claude:timeline:updateElement', (_, data) => callback(data));
        },
        onRemoveElement: (callback: (elementId: string) => void): void => {
          ipcRenderer.removeAllListeners('claude:timeline:removeElement');
          ipcRenderer.on('claude:timeline:removeElement', (_, id) => callback(id));
        },
        // Send response back to main process
        sendResponse: (timeline: any): void => {
          ipcRenderer.send('claude:timeline:response', timeline);
        },
        removeListeners: (): void => {
          ipcRenderer.removeAllListeners('claude:timeline:request');
          ipcRenderer.removeAllListeners('claude:timeline:apply');
          ipcRenderer.removeAllListeners('claude:timeline:addElement');
          ipcRenderer.removeAllListeners('claude:timeline:updateElement');
          ipcRenderer.removeAllListeners('claude:timeline:removeElement');
        },
      },
      
      // Project operations
      project: {
        getSettings: (projectId: string): Promise<any> =>
          ipcRenderer.invoke('claude:project:getSettings', projectId),
        updateSettings: (projectId: string, settings: any): Promise<void> =>
          ipcRenderer.invoke('claude:project:updateSettings', projectId, settings),
        getStats: (projectId: string): Promise<any> =>
          ipcRenderer.invoke('claude:project:getStats', projectId),
        // Event listeners
        onStatsRequest: (callback: () => void): void => {
          ipcRenderer.removeAllListeners('claude:project:statsRequest');
          ipcRenderer.on('claude:project:statsRequest', () => callback());
        },
        sendStatsResponse: (stats: any): void => {
          ipcRenderer.send('claude:project:statsResponse', stats);
        },
        onUpdated: (callback: (projectId: string, settings: any) => void): void => {
          ipcRenderer.removeAllListeners('claude:project:updated');
          ipcRenderer.on('claude:project:updated', (_, projectId, settings) => callback(projectId, settings));
        },
        removeListeners: (): void => {
          ipcRenderer.removeAllListeners('claude:project:statsRequest');
          ipcRenderer.removeAllListeners('claude:project:updated');
        },
      },
      
      // Export operations
      export: {
        getPresets: (): Promise<any[]> =>
          ipcRenderer.invoke('claude:export:getPresets'),
        recommend: (projectId: string, target: string): Promise<any> =>
          ipcRenderer.invoke('claude:export:recommend', projectId, target),
      },
      
      // Diagnostics operations
      diagnostics: {
        analyze: (error: any): Promise<any> =>
          ipcRenderer.invoke('claude:diagnostics:analyze', error),
      },
    },
    ```
  - **Reason**: Allow renderer process to call Claude API with proper event handling
  - **Pattern Note**: Uses same pattern as `geminiChat` and `pty` for bidirectional communication

### 1.5 Add TypeScript Type Definitions

- [ ] **TODO: Add electronAPI.claude type definitions**
  - **File Path**: `apps/web/src/types/electron.d.ts`
  - **Operation**: Modify file
  - **Add Content**:
    ```typescript
    import type { 
      MediaFile, 
      Timeline, 
      TimelineElement, 
      ProjectSettings, 
      ProjectStats,
      ExportPreset 
    } from '../../electron/types/claude-api';
    
    interface ClaudeMediaAPI {
      list: (projectId: string) => Promise<MediaFile[]>;
      info: (projectId: string, mediaId: string) => Promise<MediaFile | null>;
      import: (projectId: string, source: string) => Promise<MediaFile | null>;
      delete: (projectId: string, mediaId: string) => Promise<boolean>;
      rename: (projectId: string, mediaId: string, newName: string) => Promise<boolean>;
    }
    
    interface ClaudeTimelineAPI {
      export: (projectId: string, format: 'json' | 'md') => Promise<string>;
      import: (projectId: string, data: string, format: 'json' | 'md') => Promise<void>;
      addElement: (projectId: string, element: Partial<TimelineElement>) => Promise<string>;
      updateElement: (projectId: string, elementId: string, changes: Partial<TimelineElement>) => Promise<void>;
      removeElement: (projectId: string, elementId: string) => Promise<void>;
    }
    
    interface ClaudeProjectAPI {
      getSettings: (projectId: string) => Promise<ProjectSettings>;
      updateSettings: (projectId: string, settings: Partial<ProjectSettings>) => Promise<void>;
      getStats: (projectId: string) => Promise<ProjectStats>;
    }
    
    interface ClaudeExportAPI {
      getPresets: () => Promise<ExportPreset[]>;
      recommend: (projectId: string, target: string) => Promise<ExportRecommendation>;
    }
    
    interface ClaudeDiagnosticsAPI {
      analyze: (error: ErrorReport) => Promise<DiagnosticResult>;
    }
    
    interface ClaudeAPI {
      media: ClaudeMediaAPI;
      timeline: ClaudeTimelineAPI;
      project: ClaudeProjectAPI;
      export: ClaudeExportAPI;
      diagnostics: ClaudeDiagnosticsAPI;
    }
    
    interface ElectronAPI {
      // ... existing types
      claude: ClaudeAPI;
    }
    ```
  - **Reason**: Complete type safety

---

## 2. Claude API Layer

### 2.1 Create Claude Folder Structure

- [ ] **TODO: Create Claude handlers directory**
  - **File Path**: `electron/claude/`
  - **Operation**: Create directory
  - **Sub-files**:
    - `index.ts` - Export entry
    - `claude-media-handler.ts` - Media API
    - `claude-timeline-handler.ts` - Timeline API
    - `claude-project-handler.ts` - Project API
    - `claude-export-handler.ts` - Export API
    - `claude-diagnostics-handler.ts` - Diagnostics API
    - `utils/` - Utility functions directory
  - **Reason**: Clear module structure

### 2.2 Create Shared Utility Functions

- [ ] **TODO: Create Claude API utility functions**
  - **File Path**: `electron/claude/utils/helpers.ts`
  - **Operation**: Create new file
  - **Content**:
    ```typescript
    import { app } from 'electron';
    import * as path from 'path';
    
    /**
     * Get project folder path
     */
    export function getProjectPath(projectId: string): string {
      const documentsPath = app.getPath('documents');
      return path.join(documentsPath, 'QCut', 'Projects', projectId);
    }
    
    /**
     * Get media folder path
     */
    export function getMediaPath(projectId: string): string {
      return path.join(getProjectPath(projectId), 'media');
    }
    
    /**
     * Get timeline file path
     */
    export function getTimelinePath(projectId: string): string {
      return path.join(getProjectPath(projectId), 'timeline.json');
    }
    
    /**
     * Format time (ms -> "H:MM:SS")
     */
    export function formatTime(ms: number): string {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
    
    /**
     * Parse time ("H:MM:SS" -> ms)
     */
    export function parseTime(time: string): number {
      const parts = time.split(':').map(Number);
      if (parts.length === 3) {
        return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
      }
      if (parts.length === 2) {
        return (parts[0] * 60 + parts[1]) * 1000;
      }
      return parts[0] * 1000;
    }
    
    /**
     * Validate path is within allowed base directory (security)
     */
    export function isPathSafe(targetPath: string, basePath: string): boolean {
      const resolvedTarget = path.resolve(targetPath);
      const resolvedBase = path.resolve(basePath);
      return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
    }
    
    /**
     * Generate unique ID
     */
    export function generateId(prefix: string = 'id'): string {
      return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    
    /**
     * Get media type from file extension
     */
    export function getMediaType(ext: string): 'video' | 'audio' | 'image' | null {
      const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
      const audioExts = ['.mp3', '.wav', '.aac', '.ogg', '.m4a', '.flac'];
      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
      
      const lowerExt = ext.toLowerCase();
      if (videoExts.includes(lowerExt)) return 'video';
      if (audioExts.includes(lowerExt)) return 'audio';
      if (imageExts.includes(lowerExt)) return 'image';
      return null;
    }
    ```
  - **Reason**: Avoid code duplication, unified processing logic

### 2.3 Create Logger Utility

- [ ] **TODO: Create Claude API logger module**
  - **File Path**: `electron/claude/utils/logger.ts`
  - **Operation**: Create new file
  - **Content**:
    ```typescript
    // Try to load electron-log, fallback to console if not available
    let log: any;
    try {
      log = require('electron-log');
    } catch {
      log = console;
    }
    
    const PREFIX = '[Claude API]';
    
    export const claudeLog = {
      info: (handler: string, message: string, ...args: any[]) => 
        log.info(`${PREFIX}[${handler}] ${message}`, ...args),
      warn: (handler: string, message: string, ...args: any[]) => 
        log.warn(`${PREFIX}[${handler}] ${message}`, ...args),
      error: (handler: string, message: string, ...args: any[]) => 
        log.error(`${PREFIX}[${handler}] ${message}`, ...args),
      debug: (handler: string, message: string, ...args: any[]) => 
        log.debug?.(`${PREFIX}[${handler}] ${message}`, ...args) || 
        log.log(`${PREFIX}[${handler}] ${message}`, ...args),
    };
    ```
  - **Reason**: Unified log format, easier debugging

---

## 3. Media API

### 3.1 Create Media Handler

- [ ] **TODO: Implement Media API handler**
  - **File Path**: `electron/claude/claude-media-handler.ts`
  - **Operation**: Create new file
  - **Content**:
    ```typescript
    import { ipcMain } from 'electron';
    import * as fs from 'fs/promises';
    import * as path from 'path';
    import { getMediaPath, isPathSafe, getMediaType, generateId } from './utils/helpers';
    import { claudeLog } from './utils/logger';
    import type { MediaFile } from '../types/claude-api';
    
    export function setupClaudeMediaIPC(): void {
      claudeLog.info('Media', 'Setting up Media IPC handlers...');
      
      // List all media files
      ipcMain.handle('claude:media:list', async (event, projectId: string): Promise<MediaFile[]> => {
        claudeLog.info('Media', `Listing media for project: ${projectId}`);
        
        const mediaPath = getMediaPath(projectId);
        const files: MediaFile[] = [];
        
        try {
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
          
          claudeLog.info('Media', `Found ${files.length} media files`);
          return files;
        } catch (error) {
          claudeLog.error('Media', 'Failed to list media:', error);
          return [];
        }
      });
      
      // Get media file info
      ipcMain.handle('claude:media:info', async (event, projectId: string, mediaId: string): Promise<MediaFile | null> => {
        claudeLog.info('Media', `Getting info for media: ${mediaId}`);
        // TODO: Implement - lookup media by ID and return full metadata
        return null;
      });
      
      // Import media from source path or URL
      ipcMain.handle('claude:media:import', async (event, projectId: string, source: string): Promise<MediaFile | null> => {
        claudeLog.info('Media', `Importing media from: ${source}`);
        
        const mediaPath = getMediaPath(projectId);
        
        // Ensure media directory exists
        await fs.mkdir(mediaPath, { recursive: true });
        
        // Security: Validate source path
        if (!source.startsWith('http://') && !source.startsWith('https://')) {
          // Local file - validate path
          const resolvedSource = path.resolve(source);
          // Allow importing from common user directories
          // TODO: Add more comprehensive path validation
        }
        
        try {
          const fileName = path.basename(source);
          const destPath = path.join(mediaPath, fileName);
          
          // Copy file
          await fs.copyFile(source, destPath);
          
          const stat = await fs.stat(destPath);
          const ext = path.extname(fileName);
          const type = getMediaType(ext);
          
          if (!type) {
            await fs.unlink(destPath); // Cleanup unsupported file
            return null;
          }
          
          const mediaFile: MediaFile = {
            id: generateId('media'),
            name: fileName,
            type,
            path: destPath,
            size: stat.size,
            createdAt: stat.birthtimeMs,
            modifiedAt: stat.mtimeMs,
          };
          
          claudeLog.info('Media', `Successfully imported: ${fileName}`);
          return mediaFile;
        } catch (error) {
          claudeLog.error('Media', 'Failed to import media:', error);
          return null;
        }
      });
      
      // Delete media file
      ipcMain.handle('claude:media:delete', async (event, projectId: string, mediaId: string): Promise<boolean> => {
        claudeLog.info('Media', `Deleting media: ${mediaId}`);
        // TODO: Implement - find file by ID and delete
        // Should also check if media is used in timeline before deleting
        return false;
      });
      
      // Rename media file
      ipcMain.handle('claude:media:rename', async (event, projectId: string, mediaId: string, newName: string): Promise<boolean> => {
        claudeLog.info('Media', `Renaming media ${mediaId} to: ${newName}`);
        // TODO: Implement - find file by ID and rename
        return false;
      });
      
      claudeLog.info('Media', 'Media IPC handlers registered');
    }
    ```
  - **Reason**: Provide media file access capability

### 3.2 Add Media Metadata Reading

- [ ] **TODO: Implement media metadata reading (using FFprobe)**
  - **File Path**: `electron/claude/utils/media-metadata.ts`
  - **Operation**: Create new file
  - **Dependency**: Reuse existing FFmpeg handler
  - **Content**:
    ```typescript
    import { execFile } from 'child_process';
    import { promisify } from 'util';
    import * as path from 'path';
    import { app } from 'electron';
    
    const execFileAsync = promisify(execFile);
    
    interface MediaMetadata {
      duration?: number;  // ms
      width?: number;
      height?: number;
      fps?: number;
      codec?: string;
      bitrate?: number;
      audioCodec?: string;
      audioChannels?: number;
      sampleRate?: number;
    }
    
    /**
     * Get FFprobe path based on environment
     */
    function getFFprobePath(): string {
      if (app.isPackaged) {
        return path.join(process.resourcesPath, 'ffmpeg', 'ffprobe.exe');
      }
      return path.join(__dirname, '..', '..', 'ffmpeg', 'ffprobe.exe');
    }
    
    /**
     * Get media metadata using FFprobe
     */
    export async function getMediaMetadata(filePath: string): Promise<MediaMetadata> {
      const ffprobePath = getFFprobePath();
      
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ];
      
      try {
        const { stdout } = await execFileAsync(ffprobePath, args);
        const data = JSON.parse(stdout);
        
        const metadata: MediaMetadata = {};
        
        // Parse format info
        if (data.format) {
          metadata.duration = parseFloat(data.format.duration) * 1000;
          metadata.bitrate = parseInt(data.format.bit_rate);
        }
        
        // Parse streams
        for (const stream of data.streams || []) {
          if (stream.codec_type === 'video') {
            metadata.width = stream.width;
            metadata.height = stream.height;
            metadata.codec = stream.codec_name;
            if (stream.r_frame_rate) {
              const [num, den] = stream.r_frame_rate.split('/').map(Number);
              metadata.fps = num / den;
            }
          } else if (stream.codec_type === 'audio') {
            metadata.audioCodec = stream.codec_name;
            metadata.audioChannels = stream.channels;
            metadata.sampleRate = parseInt(stream.sample_rate);
          }
        }
        
        return metadata;
      } catch (error) {
        console.error('[MediaMetadata] Failed to get metadata:', error);
        return {};
      }
    }
    ```
  - **Reason**: Provide complete media information

---

## 4. Timeline API

### 4.1 Create Timeline Handler

- [ ] **TODO: Implement Timeline export/import**
  - **File Path**: `electron/claude/claude-timeline-handler.ts`
  - **Operation**: Create new file
  - **Content**:
    ```typescript
    import { ipcMain, BrowserWindow } from 'electron';
    import { formatTime, parseTime } from './utils/helpers';
    import { claudeLog } from './utils/logger';
    import type { Timeline, TimelineElement, TimelineTrack } from '../types/claude-api';
    
    export function setupClaudeTimelineIPC(): void {
      claudeLog.info('Timeline', 'Setting up Timeline IPC handlers...');
      
      // Export Timeline
      ipcMain.handle('claude:timeline:export', async (event, projectId: string, format: 'json' | 'md'): Promise<string> => {
        claudeLog.info('Timeline', `Exporting timeline for project: ${projectId}, format: ${format}`);
        
        // Get window reference
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) throw new Error('Window not found');
        
        // Request timeline data from renderer process
        const timeline = await requestTimelineFromRenderer(win);
        
        if (format === 'md') {
          return timelineToMarkdown(timeline);
        }
        return JSON.stringify(timeline, null, 2);
      });
      
      // Import Timeline
      ipcMain.handle('claude:timeline:import', async (event, projectId: string, data: string, format: 'json' | 'md'): Promise<void> => {
        claudeLog.info('Timeline', `Importing timeline for project: ${projectId}, format: ${format}`);
        
        let timeline: Timeline;
        
        if (format === 'md') {
          timeline = markdownToTimeline(data);
        } else {
          timeline = JSON.parse(data);
        }
        
        // Validate timeline
        validateTimeline(timeline);
        
        // Send to renderer process to apply changes
        event.sender.send('claude:timeline:apply', timeline);
        
        claudeLog.info('Timeline', 'Timeline import sent to renderer');
      });
      
      // Add element to timeline
      ipcMain.handle('claude:timeline:addElement', async (event, projectId: string, element: Partial<TimelineElement>): Promise<string> => {
        claudeLog.info('Timeline', `Adding element to project: ${projectId}`);
        event.sender.send('claude:timeline:addElement', element);
        return element.id || '';
      });
      
      // Update timeline element
      ipcMain.handle('claude:timeline:updateElement', async (event, projectId: string, elementId: string, changes: Partial<TimelineElement>): Promise<void> => {
        claudeLog.info('Timeline', `Updating element: ${elementId}`);
        event.sender.send('claude:timeline:updateElement', { elementId, changes });
      });
      
      // Remove timeline element
      ipcMain.handle('claude:timeline:removeElement', async (event, projectId: string, elementId: string): Promise<void> => {
        claudeLog.info('Timeline', `Removing element: ${elementId}`);
        event.sender.send('claude:timeline:removeElement', elementId);
      });
      
      claudeLog.info('Timeline', 'Timeline IPC handlers registered');
    }
    
    /**
     * Request timeline data from renderer process
     */
    async function requestTimelineFromRenderer(win: BrowserWindow): Promise<Timeline> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ipcMain.removeListener('claude:timeline:response', handler);
          reject(new Error('Timeout waiting for timeline data'));
        }, 5000);
        
        const handler = (event: any, timeline: Timeline) => {
          clearTimeout(timeout);
          resolve(timeline);
        };
        
        ipcMain.once('claude:timeline:response', handler);
        win.webContents.send('claude:timeline:request');
      });
    }
    
    /**
     * Convert Timeline to Markdown format
     */
    function timelineToMarkdown(timeline: Timeline): string {
      let md = `# Timeline: ${timeline.name}\n\n`;
      
      md += `## Project Info\n\n`;
      md += `| Property | Value |\n`;
      md += `|----------|-------|\n`;
      md += `| Duration | ${formatTime(timeline.duration)} |\n`;
      md += `| Resolution | ${timeline.width}x${timeline.height} |\n`;
      md += `| FPS | ${timeline.fps} |\n`;
      md += `| Tracks | ${timeline.tracks.length} |\n\n`;
      
      for (const track of timeline.tracks) {
        md += `## Track ${track.index + 1}: ${track.name || track.type}\n\n`;
        
        if (track.elements.length === 0) {
          md += `*No elements in this track*\n\n`;
          continue;
        }
        
        md += `| ID | Start | End | Duration | Type | Source | Content |\n`;
        md += `|----|-------|-----|----------|------|--------|--------|\n`;
        
        for (const element of track.elements) {
          const duration = element.endTime - element.startTime;
          const content = (element.content || element.sourceName || '-').substring(0, 25);
          md += `| \`${element.id}\` | ${formatTime(element.startTime)} | ${formatTime(element.endTime)} | ${formatTime(duration)} | ${element.type} | ${element.sourceName || '-'} | ${content} |\n`;
        }
        md += `\n`;
      }
      
      md += `---\n\n`;
      md += `*Exported at: ${new Date().toISOString()}*\n`;
      
      return md;
    }
    
    /**
     * Parse Markdown to Timeline
     * Note: This is a simplified parser - production version should be more robust
     */
    function markdownToTimeline(md: string): Timeline {
      const lines = md.split('\n');
      
      const timeline: Timeline = {
        name: 'Imported Timeline',
        duration: 0,
        width: 1920,
        height: 1080,
        fps: 30,
        tracks: [],
      };
      
      // Parse project info
      const nameMatch = md.match(/# Timeline: (.+)/);
      if (nameMatch) {
        timeline.name = nameMatch[1].trim();
      }
      
      // Parse resolution
      const resMatch = md.match(/Resolution \| (\d+)x(\d+)/);
      if (resMatch) {
        timeline.width = parseInt(resMatch[1]);
        timeline.height = parseInt(resMatch[2]);
      }
      
      // Parse FPS
      const fpsMatch = md.match(/FPS \| (\d+)/);
      if (fpsMatch) {
        timeline.fps = parseInt(fpsMatch[1]);
      }
      
      // TODO: Parse tracks and elements from table format
      // This requires more sophisticated parsing logic
      
      return timeline;
    }
    
    /**
     * Validate timeline structure
     */
    function validateTimeline(timeline: Timeline): void {
      if (!timeline.name) {
        throw new Error('Timeline must have a name');
      }
      if (!timeline.tracks || !Array.isArray(timeline.tracks)) {
        throw new Error('Timeline must have tracks array');
      }
      if (timeline.width <= 0 || timeline.height <= 0) {
        throw new Error('Timeline must have valid dimensions');
      }
      if (timeline.fps <= 0) {
        throw new Error('Timeline must have valid FPS');
      }
      
      // Validate each track
      for (const track of timeline.tracks) {
        if (typeof track.index !== 'number') {
          throw new Error('Track must have an index');
        }
        if (!Array.isArray(track.elements)) {
          throw new Error('Track must have elements array');
        }
        
        // Validate each element
        for (const element of track.elements) {
          if (element.startTime < 0 || element.endTime < element.startTime) {
            throw new Error(`Invalid element timing: ${element.id}`);
          }
        }
      }
    }
    ```
  - **Reason**: Core feature - let Claude read/write Timeline

### 4.2 Create Renderer Process Timeline Bridge

- [ ] **TODO: Add Timeline responder in renderer process**
  - **File Path**: `apps/web/src/lib/claude-timeline-bridge.ts`
  - **Operation**: Create new file
  - **⚠️ IMPORTANT**: Must use existing types from `@/types/timeline` and `@/types/project`
  - **Content**:
    ```typescript
    import { useTimelineStore } from '@/stores/timeline-store';
    import { useProjectStore } from '@/stores/project-store';
    import type { TimelineElement, TimelineTrack } from '@/types/timeline';
    import type { TProject } from '@/types/project';
    
    // Claude-compatible timeline format for export
    interface ClaudeTimeline {
      name: string;
      duration: number;
      width: number;
      height: number;
      fps: number;
      tracks: ClaudeTrack[];
    }
    
    interface ClaudeTrack {
      index: number;
      name: string;
      type: string;
      elements: ClaudeElement[];
    }
    
    interface ClaudeElement {
      id: string;
      trackIndex: number;
      startTime: number;  // in seconds (matching existing convention)
      endTime: number;    // in seconds
      duration: number;   // in seconds
      type: string;
      sourceId?: string;
      sourceName?: string;
      content?: string;
    }
    
    /**
     * Setup Claude Timeline Bridge
     * Connects Electron main process Claude API with renderer's Zustand stores
     */
    export function setupClaudeTimelineBridge(): void {
      if (!window.electronAPI?.claude?.timeline) {
        console.warn('[ClaudeTimelineBridge] Claude Timeline API not available');
        return;
      }
      
      const claudeAPI = window.electronAPI.claude.timeline;
      console.log('[ClaudeTimelineBridge] Setting up bridge...');
      
      // Respond to timeline export request from main process
      claudeAPI.onRequest(() => {
        console.log('[ClaudeTimelineBridge] Received timeline export request');
        
        const timelineState = useTimelineStore.getState();
        const projectState = useProjectStore.getState();
        const project = projectState.activeProject;
        
        const timeline: ClaudeTimeline = {
          name: project?.name || 'Untitled',
          duration: timelineState.duration || 0,
          width: project?.canvasSize?.width || 1920,
          height: project?.canvasSize?.height || 1080,
          fps: project?.fps || 30,
          tracks: formatTracksForExport(timelineState.tracks),
        };
        
        claudeAPI.sendResponse(timeline);
      });
      
      // Handle timeline import from Claude
      claudeAPI.onApply((timeline: ClaudeTimeline) => {
        console.log('[ClaudeTimelineBridge] Applying imported timeline:', timeline.name);
        applyTimelineToStore(timeline);
      });
      
      // Handle element addition
      claudeAPI.onAddElement((element: Partial<ClaudeElement>) => {
        console.log('[ClaudeTimelineBridge] Adding element:', element);
        const timelineStore = useTimelineStore.getState();
        // Convert Claude element format to internal format
        // Note: addElementToTrack expects CreateTimelineElement type
        // This requires careful type mapping - implement based on element.type
        console.warn('[ClaudeTimelineBridge] addElement not fully implemented - needs type mapping');
      });
      
      // Handle element update
      claudeAPI.onUpdateElement((data: { elementId: string; changes: any }) => {
        console.log('[ClaudeTimelineBridge] Updating element:', data.elementId);
        const timelineStore = useTimelineStore.getState();
        // Use existing updateElement method if available
        // timelineStore.updateElement?.(data.elementId, data.changes);
        console.warn('[ClaudeTimelineBridge] updateElement not fully implemented');
      });
      
      // Handle element removal
      claudeAPI.onRemoveElement((elementId: string) => {
        console.log('[ClaudeTimelineBridge] Removing element:', elementId);
        const timelineStore = useTimelineStore.getState();
        timelineStore.removeElement(elementId);
      });
      
      console.log('[ClaudeTimelineBridge] Bridge setup complete');
    }
    
    /**
     * Format internal tracks for Claude export
     * Converts from internal TimelineTrack[] to Claude-compatible format
     */
    function formatTracksForExport(tracks: TimelineTrack[]): ClaudeTrack[] {
      return tracks.map((track, index) => ({
        index: track.order ?? index,
        name: track.name || `Track ${index + 1}`,
        type: track.type,
        elements: track.elements.map((element) => formatElementForExport(element, index)),
      }));
    }
    
    /**
     * Format a single element for export
     * Handles different element types: media, text, sticker, captions, remotion
     */
    function formatElementForExport(element: TimelineElement, trackIndex: number): ClaudeElement {
      const baseElement: ClaudeElement = {
        id: element.id,
        trackIndex,
        startTime: element.startTime,
        endTime: element.startTime + element.duration - element.trimStart - element.trimEnd,
        duration: element.duration - element.trimStart - element.trimEnd,
        type: element.type,
      };
      
      // Add type-specific fields
      switch (element.type) {
        case 'media':
          return {
            ...baseElement,
            sourceId: element.mediaId,
            sourceName: element.name,
          };
        case 'text':
          return {
            ...baseElement,
            content: element.content,
          };
        case 'captions':
          return {
            ...baseElement,
            content: element.text,
          };
        case 'sticker':
          return {
            ...baseElement,
            sourceId: element.stickerId,
          };
        case 'remotion':
          return {
            ...baseElement,
            sourceId: element.componentId,
          };
        default:
          return baseElement;
      }
    }
    
    /**
     * Apply imported Claude timeline to store
     * Note: This is a complex operation that should be done carefully
     */
    function applyTimelineToStore(timeline: ClaudeTimeline): void {
      const projectStore = useProjectStore.getState();
      
      // Update project canvas size if different
      if (projectStore.activeProject) {
        const currentSize = projectStore.activeProject.canvasSize;
        if (currentSize.width !== timeline.width || currentSize.height !== timeline.height) {
          console.log('[ClaudeTimelineBridge] Canvas size change detected - requires manual update');
          // Note: Changing canvas size mid-project is complex, may need user confirmation
        }
      }
      
      // TODO: Implement track/element import
      // This requires:
      // 1. Mapping Claude elements back to internal TimelineElement types
      // 2. Validating media references exist
      // 3. Handling conflicts with existing elements
      console.warn('[ClaudeTimelineBridge] Full timeline import not implemented - complex operation');
    }
    
    /**
     * Cleanup bridge listeners
     */
    export function cleanupClaudeTimelineBridge(): void {
      if (window.electronAPI?.claude?.timeline?.removeListeners) {
        window.electronAPI.claude.timeline.removeListeners();
      }
      console.log('[ClaudeTimelineBridge] Bridge cleanup complete');
    }
    ```
  - **Reason**: Connect main process and renderer process Timeline data
  - **Type Compatibility**: Uses existing `TimelineElement`, `TimelineTrack` from `@/types/timeline`
  - **Store Integration**: Works with existing `useTimelineStore` and `useProjectStore`

### 4.3 Register Timeline Bridge

- [ ] **TODO: Register Timeline Bridge at app startup**
  - **File Path**: `apps/web/src/App.tsx` or `apps/web/src/main.tsx`
  - **Operation**: Modify file
  - **Add Location**: In component mount or app initialization
  - **Add Content**:
    ```typescript
    import { useEffect } from 'react';
    import { setupClaudeTimelineBridge, cleanupClaudeTimelineBridge } from '@/lib/claude-timeline-bridge';
    
    // Inside App component or root
    useEffect(() => {
      setupClaudeTimelineBridge();
      
      return () => {
        cleanupClaudeTimelineBridge();
      };
    }, []);
    ```
  - **Reason**: Ensure Bridge initializes at app startup

---

## 5. Project API

### 5.1 Create Project Handler

- [ ] **TODO: Implement Project settings read/write**
  - **File Path**: `electron/claude/claude-project-handler.ts`
  - **Operation**: Create new file
  - **Content**:
    ```typescript
    import { ipcMain, BrowserWindow } from 'electron';
    import * as fs from 'fs/promises';
    import * as path from 'path';
    import { getProjectPath } from './utils/helpers';
    import { claudeLog } from './utils/logger';
    import type { ProjectSettings, ProjectStats } from '../types/claude-api';
    
    export function setupClaudeProjectIPC(): void {
      claudeLog.info('Project', 'Setting up Project IPC handlers...');
      
      // Get project settings
      ipcMain.handle('claude:project:getSettings', async (event, projectId: string): Promise<ProjectSettings> => {
        claudeLog.info('Project', `Getting settings for project: ${projectId}`);
        
        const projectPath = getProjectPath(projectId);
        const settingsPath = path.join(projectPath, 'project.json');
        
        try {
          const content = await fs.readFile(settingsPath, 'utf-8');
          const project = JSON.parse(content);
          
          return {
            name: project.name || 'Untitled',
            width: project.width || 1920,
            height: project.height || 1080,
            fps: project.fps || 30,
            aspectRatio: project.aspectRatio || '16:9',
            backgroundColor: project.backgroundColor || '#000000',
            exportFormat: project.exportFormat || 'mp4',
            exportQuality: project.exportQuality || 'high',
          };
        } catch (error) {
          claudeLog.error('Project', 'Failed to read project settings:', error);
          throw new Error(`Failed to read project: ${projectId}`);
        }
      });
      
      // Update project settings
      ipcMain.handle('claude:project:updateSettings', async (event, projectId: string, settings: Partial<ProjectSettings>): Promise<void> => {
        claudeLog.info('Project', `Updating settings for project: ${projectId}`);
        
        const projectPath = getProjectPath(projectId);
        const settingsPath = path.join(projectPath, 'project.json');
        
        try {
          // Read existing settings
          const content = await fs.readFile(settingsPath, 'utf-8');
          const project = JSON.parse(content);
          
          // Merge settings
          Object.assign(project, settings);
          project.updatedAt = Date.now();
          
          // Write back
          await fs.writeFile(settingsPath, JSON.stringify(project, null, 2), 'utf-8');
          
          // Notify renderer process
          event.sender.send('claude:project:updated', projectId, settings);
          
          claudeLog.info('Project', `Successfully updated project: ${projectId}`);
        } catch (error) {
          claudeLog.error('Project', 'Failed to update project settings:', error);
          throw error;
        }
      });
      
      // Get project statistics
      ipcMain.handle('claude:project:getStats', async (event, projectId: string): Promise<ProjectStats> => {
        claudeLog.info('Project', `Getting stats for project: ${projectId}`);
        
        // Request stats from renderer (which has access to timeline state)
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) {
          return getEmptyStats();
        }
        
        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            ipcMain.removeListener('claude:project:statsResponse', handler);
            resolve(getEmptyStats());
          }, 3000);
          
          const handler = (e: any, stats: ProjectStats) => {
            clearTimeout(timeout);
            resolve(stats);
          };
          
          ipcMain.once('claude:project:statsResponse', handler);
          win.webContents.send('claude:project:statsRequest');
        });
      });
      
      claudeLog.info('Project', 'Project IPC handlers registered');
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
    ```
  - **Reason**: Let Claude read and modify project settings

---

## 6. Export API

### 6.1 Create Export Handler

- [ ] **TODO: Implement export recommendation feature**
  - **File Path**: `electron/claude/claude-export-handler.ts`
  - **Operation**: Create new file
  - **Content**:
    ```typescript
    import { ipcMain } from 'electron';
    import { claudeLog } from './utils/logger';
    import type { ExportPreset } from '../types/claude-api';
    
    interface ExportRecommendation {
      preset: ExportPreset;
      warnings: string[];
      suggestions: string[];
      estimatedFileSize?: string;
    }
    
    // Platform-specific export presets
    const PRESETS: ExportPreset[] = [
      {
        id: 'youtube-4k',
        name: 'YouTube 4K',
        platform: 'youtube',
        width: 3840,
        height: 2160,
        fps: 60,
        bitrate: '45Mbps',
        format: 'mp4',
      },
      {
        id: 'youtube-1080p',
        name: 'YouTube 1080p',
        platform: 'youtube',
        width: 1920,
        height: 1080,
        fps: 30,
        bitrate: '8Mbps',
        format: 'mp4',
      },
      {
        id: 'youtube-720p',
        name: 'YouTube 720p',
        platform: 'youtube',
        width: 1280,
        height: 720,
        fps: 30,
        bitrate: '5Mbps',
        format: 'mp4',
      },
      {
        id: 'tiktok',
        name: 'TikTok',
        platform: 'tiktok',
        width: 1080,
        height: 1920,
        fps: 30,
        bitrate: '6Mbps',
        format: 'mp4',
      },
      {
        id: 'instagram-reel',
        name: 'Instagram Reel',
        platform: 'instagram',
        width: 1080,
        height: 1920,
        fps: 30,
        bitrate: '5Mbps',
        format: 'mp4',
      },
      {
        id: 'instagram-post',
        name: 'Instagram Post (Square)',
        platform: 'instagram',
        width: 1080,
        height: 1080,
        fps: 30,
        bitrate: '5Mbps',
        format: 'mp4',
      },
      {
        id: 'instagram-landscape',
        name: 'Instagram Post (Landscape)',
        platform: 'instagram',
        width: 1080,
        height: 566,
        fps: 30,
        bitrate: '5Mbps',
        format: 'mp4',
      },
      {
        id: 'twitter',
        name: 'Twitter/X',
        platform: 'twitter',
        width: 1920,
        height: 1080,
        fps: 30,
        bitrate: '6Mbps',
        format: 'mp4',
      },
      {
        id: 'linkedin',
        name: 'LinkedIn',
        platform: 'linkedin',
        width: 1920,
        height: 1080,
        fps: 30,
        bitrate: '8Mbps',
        format: 'mp4',
      },
    ];
    
    export function setupClaudeExportIPC(): void {
      claudeLog.info('Export', 'Setting up Export IPC handlers...');
      
      // Get all presets
      ipcMain.handle('claude:export:getPresets', async (): Promise<ExportPreset[]> => {
        claudeLog.info('Export', 'Returning all export presets');
        return PRESETS;
      });
      
      // Recommend export settings for a specific platform
      ipcMain.handle('claude:export:recommend', async (event, projectId: string, target: string): Promise<ExportRecommendation> => {
        claudeLog.info('Export', `Recommending export for project: ${projectId}, target: ${target}`);
        
        // Find matching preset
        const preset = PRESETS.find(p => p.platform === target || p.id === target) || PRESETS[1];
        
        const warnings: string[] = [];
        const suggestions: string[] = [];
        
        // Platform-specific warnings and suggestions
        switch (target) {
          case 'tiktok':
            suggestions.push('Videos under 60 seconds perform best on TikTok');
            suggestions.push('Add captions for better engagement');
            warnings.push('Maximum video length is 10 minutes');
            break;
          case 'instagram':
            suggestions.push('Reels should be 15-90 seconds for optimal reach');
            suggestions.push('Use trending audio when possible');
            break;
          case 'youtube':
            suggestions.push('Add chapters for longer videos');
            suggestions.push('Include end screen in last 20 seconds');
            break;
          case 'twitter':
            warnings.push('Maximum video length is 2 minutes 20 seconds');
            suggestions.push('Keep it concise for better engagement');
            break;
        }
        
        return { preset, warnings, suggestions };
      });
      
      claudeLog.info('Export', 'Export IPC handlers registered');
    }
    ```
  - **Reason**: Let Claude provide intelligent export recommendations

---

## 7. Error Handling & Diagnostics

### 7.1 Create Error Diagnostics Module

- [ ] **TODO: Implement error collection and diagnostics**
  - **File Path**: `electron/claude/claude-diagnostics-handler.ts`
  - **Operation**: Create new file
  - **Content**:
    ```typescript
    import { ipcMain, app } from 'electron';
    import * as os from 'os';
    import { claudeLog } from './utils/logger';
    
    interface ErrorReport {
      message: string;
      stack?: string;
      context: string;
      timestamp: number;
      componentStack?: string;
    }
    
    interface SystemInfo {
      platform: string;
      arch: string;
      osVersion: string;
      appVersion: string;
      nodeVersion: string;
      electronVersion: string;
      memory: { total: number; free: number; used: number };
      cpuCount: number;
    }
    
    interface DiagnosticResult {
      errorType: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      possibleCauses: string[];
      suggestedFixes: string[];
      canAutoFix: boolean;
      autoFixAction?: string;
      systemInfo: SystemInfo;
    }
    
    export function setupClaudeDiagnosticsIPC(): void {
      claudeLog.info('Diagnostics', 'Setting up Diagnostics IPC handlers...');
      
      // Analyze error and provide diagnostics
      ipcMain.handle('claude:diagnostics:analyze', async (event, error: ErrorReport): Promise<DiagnosticResult> => {
        claudeLog.info('Diagnostics', `Analyzing error: ${error.message}`);
        
        // Collect system information
        const systemInfo = getSystemInfo();
        
        // Analyze the error
        const result = analyzeError(error, systemInfo);
        
        claudeLog.info('Diagnostics', `Diagnosis complete: ${result.errorType}`);
        return result;
      });
      
      claudeLog.info('Diagnostics', 'Diagnostics IPC handlers registered');
    }
    
    function getSystemInfo(): SystemInfo {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      
      return {
        platform: os.platform(),
        arch: os.arch(),
        osVersion: os.release(),
        appVersion: app.getVersion(),
        nodeVersion: process.versions.node,
        electronVersion: process.versions.electron,
        memory: {
          total: totalMem,
          free: freeMem,
          used: totalMem - freeMem,
        },
        cpuCount: os.cpus().length,
      };
    }
    
    function analyzeError(error: ErrorReport, systemInfo: SystemInfo): DiagnosticResult {
      const result: DiagnosticResult = {
        errorType: 'unknown',
        severity: 'medium',
        possibleCauses: [],
        suggestedFixes: [],
        canAutoFix: false,
        systemInfo,
      };
      
      const msg = error.message.toLowerCase();
      const stack = (error.stack || '').toLowerCase();
      
      // File system errors
      if (msg.includes('enoent') || msg.includes('no such file')) {
        result.errorType = 'file_not_found';
        result.severity = 'medium';
        result.possibleCauses = [
          'The file has been moved or deleted',
          'The file path is incorrect',
          'The file was on a disconnected external drive',
        ];
        result.suggestedFixes = [
          'Check if the file exists at the expected location',
          'Re-import the media file into your project',
          'Reconnect any external drives',
        ];
      }
      // Permission errors
      else if (msg.includes('eacces') || msg.includes('eperm') || msg.includes('permission')) {
        result.errorType = 'permission_denied';
        result.severity = 'high';
        result.possibleCauses = [
          'Insufficient permissions to access the file',
          'File is locked by another application',
          'Antivirus software blocking access',
        ];
        result.suggestedFixes = [
          'Close other applications that may be using the file',
          'Run QCut as administrator',
          'Check your antivirus settings',
        ];
      }
      // Memory errors
      else if (msg.includes('enomem') || msg.includes('out of memory') || msg.includes('heap')) {
        result.errorType = 'out_of_memory';
        result.severity = 'critical';
        result.possibleCauses = [
          'System memory is exhausted',
          'Project contains too many high-resolution media files',
          'Memory leak in the application',
        ];
        result.suggestedFixes = [
          'Close other applications to free up memory',
          'Use proxy media for editing',
          'Split the project into smaller parts',
          'Restart the application',
        ];
        
        // Add memory-specific info
        const usedPercent = ((systemInfo.memory.used / systemInfo.memory.total) * 100).toFixed(1);
        result.possibleCauses.push(`Current memory usage: ${usedPercent}%`);
      }
      // FFmpeg errors
      else if (msg.includes('ffmpeg') || stack.includes('ffmpeg')) {
        result.errorType = 'ffmpeg_error';
        result.severity = 'medium';
        result.possibleCauses = [
          'FFmpeg processing failed',
          'Unsupported media format',
          'Corrupted media file',
        ];
        result.suggestedFixes = [
          'Try converting the media to a different format',
          'Re-encode the problematic file',
          'Check if the media file plays correctly in other applications',
        ];
      }
      // Network errors
      else if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) {
        result.errorType = 'network_error';
        result.severity = 'low';
        result.possibleCauses = [
          'No internet connection',
          'Server is temporarily unavailable',
          'Firewall blocking the connection',
        ];
        result.suggestedFixes = [
          'Check your internet connection',
          'Try again in a few minutes',
          'Check firewall settings',
        ];
      }
      // React/UI errors
      else if (stack.includes('react') || msg.includes('render') || error.componentStack) {
        result.errorType = 'ui_error';
        result.severity = 'medium';
        result.possibleCauses = [
          'UI component rendering failed',
          'Invalid state or props',
          'Missing required data',
        ];
        result.suggestedFixes = [
          'Refresh the application',
          'Clear application cache and restart',
          'If the problem persists, try creating a new project',
        ];
      }
      
      return result;
    }
    ```
  - **Reason**: Provide intelligent error diagnostics

### 7.2 Create Error Boundary Component

- [ ] **TODO: Create Claude-enhanced Error Boundary**
  - **File Path**: `apps/web/src/components/claude-error-boundary.tsx`
  - **Operation**: Create new file
  - **Content**:
    ```typescript
    import React, { Component, ReactNode } from 'react';
    import { Button } from '@/components/ui/button';
    import { AlertTriangle, RefreshCw, Bug } from 'lucide-react';
    
    interface Props {
      children: ReactNode;
      fallback?: ReactNode;
    }
    
    interface DiagnosticResult {
      errorType: string;
      severity: string;
      possibleCauses: string[];
      suggestedFixes: string[];
      canAutoFix: boolean;
    }
    
    interface State {
      hasError: boolean;
      error?: Error;
      errorInfo?: React.ErrorInfo;
      diagnosis?: DiagnosticResult;
      isAnalyzing: boolean;
    }
    
    export class ClaudeErrorBoundary extends Component<Props, State> {
      state: State = {
        hasError: false,
        isAnalyzing: false,
      };
      
      static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
      }
      
      componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        this.setState({ errorInfo });
        this.analyzeError(error, errorInfo);
      }
      
      async analyzeError(error: Error, errorInfo: React.ErrorInfo): Promise<void> {
        if (!window.electronAPI?.claude?.diagnostics) {
          console.warn('[ClaudeErrorBoundary] Diagnostics API not available');
          return;
        }
        
        this.setState({ isAnalyzing: true });
        
        try {
          const diagnosis = await window.electronAPI.claude.diagnostics.analyze({
            message: error.message,
            stack: error.stack,
            context: 'react-error-boundary',
            componentStack: errorInfo.componentStack || '',
            timestamp: Date.now(),
          });
          
          this.setState({ diagnosis, isAnalyzing: false });
        } catch (e) {
          console.error('[ClaudeErrorBoundary] Failed to analyze error:', e);
          this.setState({ isAnalyzing: false });
        }
      }
      
      handleRetry = (): void => {
        this.setState({
          hasError: false,
          error: undefined,
          errorInfo: undefined,
          diagnosis: undefined,
        });
      };
      
      handleReportBug = (): void => {
        // TODO: Open bug report dialog or GitHub issue
        const { error, diagnosis } = this.state;
        const issueBody = `
## Error
${error?.message}

## Stack Trace
\`\`\`
${error?.stack}
\`\`\`

## Diagnosis
- Type: ${diagnosis?.errorType || 'unknown'}
- Severity: ${diagnosis?.severity || 'unknown'}

## System Info
- App Version: ${window.electronAPI?.getVersion?.() || 'unknown'}
- Platform: ${navigator.platform}
        `.trim();
        
        const url = `https://github.com/donghaozhang/qcut/issues/new?title=Bug Report: ${encodeURIComponent(error?.message || 'Unknown Error')}&body=${encodeURIComponent(issueBody)}`;
        window.open(url, '_blank');
      };
      
      render(): ReactNode {
        if (!this.state.hasError) {
          return this.props.children;
        }
        
        const { error, diagnosis, isAnalyzing } = this.state;
        const severityColors: Record<string, string> = {
          low: 'bg-yellow-50 border-yellow-200',
          medium: 'bg-orange-50 border-orange-200',
          high: 'bg-red-50 border-red-200',
          critical: 'bg-red-100 border-red-300',
        };
        
        const bgColor = diagnosis ? severityColors[diagnosis.severity] || severityColors.medium : severityColors.medium;
        
        return (
          <div className={`p-6 rounded-lg border ${bgColor} m-4`}>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600" />
              <h2 className="text-lg font-semibold text-gray-800">Something went wrong</h2>
            </div>
            
            <p className="text-gray-700 mb-4 font-mono text-sm bg-white/50 p-2 rounded">
              {error?.message}
            </p>
            
            {isAnalyzing && (
              <div className="flex items-center gap-2 text-gray-500 mb-4">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Analyzing error...</span>
              </div>
            )}
            
            {diagnosis && (
              <div className="space-y-4 mb-6">
                <div>
                  <h3 className="font-medium text-gray-800 mb-2">Possible Causes:</h3>
                  <ul className="list-disc pl-5 space-y-1">
                    {diagnosis.possibleCauses.map((cause, i) => (
                      <li key={i} className="text-gray-600">{cause}</li>
                    ))}
                  </ul>
                </div>
                
                <div>
                  <h3 className="font-medium text-gray-800 mb-2">Suggested Solutions:</h3>
                  <ul className="list-disc pl-5 space-y-1">
                    {diagnosis.suggestedFixes.map((fix, i) => (
                      <li key={i} className="text-gray-600">{fix}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            
            <div className="flex gap-3">
              <Button onClick={this.handleRetry} className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                Try Again
              </Button>
              <Button variant="outline" onClick={this.handleReportBug} className="flex items-center gap-2">
                <Bug className="w-4 h-4" />
                Report Bug
              </Button>
            </div>
          </div>
        );
      }
    }
    ```
  - **Reason**: Catch errors and provide intelligent diagnostics

---

## 8. UI Integration

### 8.1 Create Claude Control Panel

- [ ] **TODO: Create Claude control panel component**
  - **File Path**: `apps/web/src/components/editor/claude-panel.tsx`
  - **Operation**: Create new file
  - **Content**: Independent Claude control UI with:
    - Export Timeline to Markdown button
    - Import Timeline from Markdown
    - Project analysis
    - Export recommendations
  - **Reason**: Let users interact directly with Claude features

### 8.2 Add Claude Menu Items

- [ ] **TODO: Add Claude options to editor menu**
  - **File Path**: `apps/web/src/components/editor-header.tsx`
  - **Operation**: Modify file
  - **Add Content**: Claude menu (Export Timeline, Analyze Project, etc.)
  - **Reason**: Convenient access to Claude features

---

## 9. Documentation & Testing

### 9.1 Update CLAUDE.md

- [ ] **TODO: Document new APIs in CLAUDE.md**
  - **File Path**: `CLAUDE.md`
  - **Operation**: Modify file
  - **Add Content**: Claude API usage instructions and examples
  - **Reason**: Developer documentation

### 9.2 Create API Reference Document

- [ ] **TODO: Create Claude API reference document**
  - **File Path**: `docs/claude-api.md`
  - **Operation**: Create new file
  - **Content**: Complete API reference with:
    - All endpoints
    - Request/response types
    - Usage examples
    - Error handling
  - **Reason**: Easy reference for Claude and developers

### 9.3 Add Unit Tests

- [ ] **TODO: Add tests for Claude handlers**
  - **File Path**: `apps/web/src/lib/__tests__/claude-timeline-bridge.test.ts`
  - **Operation**: Create new file
  - **Content**: Unit tests for Timeline bridge functions
  - **Reason**: Ensure functionality correctness

### 9.4 Add Integration Tests

- [ ] **TODO: Add Claude API integration tests**
  - **File Path**: `apps/web/src/lib/__tests__/claude-api-integration.test.ts`
  - **Operation**: Create new file
  - **Content**: End-to-end tests for Claude API
  - **Reason**: Comprehensive testing

---

## 📊 Progress Tracking

| Module | TODO Count | Completed | Progress |
|--------|------------|-----------|----------|
| Infrastructure | 5 | 0 | 0% |
| Claude API Layer | 3 | 0 | 0% |
| Media API | 2 | 0 | 0% |
| Timeline API | 3 | 0 | 0% |
| Project API | 1 | 0 | 0% |
| Export API | 1 | 0 | 0% |
| Error Handling | 2 | 0 | 0% |
| UI Integration | 2 | 0 | 0% |
| Documentation & Testing | 4 | 0 | 0% |
| **Total** | **23** | **0** | **0%** |

---

## 🎯 Recommended Implementation Order

### Phase 1: Foundation (Week 1)
1. Infrastructure (1.1 - 1.5)
2. Claude API Layer (2.1 - 2.3)

### Phase 2: Core APIs (Week 2)
3. Timeline API (4.1 - 4.3) - **Highest Priority**
4. Media API (3.1 - 3.2)

### Phase 3: Extended Features (Week 3)
5. Project API (5.1)
6. Export API (6.1)
7. Error Handling (7.1 - 7.2)

### Phase 4: Polish (Week 4)
8. UI Integration (8.1 - 8.2)
9. Documentation & Testing (9.1 - 9.4)

---

## 📁 File Structure Summary

```
electron/
├── types/
│   └── claude-api.ts              # Shared type definitions
├── claude/
│   ├── index.ts                   # Export entry point
│   ├── claude-media-handler.ts    # Media API
│   ├── claude-timeline-handler.ts # Timeline API
│   ├── claude-project-handler.ts  # Project API
│   ├── claude-export-handler.ts   # Export API
│   ├── claude-diagnostics-handler.ts # Diagnostics API
│   └── utils/
│       ├── helpers.ts             # Utility functions
│       ├── logger.ts              # Logging utility
│       └── media-metadata.ts      # FFprobe integration
├── main.ts                        # (modify) Register handlers
└── preload.ts                     # (modify) Expose APIs

apps/web/src/
├── types/
│   └── electron.d.ts              # (modify) Add Claude types
├── lib/
│   ├── claude-timeline-bridge.ts  # Timeline bridge
│   └── __tests__/
│       ├── claude-timeline-bridge.test.ts
│       └── claude-api-integration.test.ts
├── components/
│   ├── claude-error-boundary.tsx  # Error boundary
│   └── editor/
│       └── claude-panel.tsx       # Claude control panel
├── App.tsx                        # (modify) Register bridge
└── main.tsx                       # Alternative registration point

docs/
└── claude-api.md                  # API documentation

CLAUDE.md                          # (modify) Add API docs
```

---

---

## ⚠️ Compatibility & Breaking Change Analysis

### Existing Code Patterns (MUST Follow)

| Pattern | Location | How Claude API Must Follow |
|---------|----------|---------------------------|
| Handler imports | `main.ts:60-70` | Use `require("./claude/index.js")` not ES6 import |
| CommonJS exports | All handlers | Include `module.exports = { ... }` |
| IPC channel naming | Throughout | Use `claude:*` prefix consistently |
| Event listeners | `preload.ts` | Follow `onX`/`removeListeners` pattern from `geminiChat` |
| Type definitions | `electron.d.ts` | Add `ClaudeAPI` interface matching preload |

### Existing Types to Reuse (DO NOT Duplicate)

| Type | Location | Usage |
|------|----------|-------|
| `TimelineElement` | `@/types/timeline` | Base element type with all variants |
| `TimelineTrack` | `@/types/timeline` | Track structure |
| `TProject` | `@/types/project` | Project with canvasSize, fps, scenes |
| `MediaItem` | `@/stores/media-store` | Media file representation |
| `CanvasSize` | `@/types/editor` | { width, height } |

### Store Methods to Use (DO NOT Recreate)

| Store | Method | Purpose |
|-------|--------|---------|
| `useTimelineStore` | `removeElement(id)` | Delete element |
| `useTimelineStore` | `tracks` | Get current tracks |
| `useTimelineStore` | `duration` | Get timeline duration |
| `useProjectStore` | `activeProject` | Current project |
| `useProjectStore` | `saveCurrentProject()` | Persist changes |

### Potential Breaking Changes - NONE Expected

The Claude API is **additive only**:
- New IPC channels (`claude:*`) don't conflict with existing channels
- New preload properties (`claude`) don't shadow existing APIs
- New handler files don't modify existing handlers
- Timeline bridge listens but doesn't auto-modify stores

### Safety Checklist Before Merging

- [ ] All new handlers use CommonJS `module.exports`
- [ ] All IPC channels start with `claude:`
- [ ] Type definitions don't conflict with existing types
- [ ] Timeline bridge only reads stores by default (write requires explicit call)
- [ ] Error boundary component doesn't wrap existing error handlers
- [ ] No changes to existing handler files
- [ ] No changes to existing store files
- [ ] Tests pass for existing functionality

---

*Created: 2026-01-31*
*Last Updated: 2026-01-31*
*Maintainer: Claude Code Integration Team*
