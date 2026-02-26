/**
 * Claude Timeline Operations
 *
 * Renderer request helpers and batch operation functions for timeline
 * manipulation (add, update, delete, split, select, arrange).
 */

import { ipcMain, BrowserWindow, IpcMainEvent } from "electron";
import { generateId } from "../utils/helpers.js";
import type {
	ClaudeTimeline,
	ClaudeBatchAddElementRequest,
	ClaudeBatchAddResponse,
	ClaudeBatchDeleteItemRequest,
	ClaudeBatchDeleteResponse,
	ClaudeBatchUpdateItemRequest,
	ClaudeBatchUpdateResponse,
	ClaudeArrangeRequest,
	ClaudeArrangeResponse,
	ClaudeRangeDeleteRequest,
	ClaudeRangeDeleteResponse,
	ClaudeSplitResponse,
	ClaudeSelectionItem,
} from "../../types/claude-api";

const MAX_TIMELINE_BATCH_ITEMS = 50;
const TIMELINE_REQUEST_TIMEOUT_MS = 5000;

/**
 * Request timeline data from renderer process
 */
export async function requestTimelineFromRenderer(
	win: BrowserWindow
): Promise<ClaudeTimeline> {
	return new Promise((resolve, reject) => {
		let resolved = false;

		const timeout = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener("claude:timeline:response", handler);
			reject(new Error("Timeout waiting for timeline data"));
		}, 5000);

		const handler = (_event: IpcMainEvent, timeline: ClaudeTimeline) => {
			if (resolved) return;
			resolved = true;
			clearTimeout(timeout);
			resolve(timeline);
		};

		ipcMain.once("claude:timeline:response", handler);
		win.webContents.send("claude:timeline:request");
	});
}

/**
 * Request a split operation from the renderer and wait for the result
 */
export async function requestSplitFromRenderer(
	win: BrowserWindow,
	elementId: string,
	splitTime: number,
	mode?: string
): Promise<ClaudeSplitResponse> {
	return new Promise((resolve, reject) => {
		let resolved = false;
		const requestId = generateId("req");

		const timeout = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener("claude:timeline:splitElement:response", handler);
			reject(new Error("Timeout waiting for split result"));
		}, 5000);

		const handler = (
			_event: IpcMainEvent,
			data: { requestId: string; result: ClaudeSplitResponse }
		) => {
			if (data.requestId !== requestId || resolved) return;
			resolved = true;
			clearTimeout(timeout);
			ipcMain.removeListener("claude:timeline:splitElement:response", handler);
			resolve(data.result);
		};

		ipcMain.on("claude:timeline:splitElement:response", handler);
		win.webContents.send("claude:timeline:splitElement", {
			requestId,
			elementId,
			splitTime,
			mode: mode || "split",
		});
	});
}

/**
 * Request current selection state from the renderer
 */
export async function requestSelectionFromRenderer(
	win: BrowserWindow
): Promise<ClaudeSelectionItem[]> {
	return new Promise((resolve, reject) => {
		let resolved = false;
		const requestId = generateId("req");

		const timeout = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener("claude:timeline:getSelection:response", handler);
			reject(new Error("Timeout waiting for selection data"));
		}, 5000);

		const handler = (
			_event: IpcMainEvent,
			data: { requestId: string; elements: ClaudeSelectionItem[] }
		) => {
			if (data.requestId !== requestId || resolved) return;
			resolved = true;
			clearTimeout(timeout);
			ipcMain.removeListener("claude:timeline:getSelection:response", handler);
			resolve(data.elements);
		};

		ipcMain.on("claude:timeline:getSelection:response", handler);
		win.webContents.send("claude:timeline:getSelection", { requestId });
	});
}

async function requestRendererResult<T>({
	win,
	requestChannel,
	responseChannel,
	payload,
	timeoutErrorMessage,
}: {
	win: BrowserWindow;
	requestChannel: string;
	responseChannel: string;
	payload: Record<string, unknown>;
	timeoutErrorMessage: string;
}): Promise<T> {
	return new Promise((resolve, reject) => {
		let resolved = false;
		const requestId = generateId("req");

		const timeout = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener(responseChannel, responseHandler);
			reject(new Error(timeoutErrorMessage));
		}, TIMELINE_REQUEST_TIMEOUT_MS);

		const responseHandler = (
			_event: IpcMainEvent,
			data: { requestId: string; result: T }
		) => {
			if (resolved || data.requestId !== requestId) {
				return;
			}
			resolved = true;
			clearTimeout(timeout);
			ipcMain.removeListener(responseChannel, responseHandler);
			resolve(data.result);
		};

		ipcMain.on(responseChannel, responseHandler);
		win.webContents.send(requestChannel, {
			requestId,
			...payload,
		});
	});
}

