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

export { createClaudeAPI } from "./preload-integrations-claude.js";

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
		bundleFile: (filePath: string, compositionId: string) =>
			ipcRenderer.invoke("remotion-file:bundle", filePath, compositionId),
	};
}

// ============================================================================
// Moyin (Script-to-Storyboard)
// ============================================================================

/** Create the Moyin script/storyboard API for the renderer process. */
export function createMoyinAPI(): NonNullable<ElectronAPI["moyin"]> {
	return {
		parseScript: (options) => ipcRenderer.invoke("moyin:parse-script", options),
		generateStoryboard: (options) =>
			ipcRenderer.invoke("moyin:generate-storyboard", options),
		callLLM: (options) => ipcRenderer.invoke("moyin:call-llm", options),
		isClaudeAvailable: () => ipcRenderer.invoke("moyin:is-claude-available"),
		onParsed: (callback) => {
			ipcRenderer.removeAllListeners("claude:moyin:parsed");
			ipcRenderer.on("claude:moyin:parsed", (_, data) => callback(data));
		},
		removeParseListener: () => {
			ipcRenderer.removeAllListeners("claude:moyin:parsed");
		},
		onSetScript: (callback: (data: { text: string }) => void) => {
			ipcRenderer.removeAllListeners("claude:moyin:set-script");
			ipcRenderer.on(
				"claude:moyin:set-script",
				(_: unknown, data: { text: string }) => callback(data)
			);
		},
		onTriggerParse: (callback: () => void) => {
			ipcRenderer.removeAllListeners("claude:moyin:trigger-parse");
			ipcRenderer.on("claude:moyin:trigger-parse", () => callback());
		},
		onStatusRequest: (callback: (data: { requestId: string }) => void) => {
			ipcRenderer.removeAllListeners("claude:moyin:status:request");
			ipcRenderer.on(
				"claude:moyin:status:request",
				(_: unknown, data: { requestId: string }) => callback(data)
			);
		},
		sendStatusResponse: (
			requestId: string,
			result?: Record<string, unknown>,
			error?: string
		) => {
			ipcRenderer.send("claude:moyin:status:response", {
				requestId,
				result,
				error,
			});
		},
		removeMoyinBridgeListeners: () => {
			ipcRenderer.removeAllListeners("claude:moyin:set-script");
			ipcRenderer.removeAllListeners("claude:moyin:trigger-parse");
			ipcRenderer.removeAllListeners("claude:moyin:status:request");
		},
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
