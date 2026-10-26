/**
 * Claude Timeline Operations
 *
 * Renderer request helpers and batch operation functions for timeline
 * manipulation (add, update, delete, split, select, arrange).
 */

import { ipcMain, BrowserWindow, IpcMainEvent } from "electron";
import { generateId } from "../utils/helpers.js";
import { withTimelineBatchTimeoutContext } from "../utils/timeline-batch-deadline.js";
import { requestRendererMutation } from "./claude-renderer-mutation-handler.js";
import { withDefaultMediaDurations } from "./claude-media-default-duration.js";
import {
	assertIpcMainReady,
	assertRendererWindowReady,
} from "../utils/renderer-ipc-guard.js";
import type {
	ClaudeTimeline,
	ClaudeElement,
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
	ClaudeTrackOperationRequest,
	ClaudeTrackOperationResponse,
	ClaudeShotSplitRequest,
	ClaudeShotSplitResponse,
	ClaudeBeatsMarkRequest,
	ClaudeBeatsMarkResponse,
	ClaudeSnapToBeatsRequest,
	ClaudeSnapToBeatsResponse,
} from "../../types/claude-api";
import type {
	ClaudeAudioMixRequest,
	ClaudeAudioMixResponse,
} from "../../types/claude-audio-mix-api";

const MAX_TIMELINE_BATCH_ITEMS = 50;
const TIMELINE_REQUEST_TIMEOUT_MS = 5000;
/**
 * Measuring loudness and writing stems render the whole mix first; a long
 * programme takes minutes per bus. The HTTP side answers with a job id, so
 * only this renderer wait bounds the render.
 */
export const AUDIO_MIX_RENDER_TIMEOUT_MS = 3_600_000;

interface RendererResultResponse<T> {
	requestId: string;
	result: T;
}

function isRendererResultResponse<T>(
	candidate: unknown
): candidate is RendererResultResponse<T> {
	if (typeof candidate !== "object" || candidate === null) return false;
	const response = candidate as Record<string, unknown>;
	return typeof response.requestId === "string" && "result" in response;
}

function requireTimelineProjectId({
	projectId,
}: {
	projectId: string;
}): string {
	if (typeof projectId !== "string" || projectId.trim().length === 0) {
		throw new Error("Timeline mutation requires a projectId");
	}
	return projectId;
}

export async function requestAddElementFromRenderer({
	correlationId,
	element,
	projectId,
	win,
}: {
	correlationId?: string;
	element: Partial<ClaudeElement>;
	projectId: string;
	win: BrowserWindow;
}): Promise<void> {
	await requestRendererMutation({
		channel: "claude:timeline:addElement",
		payload: {
			...element,
			...(correlationId ? { correlationId } : {}),
			projectId: requireTimelineProjectId({ projectId }),
		},
		requestIdPrefix: "timeline-add",
		responseChannel: "claude:timeline:addElement:response",
		timeoutMessage: "Renderer timeline element mutation timed out.",
		timeoutMs: TIMELINE_REQUEST_TIMEOUT_MS,
		win,
	});
}

/**
 * Request timeline data from renderer process
 */
export async function requestTimelineFromRenderer(
	win: BrowserWindow
): Promise<ClaudeTimeline> {
	assertIpcMainReady({
		ipcMainInstance: ipcMain,
		action: "timeline request",
		requiresOnce: true,
	});
	assertRendererWindowReady({
		win,
		action: "timeline request",
	});

	return new Promise((resolve, reject) => {
		let resolved = false;
		let timeout: NodeJS.Timeout | undefined;
		const responseChannel = "claude:timeline:response";

		const cleanup = (): void => {
			if (timeout) {
				clearTimeout(timeout);
			}
			ipcMain.removeListener(responseChannel, handler);
		};

		const rejectOnce = ({ error }: { error: Error }): void => {
			if (resolved) return;
			resolved = true;
			cleanup();
			reject(error);
		};

		timeout = setTimeout(() => {
			rejectOnce({ error: new Error("Timeout waiting for timeline data") });
		}, 5000);

		/** Handle handler. */
		const handler = (_event: IpcMainEvent, timeline: ClaudeTimeline) => {
			if (resolved) return;
			resolved = true;
			cleanup();
			resolve(timeline);
		};

		try {
			ipcMain.once(responseChannel, handler);
			win.webContents.send("claude:timeline:request");
		} catch (error) {
			const failure =
				error instanceof Error
					? error
					: new Error("Failed to request timeline from renderer");
			rejectOnce({ error: failure });
		}
	});
}

