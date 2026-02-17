/**
 * Preload integration API builders.
 *
 * Each function returns an API group object that gets spread
 * into the main electronAPI in preload.ts.
 *
 * @module electron/preload-integrations
 */

import { ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  ElectronAPI,
  Skill,
  MediaImportOptions,
  MediaImportResult,
} from "./preload-types.js";
import type {
  MediaFile,
  ClaudeTimeline,
  ClaudeElement,
  ClaudeSplitResponse,
  ClaudeMoveRequest,
  ClaudeSelectionItem,
  ProjectSettings,
  ProjectStats,
  ExportPreset,
  ExportRecommendation,
  ErrorReport,
  DiagnosticResult,
} from "./types/claude-api.js";

// ============================================================================
// PTY Terminal
// ============================================================================

/** Create the PTY terminal API for the renderer process. */
export function createPtyAPI(): ElectronAPI["pty"] {
  return {
    spawn: (options?) => ipcRenderer.invoke("pty:spawn", options),
    write: (sessionId, data) =>
      ipcRenderer.invoke("pty:write", sessionId, data),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.invoke("pty:resize", sessionId, cols, rows),
    kill: (sessionId) => ipcRenderer.invoke("pty:kill", sessionId),
    killAll: () => ipcRenderer.invoke("pty:kill-all"),
    onData: (callback) => {
      ipcRenderer.removeAllListeners("pty:data");
      ipcRenderer.on("pty:data", (_, data) => callback(data));
    },
    onExit: (callback) => {
      ipcRenderer.removeAllListeners("pty:exit");
      ipcRenderer.on("pty:exit", (_, data) => callback(data));
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners("pty:data");
      ipcRenderer.removeAllListeners("pty:exit");
    },
  };
}

// ============================================================================
// MCP App Bridge
// ============================================================================

/** Create the MCP app bridge API for the renderer process. */
export function createMcpAPI(): NonNullable<ElectronAPI["mcp"]> {
  return {
    onAppHtml: (callback) => {
      ipcRenderer.removeAllListeners("mcp:app-html");
      ipcRenderer.on("mcp:app-html", (_, payload) => callback(payload));
    },
    removeListeners: () => {
      ipcRenderer.removeAllListeners("mcp:app-html");
    },
  };
}

// ============================================================================
// Skills
// ============================================================================

/** Create the skills management API for the renderer process. */
export function createSkillsAPI(): NonNullable<ElectronAPI["skills"]> {
  return {
    list: (projectId) => ipcRenderer.invoke("skills:list", projectId),
    import: (projectId, sourcePath) =>
      ipcRenderer.invoke("skills:import", projectId, sourcePath),
    delete: (projectId, skillId) =>
      ipcRenderer.invoke("skills:delete", projectId, skillId),
    getContent: (projectId, skillId, filename) =>
      ipcRenderer.invoke("skills:getContent", projectId, skillId, filename),
    browse: () => ipcRenderer.invoke("skills:browse"),
    getPath: (projectId) => ipcRenderer.invoke("skills:getPath", projectId),
    scanGlobal: () => ipcRenderer.invoke("skills:scanGlobal"),
    syncForClaude: (projectId) =>
      ipcRenderer.invoke("skills:syncForClaude", projectId),
  };
}

// ============================================================================
// AI Pipeline
// ============================================================================

/** Create the AI content pipeline API for the renderer process. */
export function createAIPipelineAPI(): NonNullable<ElectronAPI["aiPipeline"]> {
  return {
    check: () => ipcRenderer.invoke("ai-pipeline:check"),
    status: () => ipcRenderer.invoke("ai-pipeline:status"),
    generate: (options) => ipcRenderer.invoke("ai-pipeline:generate", options),
    listModels: () => ipcRenderer.invoke("ai-pipeline:list-models"),
    estimateCost: (options) =>
      ipcRenderer.invoke("ai-pipeline:estimate-cost", options),
    cancel: (sessionId) => ipcRenderer.invoke("ai-pipeline:cancel", sessionId),
    refresh: () => ipcRenderer.invoke("ai-pipeline:refresh"),
    onProgress: (callback) => {
      const handler = (
        _event: IpcRendererEvent,
        progress: {
          stage: string;
          percent: number;
          message: string;
          model?: string;
          eta?: number;
          sessionId?: string;
        }
      ) => callback(progress);
      ipcRenderer.on("ai-pipeline:progress", handler);
      return () => {
        ipcRenderer.removeListener("ai-pipeline:progress", handler);
      };
    },
  };
}

