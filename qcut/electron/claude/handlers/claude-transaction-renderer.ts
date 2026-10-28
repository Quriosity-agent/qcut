/**
 * The editor window's half of a timeline transaction: each request goes to
 * the renderer bridge (claude-transaction-bridge.ts) and waits for its reply.
 * A request that times out may still run later, because the renderer handles
 * its messages in order once it is free again; callers clean up for that.
 *
 * @module electron/claude/handlers/claude-transaction-renderer
 */

import { type BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import { generateId } from "../utils/helpers.js";
import { claudeLog } from "../utils/logger.js";
import type { RendererTransactionSummary } from "../../types/claude-api.js";

export type { RendererTransactionSummary };

export const RENDERER_REQUEST_TIMEOUT_MS = 5000;
const LOG_NAME = "Transaction";

export interface ClaudeHistoryEntry {
	label: string;
	timestamp: number;
	transactionId?: string;
}

export interface ClaudeHistorySummary {
	undoCount: number;
	redoCount: number;
	entries: ClaudeHistoryEntry[];
	redoEntries?: ClaudeHistoryEntry[];
	/** Absent from editors that predate it; null when none is open. */
	activeTransaction?: RendererTransactionSummary | null;
}

export interface ClaudeUndoRedoResponse {
	applied: boolean;
	undoCount: number;
	redoCount: number;
}

export type RendererTransactionResult = {
	success: boolean;
	error?: string;
	message?: string;
};

export type RendererCommitResult = RendererTransactionResult & {
	historyEntryAdded?: boolean;
};

type RendererRequestResult<T> = { requestId: string; result: T };

function requestRendererResponse<T>({
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
			if (resolved) {
				return;
			}
			resolved = true;
			ipcMain.removeListener(responseChannel, responseHandler);
			reject(new Error(timeoutErrorMessage));
		}, RENDERER_REQUEST_TIMEOUT_MS);

		const responseHandler = (
			_event: IpcMainEvent,
			data: RendererRequestResult<T>
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

export function requestBeginFromRenderer({
	win,
	transactionId,
	label,
	timeoutMs,
	createdAt,
	expiresAt,
}: {
	win: BrowserWindow;
	transactionId: string;
	label?: string;
	timeoutMs: number;
	createdAt: number;
	expiresAt: number;
}): Promise<RendererTransactionResult> {
	return requestRendererResponse<RendererTransactionResult>({
		win,
		requestChannel: "claude:transaction:begin",
		responseChannel: "claude:transaction:begin:response",
		payload: { transactionId, label, timeoutMs, createdAt, expiresAt },
		timeoutErrorMessage: "Timeout waiting for transaction begin",
	});
}

export function requestCommitFromRenderer({
	win,
	transactionId,
	label,
}: {
	win: BrowserWindow;
	transactionId: string;
	label?: string;
}): Promise<RendererCommitResult> {
	return requestRendererResponse<RendererCommitResult>({
		win,
		requestChannel: "claude:transaction:commit",
		responseChannel: "claude:transaction:commit:response",
		payload: { transactionId, label },
		timeoutErrorMessage: "Timeout waiting for transaction commit",
	});
}

/**
 * Ends the renderer's transaction. `discard` drops it without restoring the
 * timeline: for a transaction no caller ever got to use (its begin timed
 * out), so everything edited since it opened stays.
 */
export function requestRollbackFromRenderer({
	win,
	transactionId,
	reason,
	discard = false,
}: {
	win: BrowserWindow;
	transactionId: string;
	reason?: string;
	discard?: boolean;
}): Promise<RendererTransactionResult> {
	return requestRendererResponse<RendererTransactionResult>({
		win,
		requestChannel: "claude:transaction:rollback",
		responseChannel: "claude:transaction:rollback:response",
		payload: { transactionId, reason, ...(discard ? { discard } : {}) },
		timeoutErrorMessage: "Timeout waiting for transaction rollback",
	});
}

export function requestUndoFromRenderer({
	win,
}: {
	win: BrowserWindow;
}): Promise<ClaudeUndoRedoResponse> {
	return requestRendererResponse<ClaudeUndoRedoResponse>({
		win,
		requestChannel: "claude:transaction:undo",
		responseChannel: "claude:transaction:undo:response",
		payload: {},
		timeoutErrorMessage: "Timeout waiting for undo",
	});
}

export function requestRedoFromRenderer({
	win,
}: {
	win: BrowserWindow;
}): Promise<ClaudeUndoRedoResponse> {
	return requestRendererResponse<ClaudeUndoRedoResponse>({
		win,
		requestChannel: "claude:transaction:redo",
		responseChannel: "claude:transaction:redo:response",
		payload: {},
		timeoutErrorMessage: "Timeout waiting for redo",
	});
}

export function requestHistoryFromRenderer({
	win,
}: {
	win: BrowserWindow;
}): Promise<ClaudeHistorySummary> {
	return requestRendererResponse<ClaudeHistorySummary>({
		win,
		requestChannel: "claude:transaction:history",
		responseChannel: "claude:transaction:history:response",
		payload: {},
		timeoutErrorMessage: "Timeout waiting for history",
	});
}

/** Ends, without restoring anything, a begin the caller has given up on. */
export function discardAbandonedBegin({
	win,
	transactionId,
}: {
	win: BrowserWindow;
	transactionId: string;
}): void {
	requestRollbackFromRenderer({
		win,
		transactionId,
		reason: "Begin timed out",
		discard: true,
	})
		.then((result) => {
			if (result.success) {
				claudeLog.warn(
					LOG_NAME,
					`Discarded transaction ${transactionId}: the editor began it after its begin timed out`
				);
			}
		})
		.catch((error) => {
			claudeLog.warn(
				LOG_NAME,
				`Could not discard transaction ${transactionId} after its begin timed out`,
				error
			);
		});
}