/**
 * Request a split operation from the renderer and wait for the result
 */
/** Detection plus splitting can take minutes for a whole track. */
const SHOT_SPLIT_TIMEOUT_MS = 1_200_000;

export async function requestShotSplitFromRenderer(
	win: BrowserWindow,
	request: ClaudeShotSplitRequest,
	correlationId?: string
): Promise<ClaudeShotSplitResponse> {
	return new Promise((resolve, reject) => {
		let resolved = false;
		const requestId = generateId("req");
		const channel = "claude:timeline:shotSplit:response";

		const timeout = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			ipcMain.removeListener(channel, handler);
			reject(new Error("Timeout waiting for the shot split result"));
		}, SHOT_SPLIT_TIMEOUT_MS);

		const handler = (event: IpcMainEvent, data: unknown) => {
			// Only the editor's main frame answers, and only with a well-formed
			// result; anything else is ignored rather than thrown inside the
			// listener, which would leave the promise waiting for the timeout.
			if (
				resolved ||
				typeof data !== "object" ||
				data === null ||
				(data as { requestId?: unknown }).requestId !== requestId ||
				event.sender !== win.webContents ||
				event.senderFrame !== win.webContents.mainFrame
			) {
				return;
			}
			const result = (data as { result?: unknown }).result;
			if (typeof result !== "object" || result === null) return;
			resolved = true;
			clearTimeout(timeout);
			ipcMain.removeListener(channel, handler);
			const outcome = result as
				| { ok: true; response: ClaudeShotSplitResponse }
				| { ok: false; error: string };
			if (outcome.ok) resolve(outcome.response);
			else reject(new Error(String(outcome.error)));
		};

		ipcMain.on(channel, handler);
		win.webContents.send("claude:timeline:shotSplit", {
			requestId,
			correlationId,
			request,
		});
	});
}

export async function requestSplitFromRenderer(
	win: BrowserWindow,
	elementId: string,
	splitTime: number,
	mode?: string,
	correlationId?: string
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
			correlationId,
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
	win: BrowserWindow,
	correlationId?: string
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
		win.webContents.send("claude:timeline:getSelection", {
			requestId,
			correlationId,
		});
	});
}

async function requestRendererResult<T>({
	win,
	requestChannel,
	responseChannel,
	payload,
	timeoutErrorMessage,
	correlationId,
	timeoutMs = TIMELINE_REQUEST_TIMEOUT_MS,
}: {
	win: BrowserWindow;
	requestChannel: string;
	responseChannel: string;
	payload: Record<string, unknown>;
	timeoutErrorMessage: string;
	correlationId?: string;
	timeoutMs?: number;
}): Promise<T> {
	assertIpcMainReady({
		ipcMainInstance: ipcMain,
		action: requestChannel,
		requiresOnce: false,
	});
	assertRendererWindowReady({
		win,
		action: requestChannel,
	});

	return new Promise((resolve, reject) => {
		let resolved = false;
		const requestId = generateId("req");
		let timeout: NodeJS.Timeout | undefined;

		const cleanup = (): void => {
			if (timeout) {
				clearTimeout(timeout);
			}
			ipcMain.removeListener(responseChannel, responseHandler);
		};

		const rejectOnce = ({ error }: { error: Error }): void => {
			if (resolved) return;
			resolved = true;
			cleanup();
			reject(error);
		};

		timeout = setTimeout(() => {
			rejectOnce({ error: new Error(timeoutErrorMessage) });
		}, timeoutMs);

		const responseHandler = (event: IpcMainEvent, data: unknown) => {
			if (
				resolved ||
				!isRendererResultResponse<T>(data) ||
				data.requestId !== requestId ||
				event.sender !== win.webContents ||
				event.senderFrame !== win.webContents.mainFrame
			) {
				return;
			}
			resolved = true;
			cleanup();
			resolve(data.result);
		};

		try {
			ipcMain.on(responseChannel, responseHandler);
			win.webContents.send(requestChannel, {
				requestId,
				correlationId,
				...payload,
			});
		} catch (error) {
			const failure =
				error instanceof Error
					? error
					: new Error(`Failed renderer request: ${requestChannel}`);
			rejectOnce({ error: failure });
		}
	});
}

