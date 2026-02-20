/**
 * Claude Range Delete Handler
 * Deletes all content within a time range across all tracks (or specified tracks).
 */

import { ipcMain } from "electron";
import type { BrowserWindow, IpcMainEvent } from "electron";
import { generateId } from "./utils/helpers.js";
import { claudeLog } from "./utils/logger.js";
import { HttpError } from "./utils/http-router.js";
import type {
	ClaudeRangeDeleteRequest,
	ClaudeRangeDeleteResponse,
} from "../types/claude-api";

const HANDLER_NAME = "Range";
const RANGE_DELETE_TIMEOUT = 30_000;

/**
 * Validate the range delete request.
 */
export function validateRangeDeleteRequest(
	request: ClaudeRangeDeleteRequest
): void {
	if (
		typeof request.startTime !== "number" ||
		typeof request.endTime !== "number"
	) {
		throw new HttpError(400, "startTime and endTime must be numbers");
	}
	if (request.startTime < 0 || request.endTime < 0) {
		throw new HttpError(400, "startTime and endTime must be non-negative");
	}
	if (request.startTime >= request.endTime) {
		throw new HttpError(
			400,
			`startTime (${request.startTime}) must be less than endTime (${request.endTime})`
		);
	}
	if (request.trackIds && !Array.isArray(request.trackIds)) {
		throw new HttpError(400, "trackIds must be an array of strings");
	}
	if (
		request.trackIds &&
		request.trackIds.some((trackId) => typeof trackId !== "string")
	) {
		throw new HttpError(400, "trackIds must be an array of strings");
	}
}

/**
 * Send range delete operation to the renderer and wait for the result.
 */
export async function executeDeleteRange(
	win: BrowserWindow,
	request: ClaudeRangeDeleteRequest
): Promise<ClaudeRangeDeleteResponse> {
	validateRangeDeleteRequest(request);

	claudeLog.info(
		HANDLER_NAME,
		`Range delete: ${request.startTime}s-${request.endTime}s, tracks=${request.trackIds?.join(",") ?? "all"}, ripple=${request.ripple ?? true}`
	);

	return new Promise((resolve, reject) => {
		let resolved = false;
		const requestId = generateId("req");

		const timeout = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener("claude:timeline:deleteRange:response", handler);
			reject(new Error("Timeout waiting for range delete result"));
		}, RANGE_DELETE_TIMEOUT);

		const handler = (
			_event: IpcMainEvent,
			data: { requestId: string; result: ClaudeRangeDeleteResponse }
		) => {
			if (data.requestId !== requestId || resolved) return;
			resolved = true;
			clearTimeout(timeout);
			ipcMain.removeListener("claude:timeline:deleteRange:response", handler);
			resolve(data.result);
		};

		ipcMain.on("claude:timeline:deleteRange:response", handler);
		win.webContents.send("claude:timeline:deleteRange", {
			requestId,
			request,
		});
	});
}

// CommonJS export for compatibility
module.exports = { executeDeleteRange, validateRangeDeleteRequest };
