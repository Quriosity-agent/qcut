/**
 * Utility Bridge — Main Request Handler
 * Dispatches requests from the utility process to the appropriate handler.
 * Extracted from utility-bridge.ts to keep files under 800 lines.
 */

import { BrowserWindow } from "electron";
import {
	requestTimelineFromRenderer,
	requestSplitFromRenderer,
	requestSelectionFromRenderer,
	batchAddElements,
	batchUpdateElements,
	batchDeleteElements,
	arrangeTimeline,
} from "../claude/handlers/claude-timeline-handler.js";
import {
	beginTransaction,
	commitTransaction,
	rollbackTransaction,
	getTransactionStatus,
	undoTimeline,
	redoTimeline,
	getHistorySummary,
} from "../claude/handlers/claude-transaction-handler.js";
import { requestEditorStateSnapshotFromRenderer } from "../claude/handlers/claude-state-handler.js";
import type { EditorStateRequest } from "../types/claude-api.js";
import { getProjectStats } from "../claude/handlers/claude-project-handler.js";
import {
	requestProjectsFromRenderer,
	requestNavigateToProject,
} from "../claude/handlers/claude-navigator-handler.js";
import {
	requestStartRecordingFromRenderer,
	requestStopRecordingFromRenderer,
} from "../claude/handlers/claude-screen-recording-handler.js";
import {
	requestSwitchPanel,
	resolvePanelId,
	getAvailablePanels,
	resolveTabId,
	getAvailableTabs,
} from "../claude/handlers/claude-ui-handler.js";
import {
	requestSetScript,
	requestTriggerParse,
	requestMoyinStatus,
} from "../claude/handlers/claude-moyin-handler.js";
import { captureScreenshot } from "../claude/handlers/claude-screenshot-handler.js";
import {
	requestCreateProject,
	requestDeleteProject,
	requestRenameProject,
	requestDuplicateProject,
} from "../claude/handlers/claude-project-crud-handler.js";
import { getClaudeEvents } from "../claude/handlers/claude-events-handler.js";
import { notificationBridge } from "../claude/notification-bridge.js";
import {
	listCaptureSources,
	buildStatus as buildScreenRecordingStatus,
	forceStopActiveScreenRecordingSession,
} from "../screen-recording-handler.js";
import type {
	WebContentsSendRequest,
	SplitElementRequest,
	BatchAddElementsRequest,
	BatchUpdateElementsRequest,
	BatchDeleteElementsRequest,
	GetProjectStatsRequest,
	TransactionBeginRequest,
	TransactionFinalizeRequest,
	TransactionStatusRequest,
} from "./utility-ipc-types.js";

/** Get the first active BrowserWindow */
function getWindow(): BrowserWindow | null {
	return BrowserWindow.getAllWindows()[0] ?? null;
}

/**
 * Handle a request from the utility process that needs main-process APIs.
 */