function normalizeBatchTrackElementType({
	type,
}: {
	type: ClaudeBatchAddElementRequest["type"];
}): "media" | "text" | "sticker" | "captions" | "remotion" | "markdown" {
	if (type === "video" || type === "audio" || type === "image") {
		return "media";
	}
	if (
		type === "media" ||
		type === "text" ||
		type === "sticker" ||
		type === "captions" ||
		type === "remotion" ||
		type === "markdown"
	) {
		return type;
	}
	return "media";
}

function isTrackCompatibleWithElementType({
	trackType,
	elementType,
}: {
	trackType: string;
	elementType: ClaudeBatchAddElementRequest["type"];
}): boolean {
	const normalizedElementType = normalizeBatchTrackElementType({
		type: elementType,
	});

	if (normalizedElementType === "text") return trackType === "text";
	if (normalizedElementType === "sticker") return trackType === "sticker";
	if (normalizedElementType === "captions") return trackType === "captions";
	if (normalizedElementType === "remotion") return trackType === "remotion";
	if (normalizedElementType === "markdown") return trackType === "markdown";
	return trackType === "media" || trackType === "audio";
}

export async function requestBatchAddElementsFromRenderer(
	win: BrowserWindow,
	elements: ClaudeBatchAddElementRequest[]
): Promise<ClaudeBatchAddResponse> {
	return requestRendererResult<ClaudeBatchAddResponse>({
		win,
		requestChannel: "claude:timeline:batchAddElements",
		responseChannel: "claude:timeline:batchAddElements:response",
		payload: { elements },
		timeoutErrorMessage: "Timeout waiting for batch add result",
	});
}

export async function requestBatchUpdateElementsFromRenderer(
	win: BrowserWindow,
	updates: ClaudeBatchUpdateItemRequest[]
): Promise<ClaudeBatchUpdateResponse> {
	return requestRendererResult<ClaudeBatchUpdateResponse>({
		win,
		requestChannel: "claude:timeline:batchUpdateElements",
		responseChannel: "claude:timeline:batchUpdateElements:response",
		payload: { updates },
		timeoutErrorMessage: "Timeout waiting for batch update result",
	});
}

export async function requestBatchDeleteElementsFromRenderer(
	win: BrowserWindow,
	elements: ClaudeBatchDeleteItemRequest[],
	ripple = false
): Promise<ClaudeBatchDeleteResponse> {
	return requestRendererResult<ClaudeBatchDeleteResponse>({
		win,
		requestChannel: "claude:timeline:batchDeleteElements",
		responseChannel: "claude:timeline:batchDeleteElements:response",
		payload: { elements, ripple },
		timeoutErrorMessage: "Timeout waiting for batch delete result",
	});
}

export async function requestDeleteRangeFromRenderer(
	win: BrowserWindow,
	request: ClaudeRangeDeleteRequest
): Promise<ClaudeRangeDeleteResponse> {
	return requestRendererResult<ClaudeRangeDeleteResponse>({
		win,
		requestChannel: "claude:timeline:deleteRange",
		responseChannel: "claude:timeline:deleteRange:response",
		payload: { request },
		timeoutErrorMessage: "Timeout waiting for range delete result",
	});
}

export async function requestArrangeFromRenderer(
	win: BrowserWindow,
	request: ClaudeArrangeRequest
): Promise<ClaudeArrangeResponse> {
	return requestRendererResult<ClaudeArrangeResponse>({
		win,
		requestChannel: "claude:timeline:arrange",
		responseChannel: "claude:timeline:arrange:response",
		payload: { request },
		timeoutErrorMessage: "Timeout waiting for arrange result",
	});
}

