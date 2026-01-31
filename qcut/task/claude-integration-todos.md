# Claude Code Integration - Implementation TODOs

> **核心原则**: Long-term support rather than short-term gain
> 
> 每个实现都要考虑：可维护性、可扩展性、向后兼容性

---

## 📋 目录

1. [基础设施](#1-基础设施)
2. [Claude API 层](#2-claude-api-层)
3. [Media API](#3-media-api)
4. [Timeline API](#4-timeline-api)
5. [Project API](#5-project-api)
6. [Export API](#6-export-api)
7. [错误处理与诊断](#7-错误处理与诊断)
8. [UI 集成](#8-ui-集成)
9. [文档与测试](#9-文档与测试)

---

## 1. 基础设施

### 1.1 创建 Claude Handler 基础模块

- [ ] **TODO: 创建 Claude handler 基础类型定义**
  - **文件路径**: `electron/types/claude-api.ts`
  - **操作**: 新建文件
  - **内容**:
    ```typescript
    // 所有 Claude API 的共享类型定义
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
    ```
  - **原因**: 统一所有 Claude API 的响应格式，便于错误处理和日志记录

### 1.2 创建 Claude Handler 注册中心

- [ ] **TODO: 创建统一的 handler 注册入口**
  - **文件路径**: `electron/claude/index.ts`
  - **操作**: 新建文件
  - **内容**:
    ```typescript
    // 统一导出所有 Claude handlers
    export { setupClaudeMediaIPC } from './claude-media-handler';
    export { setupClaudeTimelineIPC } from './claude-timeline-handler';
    export { setupClaudeProjectIPC } from './claude-project-handler';
    export { setupClaudeExportIPC } from './claude-export-handler';
    
    // 一次性注册所有 handlers
    export function setupAllClaudeIPC(): void {
      setupClaudeMediaIPC();
      setupClaudeTimelineIPC();
      setupClaudeProjectIPC();
      setupClaudeExportIPC();
    }
    ```
  - **原因**: 模块化管理，便于添加新 API

### 1.3 修改 main.ts 注册 Claude handlers

- [ ] **TODO: 在主进程中注册 Claude API**
  - **文件路径**: `electron/main.ts`
  - **操作**: 修改文件
  - **修改位置**: 在现有 IPC handler 注册后添加
  - **添加内容**:
    ```typescript
    import { setupAllClaudeIPC } from './claude/index';
    
    // 在 app.whenReady() 中添加
    setupAllClaudeIPC();
    ```
  - **原因**: 确保 Claude API 在应用启动时可用

### 1.4 添加 preload 暴露

- [ ] **TODO: 在 preload 中暴露 Claude API**
  - **文件路径**: `electron/preload.ts`
  - **操作**: 修改文件
  - **添加内容**:
    ```typescript
    claude: {
      media: {
        list: (projectId: string) => ipcRenderer.invoke('claude:media:list', projectId),
        info: (projectId: string, mediaId: string) => ipcRenderer.invoke('claude:media:info', projectId, mediaId),
        import: (projectId: string, source: string) => ipcRenderer.invoke('claude:media:import', projectId, source),
        delete: (projectId: string, mediaId: string) => ipcRenderer.invoke('claude:media:delete', projectId, mediaId),
        rename: (projectId: string, mediaId: string, newName: string) => ipcRenderer.invoke('claude:media:rename', projectId, mediaId, newName),
      },
      timeline: {
        export: (projectId: string, format: 'json' | 'md') => ipcRenderer.invoke('claude:timeline:export', projectId, format),
        import: (projectId: string, data: string, format: 'json' | 'md') => ipcRenderer.invoke('claude:timeline:import', projectId, data, format),
        addElement: (projectId: string, element: any) => ipcRenderer.invoke('claude:timeline:addElement', projectId, element),
        updateElement: (projectId: string, elementId: string, changes: any) => ipcRenderer.invoke('claude:timeline:updateElement', projectId, elementId, changes),
        removeElement: (projectId: string, elementId: string) => ipcRenderer.invoke('claude:timeline:removeElement', projectId, elementId),
      },
      project: {
        getSettings: (projectId: string) => ipcRenderer.invoke('claude:project:getSettings', projectId),
        updateSettings: (projectId: string, settings: any) => ipcRenderer.invoke('claude:project:updateSettings', projectId, settings),
        getStats: (projectId: string) => ipcRenderer.invoke('claude:project:getStats', projectId),
      },
      export: {
        getPresets: () => ipcRenderer.invoke('claude:export:getPresets'),
        recommend: (projectId: string, target: string) => ipcRenderer.invoke('claude:export:recommend', projectId, target),
      },
    },
    ```
  - **原因**: 让渲染进程可以调用 Claude API

### 1.5 添加 TypeScript 类型定义

- [ ] **TODO: 添加 electronAPI.claude 类型定义**
  - **文件路径**: `apps/web/src/types/electron.d.ts`
  - **操作**: 修改文件
  - **添加内容**:
    ```typescript
    interface ClaudeAPI {
      media: {
        list: (projectId: string) => Promise<MediaFile[]>;
        info: (projectId: string, mediaId: string) => Promise<MediaMetadata>;
        import: (projectId: string, source: string) => Promise<MediaFile>;
        delete: (projectId: string, mediaId: string) => Promise<void>;
        rename: (projectId: string, mediaId: string, newName: string) => Promise<void>;
      };
      timeline: {
        export: (projectId: string, format: 'json' | 'md') => Promise<string>;
        import: (projectId: string, data: string, format: 'json' | 'md') => Promise<void>;
        addElement: (projectId: string, element: TimelineElement) => Promise<string>;
        updateElement: (projectId: string, elementId: string, changes: Partial<TimelineElement>) => Promise<void>;
        removeElement: (projectId: string, elementId: string) => Promise<void>;
      };
      project: {
        getSettings: (projectId: string) => Promise<ProjectSettings>;
        updateSettings: (projectId: string, settings: Partial<ProjectSettings>) => Promise<void>;
        getStats: (projectId: string) => Promise<ProjectStats>;
      };
      export: {
        getPresets: () => Promise<ExportPreset[]>;
        recommend: (projectId: string, target: string) => Promise<ExportSettings>;
      };
    }
    
    interface ElectronAPI {
      // ... 现有类型
      claude: ClaudeAPI;
    }
    ```
  - **原因**: 完整的类型安全

---

## 2. Claude API 层

### 2.1 创建 Claude 文件夹结构

- [ ] **TODO: 创建 Claude handlers 目录**
  - **文件路径**: `electron/claude/`
  - **操作**: 创建目录
  - **子文件**:
    - `index.ts` - 导出入口
    - `claude-media-handler.ts` - Media API
    - `claude-timeline-handler.ts` - Timeline API
    - `claude-project-handler.ts` - Project API
    - `claude-export-handler.ts` - Export API
    - `utils/` - 工具函数目录
  - **原因**: 清晰的模块结构

### 2.2 创建共享工具函数

- [ ] **TODO: 创建 Claude API 工具函数**
  - **文件路径**: `electron/claude/utils/helpers.ts`
  - **操作**: 新建文件
  - **内容**:
    ```typescript
    import { app } from 'electron';
    import * as path from 'path';
    
    // 获取项目路径
    export function getProjectPath(projectId: string): string {
      const documentsPath = app.getPath('documents');
      return path.join(documentsPath, 'QCut', 'Projects', projectId);
    }
    
    // 获取媒体文件夹路径
    export function getMediaPath(projectId: string): string {
      return path.join(getProjectPath(projectId), 'media');
    }
    
    // 格式化时间 (ms -> "0:00:00")
    export function formatTime(ms: number): string {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
    
    // 解析时间 ("0:00:00" -> ms)
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
    
    // 安全路径验证
    export function isPathSafe(targetPath: string, basePath: string): boolean {
      const resolvedTarget = path.resolve(targetPath);
      const resolvedBase = path.resolve(basePath);
      return resolvedTarget.startsWith(resolvedBase + path.sep);
    }
    ```
  - **原因**: 避免代码重复，统一处理逻辑

### 2.3 创建日志工具

- [ ] **TODO: 创建 Claude API 日志模块**
  - **文件路径**: `electron/claude/utils/logger.ts`
  - **操作**: 新建文件
  - **内容**:
    ```typescript
    import log from 'electron-log';
    
    const PREFIX = '[Claude API]';
    
    export const claudeLog = {
      info: (handler: string, message: string, ...args: any[]) => 
        log.info(`${PREFIX}[${handler}] ${message}`, ...args),
      warn: (handler: string, message: string, ...args: any[]) => 
        log.warn(`${PREFIX}[${handler}] ${message}`, ...args),
      error: (handler: string, message: string, ...args: any[]) => 
        log.error(`${PREFIX}[${handler}] ${message}`, ...args),
      debug: (handler: string, message: string, ...args: any[]) => 
        log.debug(`${PREFIX}[${handler}] ${message}`, ...args),
    };
    ```
  - **原因**: 统一日志格式，便于调试

---

## 3. Media API

### 3.1 创建 Media Handler

- [ ] **TODO: 实现 claude:media:list**
  - **文件路径**: `electron/claude/claude-media-handler.ts`
  - **操作**: 新建文件
  - **内容**:
    ```typescript
    import { ipcMain } from 'electron';
    import * as fs from 'fs/promises';
    import * as path from 'path';
    import { getMediaPath, isPathSafe } from './utils/helpers';
    import { claudeLog } from './utils/logger';
    
    interface MediaFile {
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
    
    export function setupClaudeMediaIPC(): void {
      claudeLog.info('Media', 'Setting up Media IPC handlers...');
      
      // 列出所有媒体文件
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
            const ext = path.extname(entry.name).toLowerCase();
            
            const type = getMediaType(ext);
            if (!type) continue;
            
            files.push({
              id: generateMediaId(entry.name),
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
      
      // 获取媒体详情
      ipcMain.handle('claude:media:info', async (event, projectId: string, mediaId: string): Promise<MediaFile | null> => {
        // TODO: 实现
      });
      
      // 导入媒体
      ipcMain.handle('claude:media:import', async (event, projectId: string, source: string): Promise<MediaFile | null> => {
        // TODO: 实现
      });
      
      // 删除媒体
      ipcMain.handle('claude:media:delete', async (event, projectId: string, mediaId: string): Promise<boolean> => {
        // TODO: 实现
      });
      
      // 重命名媒体
      ipcMain.handle('claude:media:rename', async (event, projectId: string, mediaId: string, newName: string): Promise<boolean> => {
        // TODO: 实现
      });
      
      claudeLog.info('Media', 'Media IPC handlers registered');
    }
    
    function getMediaType(ext: string): 'video' | 'audio' | 'image' | null {
      const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
      const audioExts = ['.mp3', '.wav', '.aac', '.ogg', '.m4a'];
      const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      
      if (videoExts.includes(ext)) return 'video';
      if (audioExts.includes(ext)) return 'audio';
      if (imageExts.includes(ext)) return 'image';
      return null;
    }
    
    function generateMediaId(filename: string): string {
      return `media_${Buffer.from(filename).toString('base64url')}`;
    }
    ```
  - **原因**: 提供媒体文件访问能力

### 3.2 添加媒体元数据读取

- [ ] **TODO: 实现媒体元数据读取 (使用 FFprobe)**
  - **文件路径**: `electron/claude/utils/media-metadata.ts`
  - **操作**: 新建文件
  - **依赖**: 需要复用现有的 FFmpeg handler
  - **内容**:
    ```typescript
    import { execFile } from 'child_process';
    import { promisify } from 'util';
    
    const execFileAsync = promisify(execFile);
    
    interface MediaMetadata {
      duration?: number;  // ms
      width?: number;
      height?: number;
      fps?: number;
      codec?: string;
      bitrate?: number;
    }
    
    export async function getMediaMetadata(filePath: string, ffprobePath: string): Promise<MediaMetadata> {
      // TODO: 使用 ffprobe 获取元数据
    }
    ```
  - **原因**: 提供完整的媒体信息

---

## 4. Timeline API

### 4.1 创建 Timeline Handler

- [ ] **TODO: 实现 Timeline export/import**
  - **文件路径**: `electron/claude/claude-timeline-handler.ts`
  - **操作**: 新建文件
  - **内容**:
    ```typescript
    import { ipcMain, BrowserWindow } from 'electron';
    import * as fs from 'fs/promises';
    import * as path from 'path';
    import { getProjectPath, formatTime, parseTime } from './utils/helpers';
    import { claudeLog } from './utils/logger';
    
    interface TimelineElement {
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
    
    interface Timeline {
      name: string;
      duration: number;
      width: number;
      height: number;
      fps: number;
      tracks: {
        index: number;
        name: string;
        type: string;
        elements: TimelineElement[];
      }[];
    }
    
    export function setupClaudeTimelineIPC(): void {
      claudeLog.info('Timeline', 'Setting up Timeline IPC handlers...');
      
      // 导出 Timeline
      ipcMain.handle('claude:timeline:export', async (event, projectId: string, format: 'json' | 'md'): Promise<string> => {
        claudeLog.info('Timeline', `Exporting timeline for project: ${projectId}, format: ${format}`);
        
        // 从渲染进程获取当前 timeline 状态
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) throw new Error('Window not found');
        
        // 请求渲染进程提供 timeline 数据
        const timeline = await requestTimelineFromRenderer(win);
        
        if (format === 'md') {
          return timelineToMarkdown(timeline);
        }
        return JSON.stringify(timeline, null, 2);
      });
      
      // 导入 Timeline
      ipcMain.handle('claude:timeline:import', async (event, projectId: string, data: string, format: 'json' | 'md'): Promise<void> => {
        claudeLog.info('Timeline', `Importing timeline for project: ${projectId}, format: ${format}`);
        
        let timeline: Timeline;
        
        if (format === 'md') {
          timeline = markdownToTimeline(data);
        } else {
          timeline = JSON.parse(data);
        }
        
        // 验证 timeline
        validateTimeline(timeline);
        
        // 发送到渲染进程应用更改
        event.sender.send('claude:timeline:apply', timeline);
      });
      
      // 添加元素
      ipcMain.handle('claude:timeline:addElement', async (event, projectId: string, element: Partial<TimelineElement>): Promise<string> => {
        // TODO: 实现
        return '';
      });
      
      // 更新元素
      ipcMain.handle('claude:timeline:updateElement', async (event, projectId: string, elementId: string, changes: Partial<TimelineElement>): Promise<void> => {
        // TODO: 实现
      });
      
      // 删除元素
      ipcMain.handle('claude:timeline:removeElement', async (event, projectId: string, elementId: string): Promise<void> => {
        // TODO: 实现
      });
      
      claudeLog.info('Timeline', 'Timeline IPC handlers registered');
    }
    
    async function requestTimelineFromRenderer(win: BrowserWindow): Promise<Timeline> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout waiting for timeline')), 5000);
        
        ipcMain.once('claude:timeline:response', (event, timeline: Timeline) => {
          clearTimeout(timeout);
          resolve(timeline);
        });
        
        win.webContents.send('claude:timeline:request');
      });
    }
    
    function timelineToMarkdown(timeline: Timeline): string {
      let md = `# Timeline: ${timeline.name}\n\n`;
      md += `## Project Info\n\n`;
      md += `- **Duration**: ${formatTime(timeline.duration)}\n`;
      md += `- **Resolution**: ${timeline.width}x${timeline.height}\n`;
      md += `- **FPS**: ${timeline.fps}\n\n`;
      
      for (const track of timeline.tracks) {
        md += `## Track ${track.index + 1}: ${track.name || track.type}\n\n`;
        
        if (track.elements.length === 0) {
          md += `*Empty track*\n\n`;
          continue;
        }
        
        md += `| ID | Start | End | Type | Source | Content |\n`;
        md += `|----|-------|-----|------|--------|--------|\n`;
        
        for (const element of track.elements) {
          const content = element.content || element.sourceName || '-';
          md += `| ${element.id} | ${formatTime(element.startTime)} | ${formatTime(element.endTime)} | ${element.type} | ${element.sourceName || '-'} | ${content.substring(0, 30)} |\n`;
        }
        md += `\n`;
      }
      
      return md;
    }
    
    function markdownToTimeline(md: string): Timeline {
      // TODO: 实现 Markdown 解析
      // 这是一个复杂的解析任务，需要仔细处理
      throw new Error('Markdown import not yet implemented');
    }
    
    function validateTimeline(timeline: Timeline): void {
      if (!timeline.name) throw new Error('Timeline must have a name');
      if (!timeline.tracks || !Array.isArray(timeline.tracks)) {
        throw new Error('Timeline must have tracks array');
      }
      // TODO: 更多验证
    }
    ```
  - **原因**: 核心功能 - 让 Claude 读写 Timeline

### 4.2 创建渲染进程 Timeline Bridge

- [ ] **TODO: 在渲染进程添加 Timeline 响应器**
  - **文件路径**: `apps/web/src/lib/claude-timeline-bridge.ts`
  - **操作**: 新建文件
  - **内容**:
    ```typescript
    import { useTimelineStore } from '@/stores/timeline-store';
    import { useProjectStore } from '@/stores/project-store';
    
    // 监听 Claude Timeline 请求
    export function setupClaudeTimelineBridge(): void {
      if (!window.electronAPI) return;
      
      // 响应 timeline 导出请求
      window.electronAPI.on('claude:timeline:request', () => {
        const timelineState = useTimelineStore.getState();
        const projectState = useProjectStore.getState();
        
        const timeline = {
          name: projectState.activeProject?.name || 'Untitled',
          duration: timelineState.duration,
          width: projectState.activeProject?.width || 1920,
          height: projectState.activeProject?.height || 1080,
          fps: projectState.activeProject?.fps || 30,
          tracks: formatTracksForExport(timelineState.tracks),
        };
        
        window.electronAPI.send('claude:timeline:response', timeline);
      });
      
      // 响应 timeline 导入
      window.electronAPI.on('claude:timeline:apply', (timeline: any) => {
        const timelineStore = useTimelineStore.getState();
        // TODO: 应用 timeline 更改
        // timelineStore.importTimeline(timeline);
      });
    }
    
    function formatTracksForExport(tracks: any[]): any[] {
      // TODO: 将内部格式转换为导出格式
      return tracks.map((track, index) => ({
        index,
        name: track.name || `Track ${index + 1}`,
        type: track.type,
        elements: track.elements.map(formatElementForExport),
      }));
    }
    
    function formatElementForExport(element: any): any {
      return {
        id: element.id,
        startTime: element.startTime,
        endTime: element.endTime,
        type: element.type,
        sourceId: element.mediaId,
        sourceName: element.mediaName,
        content: element.content,
      };
    }
    ```
  - **原因**: 连接主进程和渲染进程的 Timeline 数据

### 4.3 注册 Timeline Bridge

- [ ] **TODO: 在 App 启动时注册 Timeline Bridge**
  - **文件路径**: `apps/web/src/App.tsx`
  - **操作**: 修改文件
  - **添加位置**: 在组件挂载时
  - **添加内容**:
    ```typescript
    import { setupClaudeTimelineBridge } from '@/lib/claude-timeline-bridge';
    
    // 在 useEffect 中
    useEffect(() => {
      setupClaudeTimelineBridge();
    }, []);
    ```
  - **原因**: 确保 Bridge 在应用启动时初始化

---

## 5. Project API

### 5.1 创建 Project Handler

- [ ] **TODO: 实现 Project 设置读写**
  - **文件路径**: `electron/claude/claude-project-handler.ts`
  - **操作**: 新建文件
  - **内容**:
    ```typescript
    import { ipcMain } from 'electron';
    import * as fs from 'fs/promises';
    import * as path from 'path';
    import { getProjectPath } from './utils/helpers';
    import { claudeLog } from './utils/logger';
    
    interface ProjectSettings {
      name: string;
      width: number;
      height: number;
      fps: number;
      aspectRatio: string;
      backgroundColor: string;
      exportFormat: string;
      exportQuality: string;
    }
    
    interface ProjectStats {
      totalDuration: number;
      mediaCount: { video: number; audio: number; image: number };
      trackCount: number;
      elementCount: number;
      lastModified: number;
      fileSize: number;
    }
    
    export function setupClaudeProjectIPC(): void {
      claudeLog.info('Project', 'Setting up Project IPC handlers...');
      
      // 获取项目设置
      ipcMain.handle('claude:project:getSettings', async (event, projectId: string): Promise<ProjectSettings> => {
        const projectPath = getProjectPath(projectId);
        const settingsPath = path.join(projectPath, 'project.json');
        
        try {
          const content = await fs.readFile(settingsPath, 'utf-8');
          const project = JSON.parse(content);
          
          return {
            name: project.name,
            width: project.width,
            height: project.height,
            fps: project.fps,
            aspectRatio: project.aspectRatio || `${project.width}:${project.height}`,
            backgroundColor: project.backgroundColor || '#000000',
            exportFormat: project.exportFormat || 'mp4',
            exportQuality: project.exportQuality || 'high',
          };
        } catch (error) {
          claudeLog.error('Project', 'Failed to read project settings:', error);
          throw error;
        }
      });
      
      // 更新项目设置
      ipcMain.handle('claude:project:updateSettings', async (event, projectId: string, settings: Partial<ProjectSettings>): Promise<void> => {
        const projectPath = getProjectPath(projectId);
        const settingsPath = path.join(projectPath, 'project.json');
        
        try {
          const content = await fs.readFile(settingsPath, 'utf-8');
          const project = JSON.parse(content);
          
          // 合并设置
          Object.assign(project, settings);
          
          // 写回文件
          await fs.writeFile(settingsPath, JSON.stringify(project, null, 2), 'utf-8');
          
          // 通知渲染进程
          event.sender.send('claude:project:updated', projectId, settings);
          
          claudeLog.info('Project', `Updated settings for project: ${projectId}`);
        } catch (error) {
          claudeLog.error('Project', 'Failed to update project settings:', error);
          throw error;
        }
      });
      
      // 获取项目统计
      ipcMain.handle('claude:project:getStats', async (event, projectId: string): Promise<ProjectStats> => {
        // TODO: 从渲染进程获取实时统计
        // 或者从项目文件中计算
        return {
          totalDuration: 0,
          mediaCount: { video: 0, audio: 0, image: 0 },
          trackCount: 0,
          elementCount: 0,
          lastModified: Date.now(),
          fileSize: 0,
        };
      });
      
      claudeLog.info('Project', 'Project IPC handlers registered');
    }
    ```
  - **原因**: 让 Claude 读取和修改项目设置

---

## 6. Export API

### 6.1 创建 Export Handler

- [ ] **TODO: 实现导出推荐功能**
  - **文件路径**: `electron/claude/claude-export-handler.ts`
  - **操作**: 新建文件
  - **内容**:
    ```typescript
    import { ipcMain } from 'electron';
    import { claudeLog } from './utils/logger';
    
    interface ExportPreset {
      id: string;
      name: string;
      platform: string;
      width: number;
      height: number;
      fps: number;
      bitrate: string;
      format: string;
    }
    
    interface ExportRecommendation {
      preset: ExportPreset;
      warnings: string[];
      suggestions: string[];
    }
    
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
        name: 'Instagram Post',
        platform: 'instagram',
        width: 1080,
        height: 1080,
        fps: 30,
        bitrate: '5Mbps',
        format: 'mp4',
      },
    ];
    
    export function setupClaudeExportIPC(): void {
      claudeLog.info('Export', 'Setting up Export IPC handlers...');
      
      // 获取所有预设
      ipcMain.handle('claude:export:getPresets', async (): Promise<ExportPreset[]> => {
        return PRESETS;
      });
      
      // 推荐导出设置
      ipcMain.handle('claude:export:recommend', async (event, projectId: string, target: string): Promise<ExportRecommendation> => {
        claudeLog.info('Export', `Recommending export for project: ${projectId}, target: ${target}`);
        
        // 找到匹配的预设
        const preset = PRESETS.find(p => p.platform === target) || PRESETS[1]; // 默认 YouTube 1080p
        
        // TODO: 分析项目并生成警告和建议
        const warnings: string[] = [];
        const suggestions: string[] = [];
        
        // 示例逻辑
        // if (projectDuration > 60 && target === 'tiktok') {
        //   warnings.push('TikTok videos should be under 60 seconds for best engagement');
        // }
        
        return { preset, warnings, suggestions };
      });
      
      claudeLog.info('Export', 'Export IPC handlers registered');
    }
    ```
  - **原因**: 让 Claude 提供智能导出建议

---

## 7. 错误处理与诊断

### 7.1 创建错误诊断模块

- [ ] **TODO: 实现错误收集和诊断**
  - **文件路径**: `electron/claude/claude-diagnostics-handler.ts`
  - **操作**: 新建文件
  - **内容**:
    ```typescript
    import { ipcMain, app } from 'electron';
    import * as os from 'os';
    import { claudeLog } from './utils/logger';
    
    interface ErrorReport {
      message: string;
      stack?: string;
      context: string;
      timestamp: number;
      systemInfo: SystemInfo;
    }
    
    interface SystemInfo {
      platform: string;
      arch: string;
      version: string;
      appVersion: string;
      memory: { total: number; free: number };
    }
    
    interface DiagnosticResult {
      errorType: string;
      possibleCauses: string[];
      suggestedFixes: string[];
      canAutoFix: boolean;
      autoFixAction?: string;
    }
    
    export function setupClaudeDiagnosticsIPC(): void {
      claudeLog.info('Diagnostics', 'Setting up Diagnostics IPC handlers...');
      
      // 报告错误并获取诊断
      ipcMain.handle('claude:diagnostics:analyze', async (event, error: ErrorReport): Promise<DiagnosticResult> => {
        claudeLog.info('Diagnostics', `Analyzing error: ${error.message}`);
        
        // 收集系统信息
        error.systemInfo = {
          platform: os.platform(),
          arch: os.arch(),
          version: os.release(),
          appVersion: app.getVersion(),
          memory: { total: os.totalmem(), free: os.freemem() },
        };
        
        // TODO: 使用 Claude API 分析错误
        // 目前返回基础诊断
        return analyzeErrorLocally(error);
      });
      
      claudeLog.info('Diagnostics', 'Diagnostics IPC handlers registered');
    }
    
    function analyzeErrorLocally(error: ErrorReport): DiagnosticResult {
      const result: DiagnosticResult = {
        errorType: 'unknown',
        possibleCauses: [],
        suggestedFixes: [],
        canAutoFix: false,
      };
      
      // 基于错误消息的简单诊断
      if (error.message.includes('ENOENT')) {
        result.errorType = 'file_not_found';
        result.possibleCauses = ['文件已被移动或删除', '路径不正确'];
        result.suggestedFixes = ['检查文件是否存在', '重新导入媒体文件'];
      } else if (error.message.includes('ENOMEM') || error.message.includes('memory')) {
        result.errorType = 'out_of_memory';
        result.possibleCauses = ['系统内存不足', '项目过大'];
        result.suggestedFixes = ['关闭其他应用程序', '减少项目中的媒体文件'];
      } else if (error.message.includes('FFmpeg')) {
        result.errorType = 'ffmpeg_error';
        result.possibleCauses = ['FFmpeg 处理失败', '不支持的格式'];
        result.suggestedFixes = ['检查媒体格式是否支持', '尝试转换格式后重新导入'];
      }
      
      return result;
    }
    ```
  - **原因**: 提供智能错误诊断

### 7.2 创建错误边界组件

- [ ] **TODO: 创建 Claude 增强的错误边界**
  - **文件路径**: `apps/web/src/components/claude-error-boundary.tsx`
  - **操作**: 新建文件
  - **内容**:
    ```typescript
    import React, { Component, ReactNode } from 'react';
    import { Button } from '@/components/ui/button';
    
    interface Props {
      children: ReactNode;
      fallback?: ReactNode;
    }
    
    interface State {
      hasError: boolean;
      error?: Error;
      diagnosis?: any;
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
        this.analyzError(error, errorInfo);
      }
      
      async analyzeError(error: Error, errorInfo: React.ErrorInfo): Promise<void> {
        if (!window.electronAPI?.claude?.diagnostics) return;
        
        this.setState({ isAnalyzing: true });
        
        try {
          const diagnosis = await window.electronAPI.claude.diagnostics.analyze({
            message: error.message,
            stack: error.stack,
            context: errorInfo.componentStack || '',
            timestamp: Date.now(),
          });
          
          this.setState({ diagnosis, isAnalyzing: false });
        } catch (e) {
          this.setState({ isAnalyzing: false });
        }
      }
      
      render(): ReactNode {
        if (this.state.hasError) {
          return (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <h2 className="text-lg font-semibold text-red-800">出现错误</h2>
              <p className="text-red-600 mt-2">{this.state.error?.message}</p>
              
              {this.state.isAnalyzing && (
                <p className="text-gray-500 mt-2">正在分析错误...</p>
              )}
              
              {this.state.diagnosis && (
                <div className="mt-4">
                  <h3 className="font-medium">可能的原因:</h3>
                  <ul className="list-disc pl-5 mt-1">
                    {this.state.diagnosis.possibleCauses.map((cause: string, i: number) => (
                      <li key={i}>{cause}</li>
                    ))}
                  </ul>
                  
                  <h3 className="font-medium mt-3">建议的解决方案:</h3>
                  <ul className="list-disc pl-5 mt-1">
                    {this.state.diagnosis.suggestedFixes.map((fix: string, i: number) => (
                      <li key={i}>{fix}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              <Button
                className="mt-4"
                onClick={() => this.setState({ hasError: false, error: undefined, diagnosis: undefined })}
              >
                重试
              </Button>
            </div>
          );
        }
        
        return this.props.children;
      }
    }
    ```
  - **原因**: 捕获错误并提供智能诊断

---

## 8. UI 集成

### 8.1 创建 Claude 控制面板

- [ ] **TODO: 创建 Claude 控制面板组件**
  - **文件路径**: `apps/web/src/components/editor/claude-panel.tsx`
  - **操作**: 新建文件
  - **内容**: (独立的 Claude 控制 UI)
  - **原因**: 让用户直接与 Claude 交互

### 8.2 添加 Claude 菜单项

- [ ] **TODO: 在编辑器菜单添加 Claude 选项**
  - **文件路径**: `apps/web/src/components/editor-header.tsx`
  - **操作**: 修改文件
  - **添加内容**: Claude 菜单（导出 Timeline、分析项目等）
  - **原因**: 便捷访问 Claude 功能

---

## 9. 文档与测试

### 9.1 更新 CLAUDE.md

- [ ] **TODO: 在 CLAUDE.md 中记录新 API**
  - **文件路径**: `CLAUDE.md`
  - **操作**: 修改文件
  - **添加内容**: Claude API 使用说明
  - **原因**: 开发者文档

### 9.2 创建 API 参考文档

- [ ] **TODO: 创建 Claude API 参考文档**
  - **文件路径**: `docs/claude-api.md`
  - **操作**: 新建文件
  - **内容**: 完整的 API 参考
  - **原因**: 便于 Claude 和开发者理解 API

### 9.3 添加单元测试

- [ ] **TODO: 为 Claude handlers 添加测试**
  - **文件路径**: `apps/web/src/lib/__tests__/claude-timeline-bridge.test.ts`
  - **操作**: 新建文件
  - **原因**: 确保功能正确

### 9.4 添加集成测试

- [ ] **TODO: 添加 Claude API 集成测试**
  - **文件路径**: `apps/web/src/lib/__tests__/claude-api-integration.test.ts`
  - **操作**: 新建文件
  - **原因**: 端到端测试

---

## 📊 实现进度跟踪

| 模块 | TODO 数量 | 完成 | 进度 |
|------|----------|------|------|
| 基础设施 | 5 | 0 | 0% |
| Claude API 层 | 3 | 0 | 0% |
| Media API | 2 | 0 | 0% |
| Timeline API | 3 | 0 | 0% |
| Project API | 1 | 0 | 0% |
| Export API | 1 | 0 | 0% |
| 错误处理 | 2 | 0 | 0% |
| UI 集成 | 2 | 0 | 0% |
| 文档与测试 | 4 | 0 | 0% |
| **总计** | **23** | **0** | **0%** |

---

## 🎯 实现顺序建议

### Phase 1: 基础 (Week 1)
1. 基础设施 (1.1 - 1.5)
2. Claude API 层 (2.1 - 2.3)

### Phase 2: 核心 API (Week 2)
3. Timeline API (4.1 - 4.3) - **最高优先级**
4. Media API (3.1 - 3.2)

### Phase 3: 扩展 (Week 3)
5. Project API (5.1)
6. Export API (6.1)
7. 错误处理 (7.1 - 7.2)

### Phase 4: 完善 (Week 4)
8. UI 集成 (8.1 - 8.2)
9. 文档与测试 (9.1 - 9.4)

---

*创建日期: 2026-01-31*
*最后更新: 2026-01-31*
*维护者: Claude Code Integration Team*