// ============================================================================
// Media Import
// ============================================================================

/** Create the media import API for the renderer process. */
export function createMediaImportAPI(): NonNullable<
  ElectronAPI["mediaImport"]
> {
  return {
    import: (options) => ipcRenderer.invoke("media-import:import", options),
    validateSymlink: (path) =>
      ipcRenderer.invoke("media-import:validate-symlink", path),
    locateOriginal: (mediaPath) =>
      ipcRenderer.invoke("media-import:locate-original", mediaPath),
    relinkMedia: (projectId, mediaId, newSourcePath) =>
      ipcRenderer.invoke(
        "media-import:relink",
        projectId,
        mediaId,
        newSourcePath
      ),
    remove: (projectId, mediaId) =>
      ipcRenderer.invoke("media-import:remove", projectId, mediaId),
    checkSymlinkSupport: () =>
      ipcRenderer.invoke("media-import:check-symlink-support"),
    getMediaPath: (projectId) =>
      ipcRenderer.invoke("media-import:get-media-path", projectId),
  };
}

// ============================================================================
// Project Folder
// ============================================================================

/** Create the project folder API for the renderer process. */
export function createProjectFolderAPI(): NonNullable<
  ElectronAPI["projectFolder"]
> {
  return {
    getRoot: (projectId) =>
      ipcRenderer.invoke("project-folder:get-root", projectId),
    scan: (projectId, subPath?, options?) =>
      ipcRenderer.invoke("project-folder:scan", projectId, subPath, options),
    list: (projectId, subPath?) =>
      ipcRenderer.invoke("project-folder:list", projectId, subPath),
    ensureStructure: (projectId) =>
      ipcRenderer.invoke("project-folder:ensure-structure", projectId),
  };
}

// ============================================================================
// Claude Code Integration
// ============================================================================

