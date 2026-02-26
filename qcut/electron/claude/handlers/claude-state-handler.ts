/**
 * Claude Editor State Snapshot Handler
 *
 * Requests a canonical editor state snapshot from the renderer process.
 * Used by the Claude HTTP API for debugging and automation visibility.
 */

import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import { generateId } from "../utils/helpers.js";
import { claudeLog } from "../utils/logger.js";
import type {
	EditorStateRequest,
	EditorStateSnapshot,
} from "../../types/claude-api";

const HANDLER_NAME = "State";
const REQUEST_TIMEOUT_MS = 5000;

interface StateSnapshotResponsePayload {
	requestId: string;
	result?: EditorStateSnapshot;
	error?: string;
}

/**
 * Request a full or partial editor state snapshot from the renderer process.
 */
export async function requestEditorStateSnapshotFromRenderer(
	win: BrowserWindow,
	request?: EditorStateRequest
): Promise<EditorStateSnapshot> {
	return new Promise((resolve, reject) => {
		let resolved = false;
		const requestId = generateId("req");

		const timeout = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener("claude:state:snapshot:response", handler);
			reject(new Error("Timeout waiting for editor state snapshot"));
		}, REQUEST_TIMEOUT_MS);

		const handler = (
			_event: IpcMainEvent,
			data: StateSnapshotResponsePayload
		) => {
			if (resolved || data.requestId !== requestId) return;

			resolved = true;
			clearTimeout(timeout);
			ipcMain.removeListener("claude:state:snapshot:response", handler);

			if (data.error) {
				reject(new Error(data.error));
				return;
			}

			if (!data.result) {
				reject(new Error("Renderer returned empty editor state snapshot"));
				return;
			}

			resolve(data.result);
		};

		ipcMain.on("claude:state:snapshot:response", handler);
		win.webContents.send("claude:state:snapshot", {
			requestId,
			request,
		});
	});
}

/** Register Claude state IPC handlers (request-response only). */
export function setupClaudeStateIPC(): void {
	claudeLog.info(HANDLER_NAME, "Setting up State IPC handlers...");
	claudeLog.info(HANDLER_NAME, "State IPC handlers registered");
}