/** Normalize batch track element type. */
function normalizeBatchTrackElementType({
	type,
}: {
	type: ClaudeBatchAddElementRequest["type"];
}):
	| "media"
	| "text"
	| "sticker"
	| "adjustment"
	| "captions"
	| "remotion"
	| "markdown" {
	if (type === "video" || type === "audio" || type === "image") {
		return "media";
	}
	// Normalize singular "caption" to plural "captions" (CLI compatibility)
	if (type === "caption") {
		return "captions";
	}
	if (
		type === "media" ||
		type === "text" ||
		type === "sticker" ||
		type === "adjustment" ||
		type === "captions" ||
		type === "remotion" ||
		type === "markdown"
	) {
		return type;
	}
	return "media";
}

/** Handle is track compatible with element type. */
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
	if (normalizedElementType === "adjustment") return trackType === "adjustment";
	if (normalizedElementType === "captions") return trackType === "captions";
	if (normalizedElementType === "remotion") return trackType === "remotion";
	if (normalizedElementType === "markdown") return trackType === "markdown";
	return trackType === "media" || trackType === "audio";
}

/**
 * A batch's renderer deadline grows with its size: the editor stores one
 * element at a time (each add re-renders the timeline), so a 50-clip batch
 * on a long programme takes well over the single-request 5 s.
 */
function batchRequestTimeoutMs({ count }: { count: number }): number {
	return TIMELINE_REQUEST_TIMEOUT_MS + 1_000 * Math.max(0, count);
}

type RendererOutcome<T> =
	| { ok: true; response: T }
	| { ok: false; error: string };

/** A renderer answer of the `{ok, response} | {ok, error}` shape, or a thrown error. */
async function requestRendererOutcome<T>({
	win,
	channel,
	payload,
	timeoutMs,
	timeoutErrorMessage,
	correlationId,
}: {
	win: BrowserWindow;
	channel: string;
	payload: Record<string, unknown>;
	timeoutMs: number;
	timeoutErrorMessage: string;
	correlationId?: string;
}): Promise<T> {
	const outcome = await requestRendererResult<RendererOutcome<T>>({
		win,
		requestChannel: channel,
		responseChannel: `${channel}:response`,
		payload,
		timeoutErrorMessage,
		correlationId,
		timeoutMs,
	});
	if (!outcome || typeof outcome !== "object" || !("ok" in outcome)) {
		throw new Error(`Malformed renderer answer on ${channel}`);
	}
	if (!outcome.ok) throw new Error(outcome.error);
	return outcome.response;
}

/** Hands a clip's beat detection result to the editor's beat store. */
export async function requestBeatsMarkFromRenderer(
	win: BrowserWindow,
	request: ClaudeBeatsMarkRequest,
	correlationId?: string
): Promise<ClaudeBeatsMarkResponse> {
	return requestRendererOutcome<ClaudeBeatsMarkResponse>({
		win,
		channel: "claude:timeline:beatsMark",
		payload: { request },
		// Bookmarks save the project once per beat.
		timeoutMs: 120_000,
		timeoutErrorMessage: "Timeout waiting for the beats mark result",
		correlationId,
	});
}

/** Moves clips onto marked beats through the editor's own move. */
export async function requestSnapToBeatsFromRenderer(
	win: BrowserWindow,
	request: ClaudeSnapToBeatsRequest,
	correlationId?: string
): Promise<ClaudeSnapToBeatsResponse> {
	return requestRendererOutcome<ClaudeSnapToBeatsResponse>({
		win,
		channel: "claude:timeline:snapToBeats",
		payload: { request },
		timeoutMs: 30_000,
		timeoutErrorMessage: "Timeout waiting for the snap to beats result",
		correlationId,
	});
}

