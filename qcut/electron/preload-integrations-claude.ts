/**
 * Claude Code Integration API builder for preload.
 * Extracted from preload-integrations.ts to keep files under 800 lines.
 *
 * @module electron/preload-integrations-claude
 */

import { ipcRenderer } from "electron";
import type { ElectronAPI } from "./preload-types.js";
import type {
	EditorEvent,
	EditorStateRequest,
	EditorStateSnapshot,
} from "./types/claude-api.js";

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
			onMediaImported: (callback) => {
				ipcRenderer.removeAllListeners("claude:media:imported");
				ipcRenderer.on("claude:media:imported", (_, data) => callback(data));
			},
		},
		timeline: {
			export: (projectId, format) =>
				ipcRenderer.invoke("claude:timeline:export", projectId, format),
			import: (projectId, data, format) =>
				ipcRenderer.invoke("claude:timeline:import", projectId, data, format),
			addElement: (projectId, element) =>
				ipcRenderer.invoke("claude:timeline:addElement", projectId, element),
			batchAddElements: (projectId, elements) =>
				ipcRenderer.invoke(
					"claude:timeline:batchAddElements",
					projectId,
					elements
				),
			updateElement: (projectId, elementId, changes) =>
				ipcRenderer.invoke(
					"claude:timeline:updateElement",
					projectId,
					elementId,
					changes
				),
			batchUpdateElements: (projectId, updates) =>
				ipcRenderer.invoke(
					"claude:timeline:batchUpdateElements",
					projectId,
					updates
				),
			removeElement: (projectId, elementId) =>
				ipcRenderer.invoke(
					"claude:timeline:removeElement",
					projectId,
					elementId
				),
			batchDeleteElements: (projectId, elements, ripple) =>
				ipcRenderer.invoke(
					"claude:timeline:batchDeleteElements",
					projectId,
					elements,
					ripple
				),
			deleteRange: (projectId, request) =>
				ipcRenderer.invoke("claude:timeline:deleteRange", projectId, request),
			arrange: (projectId, request) =>
				ipcRenderer.invoke("claude:timeline:arrange", projectId, request),
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
				ipcRenderer.on(
					"claude:timeline:apply",
					(_, data: { timeline: any; replace?: boolean } | any) => {
						// Support both new {timeline, replace} format and legacy raw timeline
						if (
							data &&
							data.timeline &&
							typeof data.timeline === "object" &&
							"tracks" in data.timeline
						) {
							callback(data.timeline, data.replace);
						} else {
							callback(data, false);
						}
					}
				);
			},
			onAddElement: (callback) => {
				ipcRenderer.removeAllListeners("claude:timeline:addElement");
				ipcRenderer.on("claude:timeline:addElement", (_, element) =>
					callback(element)
				);
			},
			onBatchAddElements: (callback) => {
				ipcRenderer.removeAllListeners("claude:timeline:batchAddElements");
				ipcRenderer.on("claude:timeline:batchAddElements", (_, data) =>
					callback(data)
				);
			},
			sendBatchAddElementsResponse: (requestId, result) => {
				ipcRenderer.send("claude:timeline:batchAddElements:response", {
					requestId,
					result,
				});
			},
			onUpdateElement: (callback) => {
				ipcRenderer.removeAllListeners("claude:timeline:updateElement");
				ipcRenderer.on("claude:timeline:updateElement", (_, data) =>
					callback(data)
				);
			},
			onBatchUpdateElements: (callback) => {
				ipcRenderer.removeAllListeners("claude:timeline:batchUpdateElements");
				ipcRenderer.on("claude:timeline:batchUpdateElements", (_, data) =>
					callback(data)
				);
			},
			sendBatchUpdateElementsResponse: (requestId, result) => {
				ipcRenderer.send("claude:timeline:batchUpdateElements:response", {
					requestId,
					result,
				});
			},
			onRemoveElement: (callback) => {
				ipcRenderer.removeAllListeners("claude:timeline:removeElement");
				ipcRenderer.on("claude:timeline:removeElement", (_, id) =>
					callback(id)
				);
			},
			onBatchDeleteElements: (callback) => {
				ipcRenderer.removeAllListeners("claude:timeline:batchDeleteElements");
				ipcRenderer.on("claude:timeline:batchDeleteElements", (_, data) =>
					callback(data)
				);
			},
			sendBatchDeleteElementsResponse: (requestId, result) => {
				ipcRenderer.send("claude:timeline:batchDeleteElements:response", {
					requestId,
					result,
				});
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
			onExecuteCuts: (callback) => {
				ipcRenderer.removeAllListeners("claude:timeline:executeCuts");
				ipcRenderer.on("claude:timeline:executeCuts", (_, data) =>
					callback(data)
				);
			},
			sendExecuteCutsResponse: (requestId, result) => {
				ipcRenderer.send("claude:timeline:executeCuts:response", {
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
			onPlayback: (
				callback: (data: { action: string; time?: number }) => void
			) => {
				ipcRenderer.removeAllListeners("claude:timeline:playback");
				ipcRenderer.on(
					"claude:timeline:playback",
					(_: unknown, data: { action: string; time?: number }) =>
						callback(data)
				);
			},
			onDeleteRange: (callback) => {
				ipcRenderer.removeAllListeners("claude:timeline:deleteRange");
				ipcRenderer.on("claude:timeline:deleteRange", (_, data) =>
					callback(data)
				);
			},
			sendDeleteRangeResponse: (requestId, result) => {
				ipcRenderer.send("claude:timeline:deleteRange:response", {
					requestId,
					result,
				});
			},
			onArrange: (callback) => {
				ipcRenderer.removeAllListeners("claude:timeline:arrange");
				ipcRenderer.on("claude:timeline:arrange", (_, data) => callback(data));
			},
			sendArrangeResponse: (requestId, result) => {
				ipcRenderer.send("claude:timeline:arrange:response", {
					requestId,
					result,
				});
			},
			onLoadSpeech: (callback) => {
				ipcRenderer.removeAllListeners("claude:speech:load");
				ipcRenderer.on("claude:speech:load", (_, data) => callback(data));
			},
			sendResponse: (timeline) => {
				ipcRenderer.send("claude:timeline:response", timeline);
			},
			removeListeners: () => {
				ipcRenderer.removeAllListeners("claude:timeline:request");
				ipcRenderer.removeAllListeners("claude:timeline:apply");
				ipcRenderer.removeAllListeners("claude:timeline:addElement");
				ipcRenderer.removeAllListeners("claude:timeline:batchAddElements");
				ipcRenderer.removeAllListeners("claude:timeline:updateElement");
				ipcRenderer.removeAllListeners("claude:timeline:batchUpdateElements");
				ipcRenderer.removeAllListeners("claude:timeline:removeElement");
				ipcRenderer.removeAllListeners("claude:timeline:batchDeleteElements");
				ipcRenderer.removeAllListeners("claude:timeline:splitElement");
				ipcRenderer.removeAllListeners("claude:timeline:executeCuts");
				ipcRenderer.removeAllListeners("claude:timeline:moveElement");
				ipcRenderer.removeAllListeners("claude:timeline:selectElements");
				ipcRenderer.removeAllListeners("claude:timeline:getSelection");
				ipcRenderer.removeAllListeners("claude:timeline:clearSelection");
				ipcRenderer.removeAllListeners("claude:timeline:playback");
				ipcRenderer.removeAllListeners("claude:timeline:deleteRange");
				ipcRenderer.removeAllListeners("claude:timeline:arrange");
				ipcRenderer.removeAllListeners("claude:speech:load");
			},
		},
		transaction: {
			onBegin: (callback) => {
				ipcRenderer.removeAllListeners("claude:transaction:begin");
				ipcRenderer.on("claude:transaction:begin", (_, data) => callback(data));
			},
			sendBeginResponse: (requestId, result) => {
				ipcRenderer.send("claude:transaction:begin:response", {
					requestId,
					result,
				});
			},
			onCommit: (callback) => {
				ipcRenderer.removeAllListeners("claude:transaction:commit");
				ipcRenderer.on("claude:transaction:commit", (_, data) =>
					callback(data)
				);
			},
			sendCommitResponse: (requestId, result) => {
				ipcRenderer.send("claude:transaction:commit:response", {
					requestId,
					result,
				});
			},
			onRollback: (callback) => {
				ipcRenderer.removeAllListeners("claude:transaction:rollback");
				ipcRenderer.on("claude:transaction:rollback", (_, data) =>
					callback(data)
				);
			},
			sendRollbackResponse: (requestId, result) => {
				ipcRenderer.send("claude:transaction:rollback:response", {
					requestId,
					result,
				});
			},
			onUndo: (callback) => {
				ipcRenderer.removeAllListeners("claude:transaction:undo");
				ipcRenderer.on("claude:transaction:undo", (_, data) => callback(data));
			},
			sendUndoResponse: (requestId, result) => {
				ipcRenderer.send("claude:transaction:undo:response", {
					requestId,
					result,
				});
			},
			onRedo: (callback) => {
				ipcRenderer.removeAllListeners("claude:transaction:redo");
				ipcRenderer.on("claude:transaction:redo", (_, data) => callback(data));
			},
			sendRedoResponse: (requestId, result) => {
				ipcRenderer.send("claude:transaction:redo:response", {
					requestId,
					result,
				});
			},
			onHistory: (callback) => {
				ipcRenderer.removeAllListeners("claude:transaction:history");
				ipcRenderer.on("claude:transaction:history", (_, data) =>
					callback(data)
				);
			},
			sendHistoryResponse: (requestId, result) => {
				ipcRenderer.send("claude:transaction:history:response", {
					requestId,
					result,
				});
			},
			removeListeners: () => {
				ipcRenderer.removeAllListeners("claude:transaction:begin");
				ipcRenderer.removeAllListeners("claude:transaction:commit");
				ipcRenderer.removeAllListeners("claude:transaction:rollback");
				ipcRenderer.removeAllListeners("claude:transaction:undo");
				ipcRenderer.removeAllListeners("claude:transaction:redo");
				ipcRenderer.removeAllListeners("claude:transaction:history");
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
		analyze: {
			run: (projectId, options) =>
				ipcRenderer.invoke("claude:analyze:run", projectId, options),
			models: () => ipcRenderer.invoke("claude:analyze:models"),
		},
		events: {
			emit: (
				event: Omit<EditorEvent, "eventId" | "timestamp"> &
					Partial<Pick<EditorEvent, "eventId" | "timestamp">>
			) => {
				ipcRenderer.send("claude:events:emit", event);
			},
		},
		notifications: {
			enable: (sessionId) =>
				ipcRenderer.invoke("claude:notifications:enable", { sessionId }),
			disable: () => ipcRenderer.invoke("claude:notifications:disable"),
			status: () => ipcRenderer.invoke("claude:notifications:status"),
			history: (limit) =>
				ipcRenderer.invoke("claude:notifications:history", { limit }),
		},
		navigator: {
			onProjectsRequest: (callback) => {
				ipcRenderer.removeAllListeners("claude:navigator:projects:request");
				ipcRenderer.on("claude:navigator:projects:request", (_, data) =>
					callback(data)
				);
			},
			sendProjectsResponse: (requestId, result) => {
				ipcRenderer.send("claude:navigator:projects:response", {
					requestId,
					result,
				});
			},
			onOpenRequest: (callback) => {
				ipcRenderer.removeAllListeners("claude:navigator:open:request");
				ipcRenderer.on("claude:navigator:open:request", (_, data) =>
					callback(data)
				);
			},
			sendOpenResponse: (requestId, result) => {
				ipcRenderer.send("claude:navigator:open:response", {
					requestId,
					result,
				});
			},
			removeListeners: () => {
				ipcRenderer.removeAllListeners("claude:navigator:projects:request");
				ipcRenderer.removeAllListeners("claude:navigator:open:request");
			},
		},
		screenRecordingBridge: {
			onStartRequest: (callback) => {
				ipcRenderer.removeAllListeners("claude:screen-recording:start:request");
				ipcRenderer.on("claude:screen-recording:start:request", (_, data) =>
					callback(data)
				);
			},
			sendStartResponse: (requestId, result, error) => {
				ipcRenderer.send("claude:screen-recording:start:response", {
					requestId,
					result,
					error,
				});
			},
			onStopRequest: (callback) => {
				ipcRenderer.removeAllListeners("claude:screen-recording:stop:request");
				ipcRenderer.on("claude:screen-recording:stop:request", (_, data) =>
					callback(data)
				);
			},
			sendStopResponse: (requestId, result, error) => {
				ipcRenderer.send("claude:screen-recording:stop:response", {
					requestId,
					result,
					error,
				});
			},
			removeListeners: () => {
				ipcRenderer.removeAllListeners("claude:screen-recording:start:request");
				ipcRenderer.removeAllListeners("claude:screen-recording:stop:request");
			},
		},
		ui: {
			onSwitchPanelRequest: (
				callback: (data: {
					requestId: string;
					panel: string;
					tab?: string;
				}) => void
			) => {
				ipcRenderer.removeAllListeners("claude:ui:switch-panel:request");
				ipcRenderer.on(
					"claude:ui:switch-panel:request",
					(
						_: unknown,
						data: { requestId: string; panel: string; tab?: string }
					) => callback(data)
				);
			},
			sendSwitchPanelResponse: (
				requestId: string,
				result?: { switched: boolean; panel: string; group: string },
				error?: string
			) => {
				ipcRenderer.send("claude:ui:switch-panel:response", {
					requestId,
					result,
					error,
				});
			},
			removeListeners: () => {
				ipcRenderer.removeAllListeners("claude:ui:switch-panel:request");
			},
		},
		state: {
			onSnapshotRequest: (
				callback: (data: {
					requestId: string;
					request?: EditorStateRequest;
				}) => void
			) => {
				ipcRenderer.removeAllListeners("claude:state:snapshot");
				ipcRenderer.on(
					"claude:state:snapshot",
					(
						_: unknown,
						data: {
							requestId: string;
							request?: EditorStateRequest;
						}
					) => callback(data)
				);
			},
			sendSnapshotResponse: (
				requestId: string,
				result?: EditorStateSnapshot,
				error?: string
			) => {
				ipcRenderer.send("claude:state:snapshot:response", {
					requestId,
					result,
					error,
				});
			},
			removeListeners: () => {
				ipcRenderer.removeAllListeners("claude:state:snapshot");
			},
		},
		projectCrud: {
			onCreateRequest: (
				callback: (data: { requestId: string; name: string }) => void
			) => {
				ipcRenderer.removeAllListeners("claude:project:create:request");
				ipcRenderer.on(
					"claude:project:create:request",
					(_: unknown, data: { requestId: string; name: string }) =>
						callback(data)
				);
			},
			sendCreateResponse: (
				requestId: string,
				result?: { projectId: string; name: string },
				error?: string
			) => {
				ipcRenderer.send("claude:project:create:response", {
					requestId,
					result,
					error,
				});
			},
			onDeleteRequest: (
				callback: (data: { requestId: string; projectId: string }) => void
			) => {
				ipcRenderer.removeAllListeners("claude:project:delete:request");
				ipcRenderer.on(
					"claude:project:delete:request",
					(_: unknown, data: { requestId: string; projectId: string }) =>
						callback(data)
				);
			},
			sendDeleteResponse: (
				requestId: string,
				result?: { deleted: boolean; projectId: string },
				error?: string
			) => {
				ipcRenderer.send("claude:project:delete:response", {
					requestId,
					result,
					error,
				});
			},
			onRenameRequest: (
				callback: (data: {
					requestId: string;
					projectId: string;
					name: string;
				}) => void
			) => {
				ipcRenderer.removeAllListeners("claude:project:rename:request");
				ipcRenderer.on(
					"claude:project:rename:request",
					(
						_: unknown,
						data: {
							requestId: string;
							projectId: string;
							name: string;
						}
					) => callback(data)
				);
			},
			sendRenameResponse: (
				requestId: string,
				result?: {
					renamed: boolean;
					projectId: string;
					name: string;
				},
				error?: string
			) => {
				ipcRenderer.send("claude:project:rename:response", {
					requestId,
					result,
					error,
				});
			},
			onDuplicateRequest: (
				callback: (data: { requestId: string; projectId: string }) => void
			) => {
				ipcRenderer.removeAllListeners("claude:project:duplicate:request");
				ipcRenderer.on(
					"claude:project:duplicate:request",
					(_: unknown, data: { requestId: string; projectId: string }) =>
						callback(data)
				);
			},
			sendDuplicateResponse: (
				requestId: string,
				result?: {
					projectId: string;
					name: string;
					sourceProjectId: string;
				},
				error?: string
			) => {
				ipcRenderer.send("claude:project:duplicate:response", {
					requestId,
					result,
					error,
				});
			},
			removeListeners: () => {
				ipcRenderer.removeAllListeners("claude:project:create:request");
				ipcRenderer.removeAllListeners("claude:project:delete:request");
				ipcRenderer.removeAllListeners("claude:project:rename:request");
				ipcRenderer.removeAllListeners("claude:project:duplicate:request");
			},
		},
	};
}