export async function batchAddElements(
	win: BrowserWindow,
	_projectId: string,
	elements: ClaudeBatchAddElementRequest[]
): Promise<ClaudeBatchAddResponse> {
	try {
		if (!Array.isArray(elements)) {
			throw new Error("elements must be an array");
		}
		if (elements.length > MAX_TIMELINE_BATCH_ITEMS) {
			throw new Error(
				`Batch add limited to ${MAX_TIMELINE_BATCH_ITEMS} elements`
			);
		}
		if (elements.length === 0) {
			return { added: [], failedCount: 0 };
		}

		for (const element of elements) {
			if (!element.trackId || typeof element.trackId !== "string") {
				throw new Error("Each element must include a valid trackId");
			}
			if (
				typeof element.startTime !== "number" ||
				Number.isNaN(element.startTime) ||
				element.startTime < 0
			) {
				throw new Error("Each element must include a non-negative startTime");
			}
			if (
				typeof element.duration !== "number" ||
				Number.isNaN(element.duration) ||
				element.duration <= 0
			) {
				throw new Error("Each element must include a duration > 0");
			}
		}

		const timeline = await requestTimelineFromRenderer(win);
		const trackById = new Map<string, string>();
		for (const track of timeline.tracks) {
			if (track.id) {
				trackById.set(track.id, track.type);
			}
		}

		if (trackById.size > 0) {
			for (const element of elements) {
				const trackType = trackById.get(element.trackId);
				if (!trackType) {
					throw new Error(`Track not found: ${element.trackId}`);
				}
				if (
					!isTrackCompatibleWithElementType({
						trackType,
						elementType: element.type,
					})
				) {
					throw new Error(
						`Element type '${element.type}' is not compatible with track '${element.trackId}' (${trackType})`
					);
				}
			}
		}

		return requestBatchAddElementsFromRenderer(win, elements);
	} catch (error) {
		throw new Error(
			error instanceof Error ? error.message : "Failed to batch add elements"
		);
	}
}

export async function batchUpdateElements(
	win: BrowserWindow,
	updates: ClaudeBatchUpdateItemRequest[]
): Promise<ClaudeBatchUpdateResponse> {
	try {
		if (!Array.isArray(updates)) {
			throw new Error("updates must be an array");
		}
		if (updates.length > MAX_TIMELINE_BATCH_ITEMS) {
			throw new Error(
				`Batch update limited to ${MAX_TIMELINE_BATCH_ITEMS} updates`
			);
		}
		for (const update of updates) {
			if (!update.elementId || typeof update.elementId !== "string") {
				throw new Error("Each update must include a valid elementId");
			}
		}
		return requestBatchUpdateElementsFromRenderer(win, updates);
	} catch (error) {
		throw new Error(
			error instanceof Error ? error.message : "Failed to batch update elements"
		);
	}
}

export async function batchDeleteElements(
	win: BrowserWindow,
	elements: ClaudeBatchDeleteItemRequest[],
	ripple = false
): Promise<ClaudeBatchDeleteResponse> {
	try {
		if (!Array.isArray(elements)) {
			throw new Error("elements must be an array");
		}
		if (elements.length > MAX_TIMELINE_BATCH_ITEMS) {
			throw new Error(
				`Batch delete limited to ${MAX_TIMELINE_BATCH_ITEMS} elements`
			);
		}
		for (const element of elements) {
			if (!element.trackId || typeof element.trackId !== "string") {
				throw new Error("Each delete item must include a valid trackId");
			}
			if (!element.elementId || typeof element.elementId !== "string") {
				throw new Error("Each delete item must include a valid elementId");
			}
		}
		return requestBatchDeleteElementsFromRenderer(win, elements, ripple);
	} catch (error) {
		throw new Error(
			error instanceof Error ? error.message : "Failed to batch delete elements"
		);
	}
}

export async function deleteTimelineRange(
	win: BrowserWindow,
	request: ClaudeRangeDeleteRequest
): Promise<ClaudeRangeDeleteResponse> {
	try {
		if (
			typeof request.startTime !== "number" ||
			typeof request.endTime !== "number"
		) {
			throw new Error("startTime and endTime must be numbers");
		}
		if (request.endTime <= request.startTime) {
			throw new Error("endTime must be greater than startTime");
		}
		return requestDeleteRangeFromRenderer(win, request);
	} catch (error) {
		throw new Error(
			error instanceof Error ? error.message : "Failed to delete time range"
		);
	}
}

export async function arrangeTimeline(
	win: BrowserWindow,
	request: ClaudeArrangeRequest
): Promise<ClaudeArrangeResponse> {
	try {
		if (!request.trackId || typeof request.trackId !== "string") {
			throw new Error("trackId is required");
		}
		if (
			request.mode !== "sequential" &&
			request.mode !== "spaced" &&
			request.mode !== "manual"
		) {
			throw new Error("mode must be one of: sequential, spaced, manual");
		}
		if (request.gap !== undefined && request.gap < 0) {
			throw new Error("gap must be >= 0");
		}
		if (request.startOffset !== undefined && request.startOffset < 0) {
			throw new Error("startOffset must be >= 0");
		}
		return requestArrangeFromRenderer(win, request);
	} catch (error) {
		throw new Error(
			error instanceof Error ? error.message : "Failed to arrange timeline"
		);
	}
}