/** Create the Claude code integration API for the renderer process. */
export function createClaudeAPI(): NonNullable<ElectronAPI["claude"]> {
  return {
    media: {
      list: (projectId) => ipcRenderer.invoke("claude:media:list", projectId),
      info: (projectId, mediaId) =>
        ipcRenderer.invoke("claude:media:info", projectId, mediaId),
      import: (projectId, source) =>
        ipcRenderer.invoke("claude:media:import", projectId, source),
      delete: (projectId, mediaId) =>
        ipcRenderer.invoke("claude:media:delete", projectId, mediaId),
      rename: (projectId, mediaId, newName) =>
        ipcRenderer.invoke("claude:media:rename", projectId, mediaId, newName),
    },
    timeline: {
      export: (projectId, format) =>
        ipcRenderer.invoke("claude:timeline:export", projectId, format),
      import: (projectId, data, format) =>
        ipcRenderer.invoke("claude:timeline:import", projectId, data, format),
      addElement: (projectId, element) =>
        ipcRenderer.invoke("claude:timeline:addElement", projectId, element),
      updateElement: (projectId, elementId, changes) =>
        ipcRenderer.invoke(
          "claude:timeline:updateElement",
          projectId,
          elementId,
          changes
        ),
      removeElement: (projectId, elementId) =>
        ipcRenderer.invoke(
          "claude:timeline:removeElement",
          projectId,
          elementId
        ),
      splitElement: (projectId, elementId, splitTime, mode) =>
        ipcRenderer.invoke(
          "claude:timeline:splitElement",
          projectId,
          elementId,
          splitTime,
          mode
        ),
      moveElement: (projectId, elementId, toTrackId, newStartTime) =>
        ipcRenderer.invoke(
          "claude:timeline:moveElement",
          projectId,
          elementId,
          toTrackId,
          newStartTime
        ),
      selectElements: (projectId, elements) =>
        ipcRenderer.invoke(
          "claude:timeline:selectElements",
          projectId,
          elements
        ),
      getSelection: (projectId) =>
        ipcRenderer.invoke("claude:timeline:getSelection", projectId),
      clearSelection: (projectId) =>
        ipcRenderer.invoke("claude:timeline:clearSelection", projectId),
      onRequest: (callback) => {
        ipcRenderer.removeAllListeners("claude:timeline:request");
        ipcRenderer.on("claude:timeline:request", () => callback());
      },
      onApply: (callback) => {
        ipcRenderer.removeAllListeners("claude:timeline:apply");
        ipcRenderer.on("claude:timeline:apply", (_, timeline) =>
          callback(timeline)
        );
      },
      onAddElement: (callback) => {
        ipcRenderer.removeAllListeners("claude:timeline:addElement");
        ipcRenderer.on("claude:timeline:addElement", (_, element) =>
          callback(element)
        );
      },
      onUpdateElement: (callback) => {
        ipcRenderer.removeAllListeners("claude:timeline:updateElement");
        ipcRenderer.on("claude:timeline:updateElement", (_, data) =>
          callback(data)
        );
      },
      onRemoveElement: (callback) => {
        ipcRenderer.removeAllListeners("claude:timeline:removeElement");
        ipcRenderer.on("claude:timeline:removeElement", (_, id) =>
          callback(id)
        );
      },
      onSplitElement: (callback) => {
        ipcRenderer.removeAllListeners("claude:timeline:splitElement");
        ipcRenderer.on("claude:timeline:splitElement", (_, data) =>
          callback(data)
        );
      },
      sendSplitResponse: (requestId, result) => {
        ipcRenderer.send("claude:timeline:splitElement:response", {
          requestId,
          result,
        });
      },
      onMoveElement: (callback) => {
        ipcRenderer.removeAllListeners("claude:timeline:moveElement");
        ipcRenderer.on("claude:timeline:moveElement", (_, data) =>
          callback(data)
        );
      },
      onSelectElements: (callback) => {
        ipcRenderer.removeAllListeners("claude:timeline:selectElements");
        ipcRenderer.on("claude:timeline:selectElements", (_, data) =>
          callback(data)
        );
      },
      onGetSelection: (callback) => {
        ipcRenderer.removeAllListeners("claude:timeline:getSelection");
        ipcRenderer.on("claude:timeline:getSelection", (_, data) =>
          callback(data)
        );
      },
      sendSelectionResponse: (requestId, elements) => {
        ipcRenderer.send("claude:timeline:getSelection:response", {
          requestId,
          elements,
        });
      },
      onClearSelection: (callback) => {
        ipcRenderer.removeAllListeners("claude:timeline:clearSelection");
        ipcRenderer.on("claude:timeline:clearSelection", () => callback());
      },
      sendResponse: (timeline) => {
        ipcRenderer.send("claude:timeline:response", timeline);
      },
      removeListeners: () => {
        ipcRenderer.removeAllListeners("claude:timeline:request");
        ipcRenderer.removeAllListeners("claude:timeline:apply");
        ipcRenderer.removeAllListeners("claude:timeline:addElement");
        ipcRenderer.removeAllListeners("claude:timeline:updateElement");
        ipcRenderer.removeAllListeners("claude:timeline:removeElement");
        ipcRenderer.removeAllListeners("claude:timeline:splitElement");
        ipcRenderer.removeAllListeners("claude:timeline:moveElement");
        ipcRenderer.removeAllListeners("claude:timeline:selectElements");
        ipcRenderer.removeAllListeners("claude:timeline:getSelection");
        ipcRenderer.removeAllListeners("claude:timeline:clearSelection");
      },
    },
    project: {
      getSettings: (projectId) =>
        ipcRenderer.invoke("claude:project:getSettings", projectId),
      updateSettings: (projectId, settings) =>
        ipcRenderer.invoke(
          "claude:project:updateSettings",
          projectId,
          settings
        ),
      getStats: (projectId) =>
        ipcRenderer.invoke("claude:project:getStats", projectId),
      onStatsRequest: (callback) => {
        ipcRenderer.removeAllListeners("claude:project:statsRequest");
        ipcRenderer.on(
          "claude:project:statsRequest",
          (_event, { projectId, requestId }) => callback(projectId, requestId)
        );
      },
      sendStatsResponse: (stats, requestId) => {
        ipcRenderer.send("claude:project:statsResponse", stats, requestId);
      },
      onUpdated: (callback) => {
        ipcRenderer.removeAllListeners("claude:project:updated");
        ipcRenderer.on("claude:project:updated", (_, projectId, settings) =>
          callback(projectId, settings)
        );
      },
      removeListeners: () => {
        ipcRenderer.removeAllListeners("claude:project:statsRequest");
        ipcRenderer.removeAllListeners("claude:project:updated");
      },
    },
    export: {
      getPresets: () => ipcRenderer.invoke("claude:export:getPresets"),
      recommend: (projectId, target) =>
        ipcRenderer.invoke("claude:export:recommend", projectId, target),
    },
    diagnostics: {
      analyze: (error) =>
        ipcRenderer.invoke("claude:diagnostics:analyze", error),
    },
  };
}