/** Handle request batch add elements from renderer. */
export async function requestBatchAddElementsFromRenderer(
	win: BrowserWindow,
	projectId: string,
	elements: ClaudeBatchAddElementRequest[],
	correlationId?: string
): Promise<ClaudeBatchAddResponse> {
	return requestRendererResult<ClaudeBatchAddResponse>({
		win,
		requestChannel: "claude:timeline:batchAddElements",
		responseChannel: "claude:timeline:batchAddElements:response",
		payload: {
			elements,
			projectId: requireTimelineProjectId({ projectId }),
		},
		timeoutErrorMessage: "Timeout waiting for batch add result",
		correlationId,
		timeoutMs: batchRequestTimeoutMs({ count: elements.length }),
	}).catch((error: unknown) => {
		throw withTimelineBatchTimeoutContext({ error });
	});
}

/** Handle request batch update elements from renderer. */
export async function requestBatchUpdateElementsFromRenderer(
	win: BrowserWindow,
	updates: ClaudeBatchUpdateItemRequest[],
	correlationId?: string
): Promise<ClaudeBatchUpdateResponse> {
	return requestRendererResult<ClaudeBatchUpdateResponse>({
		win,
		requestChannel: "claude:timeline:batchUpdateElements",
		responseChannel: "claude:timeline:batchUpdateElements:response",
		payload: { updates },
		timeoutErrorMessage: "Timeout waiting for batch update result",
		correlationId,
		timeoutMs: batchRequestTimeoutMs({ count: updates.length }),
	});
}

/** Handle request batch delete elements from renderer. */
export async function requestBatchDeleteElementsFromRenderer(
	win: BrowserWindow,
	elements: ClaudeBatchDeleteItemRequest[],
	ripple = false,
	correlationId?: string
): Promise<ClaudeBatchDeleteResponse> {
	return requestRendererResult<ClaudeBatchDeleteResponse>({
		win,
		requestChannel: "claude:timeline:batchDeleteElements",
		responseChannel: "claude:timeline:batchDeleteElements:response",
		payload: { elements, ripple },
		timeoutErrorMessage: "Timeout waiting for batch delete result",
		correlationId,
		timeoutMs: batchRequestTimeoutMs({ count: elements.length }),
	});
}

/** Handle request delete range from renderer. */
export async function requestDeleteRangeFromRenderer(
	win: BrowserWindow,
	request: ClaudeRangeDeleteRequest,
	correlationId?: string
): Promise<ClaudeRangeDeleteResponse> {
	return requestRendererResult<ClaudeRangeDeleteResponse>({
		win,
		requestChannel: "claude:timeline:deleteRange",
		responseChannel: "claude:timeline:deleteRange:response",
		payload: { request },
		timeoutErrorMessage: "Timeout waiting for range delete result",
		correlationId,
	});
}

/** Handle request arrange from renderer. */
export async function requestArrangeFromRenderer(
	win: BrowserWindow,
	request: ClaudeArrangeRequest,
	correlationId?: string
): Promise<ClaudeArrangeResponse> {
	return requestRendererResult<ClaudeArrangeResponse>({
		win,
		requestChannel: "claude:timeline:arrange",
		responseChannel: "claude:timeline:arrange:response",
		payload: { request },
		timeoutErrorMessage: "Timeout waiting for arrange result",
		correlationId,
	});
}

/** Request a track mutation from the renderer and return the verified order. */
export async function requestTrackOperationFromRenderer(
	win: BrowserWindow,
	request: ClaudeTrackOperationRequest,
	correlationId?: string
): Promise<ClaudeTrackOperationResponse> {
	return requestRendererResult<ClaudeTrackOperationResponse>({
		win,
		requestChannel: "claude:timeline:trackOperation",
		responseChannel: "claude:timeline:trackOperation:response",
		payload: { request },
		timeoutErrorMessage: "Timeout waiting for track operation result",
		correlationId,
	});
}

/** Ask the renderer to read or change the mixer; it answers with the mix. */
export async function requestAudioMixOperationFromRenderer(
	win: BrowserWindow,
	request: ClaudeAudioMixRequest,
	correlationId?: string
): Promise<ClaudeAudioMixResponse> {
	return requestRendererResult<ClaudeAudioMixResponse>({
		win,
		requestChannel: "claude:timeline:audioMixOperation",
		responseChannel: "claude:timeline:audioMixOperation:response",
		payload: { request },
		timeoutErrorMessage: "Timeout waiting for mixer result",
		correlationId,
		timeoutMs:
			request.action === "measure-loudness" || request.action === "render-stems"
				? AUDIO_MIX_RENDER_TIMEOUT_MS
				: TIMELINE_REQUEST_TIMEOUT_MS,
	});
}

