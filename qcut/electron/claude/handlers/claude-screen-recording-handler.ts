/**
 * Claude Screen Recording API Handler
 *
 * Routes screen recording start/stop to the renderer process via
 * the request-response IPC pattern from claude-navigator-handler.ts.
 *
 * @module electron/claude/handlers/claude-screen-recording-handler
 */

import { ipcMain, BrowserWindow, type IpcMainEvent } from "electron";
import { generateId } from "../utils/helpers.js";
import { claudeLog } from "../utils/logger.js";

const HANDLER_NAME = "ScreenRecording";
const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 60_000;

export interface StartRecordingRequest {
	sourceId?: string;
	fileName?: string;
}

export interface StartRecordingResponse {
	sessionId: string;
	sourceId: string;
	sourceName: string;
	filePath: string;
	startedAt: number;
	mimeType: string | null;
}

export interface StopRecordingRequest {
	discard?: boolean;
}

export interface StopRecordingResponse {
	success: boolean;
	filePath: string | null;
	bytesWritten: number;
	durationMs: number;
	discarded: boolean;
}

/**
 * Request the renderer to start screen recording.
 */
export async function requestStartRecordingFromRenderer(
	win: BrowserWindow,
	options: StartRecordingRequest,
): Promise<StartRecordingResponse> {
	return new Promise((resolve, reject) => {
		let resolved = false;
		const requestId = generateId("sr-start");

		const timeout = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener(
				"claude:screen-recording:start:response",
				handler,
			);
			reject(new Error("Timeout waiting for screen recording to start"));
		}, START_TIMEOUT_MS);

		const handler = (
			_event: IpcMainEvent,
			data: {
				requestId: string;
				result?: StartRecordingResponse;
				error?: string;
			},
		) => {
			if (data.requestId !== requestId || resolved) return;
			resolved = true;
			clearTimeout(timeout);
			ipcMain.removeListener(
				"claude:screen-recording:start:response",
				handler,
			);
			if (data.error) {
				reject(new Error(data.error));
			} else {
				resolve(data.result!);
			}
		};

		ipcMain.on("claude:screen-recording:start:response", handler);
		win.webContents.send("claude:screen-recording:start:request", {
			requestId,
			options,
		});
	});
}

/**
 * Request the renderer to stop screen recording.
 */
export async function requestStopRecordingFromRenderer(
	win: BrowserWindow,
	options: StopRecordingRequest,
): Promise<StopRecordingResponse> {
	return new Promise((resolve, reject) => {
		let resolved = false;
		const requestId = generateId("sr-stop");

		const timeout = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener(
				"claude:screen-recording:stop:response",
				handler,
			);
			reject(new Error("Timeout waiting for screen recording to stop"));
		}, STOP_TIMEOUT_MS);

		const handler = (
			_event: IpcMainEvent,
			data: {
				requestId: string;
				result?: StopRecordingResponse;
				error?: string;
			},
		) => {
			if (data.requestId !== requestId || resolved) return;
			resolved = true;
			clearTimeout(timeout);
			ipcMain.removeListener(
				"claude:screen-recording:stop:response",
				handler,
			);
			if (data.error) {
				reject(new Error(data.error));
			} else {
				resolve(data.result!);
			}
		};

		ipcMain.on("claude:screen-recording:stop:response", handler);
		win.webContents.send("claude:screen-recording:stop:request", {
			requestId,
			options,
		});
	});
}

/** Register Claude screen recording IPC handlers. */
export function setupClaudeScreenRecordingIPC(): void {
	claudeLog.info(HANDLER_NAME, "Setting up Screen Recording IPC handlers...");
	claudeLog.info(HANDLER_NAME, "Screen Recording IPC handlers registered");
}