// ============================================================================
// Remotion Folder
// ============================================================================

/** Create the Remotion folder API for the renderer process. */
export function createRemotionFolderAPI(): NonNullable<
  ElectronAPI["remotionFolder"]
> {
  return {
    select: () => ipcRenderer.invoke("remotion-folder:select"),
    scan: (folderPath) =>
      ipcRenderer.invoke("remotion-folder:scan", folderPath),
    bundle: (folderPath, compositionIds?) =>
      ipcRenderer.invoke("remotion-folder:bundle", folderPath, compositionIds),
    import: (folderPath) =>
      ipcRenderer.invoke("remotion-folder:import", folderPath),
    checkBundler: () => ipcRenderer.invoke("remotion-folder:check-bundler"),
    validate: (folderPath) =>
      ipcRenderer.invoke("remotion-folder:validate", folderPath),
  };
}

// ============================================================================
// Updates & Release Notes
// ============================================================================

/** Create the auto-updates and release notes API for the renderer process. */
export function createUpdatesAPI(): NonNullable<ElectronAPI["updates"]> {
  return {
    checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
    installUpdate: () => ipcRenderer.invoke("install-update"),
    getReleaseNotes: (version?) =>
      ipcRenderer.invoke("get-release-notes", version),
    getChangelog: () => ipcRenderer.invoke("get-changelog"),
    onUpdateAvailable: (callback) => {
      const handler = (
        _: IpcRendererEvent,
        data: {
          version: string;
          releaseNotes?: string;
          releaseDate?: string;
        }
      ) => callback(data);
      ipcRenderer.on("update-available", handler);
      return () => ipcRenderer.removeListener("update-available", handler);
    },
    onDownloadProgress: (callback) => {
      const handler = (
        _: IpcRendererEvent,
        data: { percent: number; transferred: number; total: number }
      ) => callback(data);
      ipcRenderer.on("download-progress", handler);
      return () => ipcRenderer.removeListener("download-progress", handler);
    },
    onUpdateDownloaded: (callback) => {
      const handler = (_: IpcRendererEvent, data: { version: string }) =>
        callback(data);
      ipcRenderer.on("update-downloaded", handler);
      return () => ipcRenderer.removeListener("update-downloaded", handler);
    },
  };
}