/**
 * Shape check for where a batch element goes. The renderer resolves the
 * shorthands ("end", after, frame counts) against the live timeline, so this
 * only rejects requests that could never be placed.
 */
export function assertBatchElementPlacement({
	element,
}: {
	element: ClaudeBatchAddElementRequest;
}): void {
	const { startTime, after, startFrame, duration, durationFrames } = element;
	const startForms = [startTime, after, startFrame].filter(
		(value) => value !== undefined
	).length;
	const validStart =
		startForms === 1 &&
		(startTime === "end" ||
			(typeof startTime === "number" &&
				Number.isFinite(startTime) &&
				startTime >= 0) ||
			(typeof after === "string" && after.length > 0) ||
			(typeof startFrame === "number" &&
				Number.isInteger(startFrame) &&
				startFrame >= 0));
	if (!validStart) {
		throw new Error(
			'Each element must include exactly one of: startTime (seconds >= 0 or "end"), after (an element id), startFrame (whole frames >= 0)'
		);
	}
	const validDuration =
		(typeof duration === "number" &&
			Number.isFinite(duration) &&
			duration > 0 &&
			durationFrames === undefined) ||
		(duration === undefined &&
			typeof durationFrames === "number" &&
			Number.isInteger(durationFrames) &&
			durationFrames > 0);
	if (!validDuration) {
		throw new Error(
			"Each element must include either a duration > 0 (seconds) or durationFrames (whole frames > 0); video and audio default to their file's length when the file is in the project"
		);
	}
}

/** Handle batch add elements. */
export async function batchAddElements(
	win: BrowserWindow,
	projectId: string,
	elements: ClaudeBatchAddElementRequest[],
	correlationId?: string
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

		// Media named without a length gets its file's length before anything
		// checks for one.
		const requests = await withDefaultMediaDurations({ projectId, elements });

		for (const element of requests) {
			if (!element.trackId || typeof element.trackId !== "string") {
				throw new Error("Each element must include a valid trackId");
			}
			assertBatchElementPlacement({ element });
			if (
				element.collision !== undefined &&
				element.collision !== "reject" &&
				element.collision !== "insert" &&
				element.collision !== "overwrite"
			) {
				throw new Error("collision must be one of: reject, insert, overwrite");
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
			for (const element of requests) {
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

		return requestBatchAddElementsFromRenderer(
			win,
			projectId,
			requests,
			correlationId
		);
	} catch (error) {
		throw new Error(
			error instanceof Error ? error.message : "Failed to batch add elements"
		);
	}
}

/** Handle batch update elements. */
export async function batchUpdateElements(
	win: BrowserWindow,
	updates: ClaudeBatchUpdateItemRequest[],
	correlationId?: string
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
		return requestBatchUpdateElementsFromRenderer(win, updates, correlationId);
	} catch (error) {
		throw new Error(
			error instanceof Error ? error.message : "Failed to batch update elements"
		);
	}
}

/** Handle batch delete elements. */
export async function batchDeleteElements(
	win: BrowserWindow,
	elements: ClaudeBatchDeleteItemRequest[],
	ripple = false,
	correlationId?: string
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
		return requestBatchDeleteElementsFromRenderer(
			win,
			elements,
			ripple,
			correlationId
		);
	} catch (error) {
		throw new Error(
			error instanceof Error ? error.message : "Failed to batch delete elements"
		);
	}
}

/** Handle delete timeline range. */
export async function deleteTimelineRange(
	win: BrowserWindow,
	request: ClaudeRangeDeleteRequest,
	correlationId?: string
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
		return requestDeleteRangeFromRenderer(win, request, correlationId);
	} catch (error) {
		throw new Error(
			error instanceof Error ? error.message : "Failed to delete time range"
		);
	}
}

/** Handle arrange timeline. */
export async function arrangeTimeline(
	win: BrowserWindow,
	request: ClaudeArrangeRequest,
	correlationId?: string
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
		return requestArrangeFromRenderer(win, request, correlationId);
	} catch (error) {
		throw new Error(
			error instanceof Error ? error.message : "Failed to arrange timeline"
		);
	}
}