export async function handleMainRequest(
	channel: string,
	data: Record<string, unknown>
): Promise<unknown> {
	if (channel === "events:list") {
		const req = data as {
			limit?: number;
			category?: string;
			after?: string;
			source?: string;
		};
		return getClaudeEvents({
			limit: req.limit,
			category: req.category,
			after: req.after,
			source: req.source,
		});
	}
	if (channel === "notifications:enable") {
		const req = data as { sessionId?: string };
		const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
		return notificationBridge.enable({ sessionId });
	}
	if (channel === "notifications:disable") {
		return notificationBridge.disable();
	}
	if (channel === "notifications:status") {
		return notificationBridge.getStatus();
	}
	if (channel === "notifications:history") {
		const req = data as { limit?: number };
		return notificationBridge.getHistory({ limit: req.limit });
	}

	const win = getWindow();
	if (!win) throw new Error("No active window");

	switch (channel) {
		case "webcontents-send": {
			const req = data as unknown as WebContentsSendRequest;
			win.webContents.send(req.channel, ...req.args);
			return { sent: true };
		}

		case "get-timeline": {
			return requestTimelineFromRenderer(win);
		}

		case "get-selection": {
			return requestSelectionFromRenderer(win);
		}

		case "get-editor-state-snapshot": {
			const req = data as { request?: EditorStateRequest };
			return requestEditorStateSnapshotFromRenderer(win, req.request);
		}

		case "split-element": {
			const req = data as unknown as SplitElementRequest;
			return requestSplitFromRenderer(
				win,
				req.elementId,
				req.splitTime,
				req.mode
			);
		}

		case "get-project-stats": {
			const req = data as unknown as GetProjectStatsRequest;
			return getProjectStats(win, req.projectId);
		}

		case "batch-add-elements": {
			const req = data as unknown as BatchAddElementsRequest;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- IPC boundary cast
			return batchAddElements(win, req.projectId, req.elements as any);
		}

		case "batch-update-elements": {
			const req = data as unknown as BatchUpdateElementsRequest;
			return batchUpdateElements(win, req.updates as any);
		}

		case "batch-delete-elements": {
			const req = data as unknown as BatchDeleteElementsRequest;
			return batchDeleteElements(win, req.elements as any, req.ripple);
		}

		case "arrange-timeline": {
			return arrangeTimeline(win, data as any);
		}

		case "transaction:begin": {
			const req = data as TransactionBeginRequest;
			return beginTransaction({ win, request: req.request });
		}

		case "transaction:commit": {
			const req = data as unknown as TransactionFinalizeRequest;
			return commitTransaction({ transactionId: req.transactionId });
		}

		case "transaction:rollback": {
			const req = data as unknown as TransactionFinalizeRequest;
			return rollbackTransaction({
				transactionId: req.transactionId,
				reason: req.reason,
			});
		}

		case "transaction:status": {
			const req = data as unknown as TransactionStatusRequest;
			return getTransactionStatus({
				transactionId: req.transactionId,
			});
		}

		case "timeline:undo": {
			return undoTimeline({ win });
		}

		case "timeline:redo": {
			return redoTimeline({ win });
		}

		case "timeline:history": {
			return getHistorySummary({ win });
		}

		case "get-projects": {
			return requestProjectsFromRenderer(win);
		}

		case "navigate-to-project": {
			const req = data as { projectId: string };
			return requestNavigateToProject(win, req.projectId);
		}

		case "screen-recording:sources": {
			return listCaptureSources({ currentWindowSourceId: null });
		}

		case "screen-recording:status": {
			return buildScreenRecordingStatus();
		}

		case "screen-recording:start": {
			const req = data as { sourceId?: string; fileName?: string };
			return requestStartRecordingFromRenderer(win, {
				sourceId: req.sourceId,
				fileName: req.fileName,
			});
		}

		case "screen-recording:stop": {
			const req = data as { discard?: boolean };
			return requestStopRecordingFromRenderer(win, {
				discard: req.discard,
			});
		}

		case "screen-recording:force-stop": {
			try {
				return await forceStopActiveScreenRecordingSession();
			} catch (error: unknown) {
				throw new Error(
					`Failed to force-stop screen recording session: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}

		case "screenshot:capture": {
			const req = data as { fileName?: string };
			return captureScreenshot(win, { fileName: req.fileName });
		}

		case "switch-panel": {
			const req = data as { panel: string; tab?: string };
			const panelId = resolvePanelId(req.panel);
			if (!panelId) {
				throw new Error(
					`Unknown panel: ${req.panel}. Available: ${getAvailablePanels().join(", ")}`
				);
			}
			// Resolve tab alias if provided
			let resolvedTab: string | undefined;
			if (req.tab) {
				resolvedTab = resolveTabId(panelId, req.tab) ?? undefined;
				if (!resolvedTab) {
					throw new Error(
						`Unknown tab: ${req.tab}. Available for ${panelId}: ${getAvailableTabs(panelId).join(", ")}`
					);
				}
			}
			return requestSwitchPanel(win, panelId, resolvedTab);
		}

		case "moyin:set-script": {
			const req = data as { text: string };
			requestSetScript(win, req.text);
			return { updated: true };
		}

		case "moyin:trigger-parse": {
			requestTriggerParse(win);
			return { triggered: true };
		}

		case "moyin:status": {
			return requestMoyinStatus(win);
		}

		case "project:create": {
			const req = data as { name: string };
			return requestCreateProject(win, req.name);
		}

		case "project:delete": {
			const req = data as { projectId: string };
			return requestDeleteProject(win, req.projectId);
		}

		case "project:rename": {
			const req = data as { projectId: string; name: string };
			return requestRenameProject(win, req.projectId, req.name);
		}

		case "project:duplicate": {
			const req = data as { projectId: string };
			return requestDuplicateProject(win, req.projectId);
		}

		default:
			throw new Error(`Unknown main-request channel: ${channel}`);
	}
}
