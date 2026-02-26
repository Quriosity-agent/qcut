import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import { generateId } from "../utils/helpers.js";
import { claudeLog } from "../utils/logger.js";
import {
	TRANSACTION_STATE,
	type Transaction,
	type TransactionRequest,
} from "../../types/claude-api.js";

const HANDLER_NAME = "Transaction";
const RENDERER_REQUEST_TIMEOUT_MS = 5000;
export const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000;
const MAX_STORED_TRANSACTIONS = 200;

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
}

export interface ClaudeUndoRedoResponse {
	applied: boolean;
	undoCount: number;
	redoCount: number;
}

type RendererTransactionResult = {
	success: boolean;
	error?: string;
	message?: string;
};

type RendererCommitResult = RendererTransactionResult & {
	historyEntryAdded?: boolean;
};

type ManagedTransaction = Transaction & {
	timeoutMs: number;
	timer: NodeJS.Timeout | null;
	window: BrowserWindow;
	isFinalizing: boolean;
};

type RendererRequestResult<T> = { requestId: string; result: T };

const transactionsById = new Map<string, ManagedTransaction>();
const transactionOrder: string[] = [];
let activeTransactionId: string | null = null;

export class ClaudeTransactionError extends Error {
	statusCode: number;
	code: string;

	constructor({
		message,
		statusCode,
		code,
	}: {
		message: string;
		statusCode: number;
		code: string;
	}) {
		super(message);
		this.name = "ClaudeTransactionError";
		this.statusCode = statusCode;
		this.code = code;
	}
}

function cloneTransaction({
	transaction,
}: {
	transaction: ManagedTransaction;
}): Transaction {
	return {
		id: transaction.id,
		label: transaction.label,
		state: transaction.state,
		createdAt: transaction.createdAt,
		updatedAt: transaction.updatedAt,
		expiresAt: transaction.expiresAt,
		error: transaction.error,
	};
}

function getManagedTransaction({
	transactionId,
}: {
	transactionId: string;
}): ManagedTransaction | null {
	return transactionsById.get(transactionId) ?? null;
}

function getActiveManagedTransaction(): ManagedTransaction | null {
	if (!activeTransactionId) {
		return null;
	}
	return getManagedTransaction({ transactionId: activeTransactionId });
}

function clearManagedTransactionTimer({
	transaction,
}: {
	transaction: ManagedTransaction;
}): void {
	try {
		if (!transaction.timer) {
			return;
		}
		clearTimeout(transaction.timer);
		transaction.timer = null;
	} catch (error) {
		claudeLog.warn(HANDLER_NAME, "Failed clearing transaction timer", error);
	}
}

function setTransactionFinalState({
	transaction,
	state,
	error,
}: {
	transaction: ManagedTransaction;
	state: Transaction["state"];
	error?: string;
}): void {
	transaction.state = state;
	transaction.updatedAt = Date.now();
	transaction.error = error;
	transaction.isFinalizing = false;
	clearManagedTransactionTimer({ transaction });
	if (activeTransactionId === transaction.id) {
		activeTransactionId = null;
	}
}

function trimStoredTransactions(): void {
	try {
		while (transactionOrder.length > MAX_STORED_TRANSACTIONS) {
			const oldestId = transactionOrder.shift();
			if (!oldestId) {
				return;
			}
			if (oldestId === activeTransactionId) {
				transactionOrder.unshift(oldestId);
				return;
			}
			transactionsById.delete(oldestId);
		}
	} catch (error) {
		claudeLog.warn(HANDLER_NAME, "Failed trimming transaction registry", error);
	}
}

function normalizeTimeoutMs({
	timeoutMs,
}: {
	timeoutMs?: number;
}): number {
	if (typeof timeoutMs !== "number" || Number.isNaN(timeoutMs)) {
		return DEFAULT_TRANSACTION_TIMEOUT_MS;
	}
	if (timeoutMs < 1000) {
		return 1000;
	}
	if (timeoutMs > 5 * 60_000) {
		return 5 * 60_000;
	}
	return Math.floor(timeoutMs);
}

function ensureNoActiveTransaction(): void {
	const active = getActiveManagedTransaction();
	if (!active) {
		return;
	}
	throw new ClaudeTransactionError({
		message: `Nested transactions are not supported. Active transaction: ${active.id}`,
		statusCode: 409,
		code: "TRANSACTION_ACTIVE",
	});
}

function ensureActiveTransactionMatches({
	transactionId,
}: {
	transactionId: string;
}): ManagedTransaction {
	const transaction = getManagedTransaction({ transactionId });
	if (!transaction) {
		throw new ClaudeTransactionError({
			message: `Transaction not found: ${transactionId}`,
			statusCode: 404,
			code: "TRANSACTION_NOT_FOUND",
		});
	}
	if (activeTransactionId !== transactionId || transaction.state !== TRANSACTION_STATE.active) {
		throw new ClaudeTransactionError({
			message: `Transaction is not active: ${transactionId}`,
			statusCode: 409,
			code: "TRANSACTION_NOT_ACTIVE",
		});
	}
	return transaction;
}

function getRollbackReasonText({
	reason,
}: {
	reason?: string;
}): string | undefined {
	if (!reason) {
		return undefined;
	}
	const trimmed = reason.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	return trimmed;
}

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

async function requestBeginFromRenderer({
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

async function requestCommitFromRenderer({
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

async function requestRollbackFromRenderer({
	win,
	transactionId,
	reason,
}: {
	win: BrowserWindow;
	transactionId: string;
	reason?: string;
}): Promise<RendererTransactionResult> {
	return requestRendererResponse<RendererTransactionResult>({
		win,
		requestChannel: "claude:transaction:rollback",
		responseChannel: "claude:transaction:rollback:response",
		payload: { transactionId, reason },
		timeoutErrorMessage: "Timeout waiting for transaction rollback",
	});
}

async function requestUndoFromRendererInternal({
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

async function requestRedoFromRendererInternal({
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

async function requestHistoryFromRendererInternal({
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

async function timeoutActiveTransaction({
	transaction,
}: {
	transaction: ManagedTransaction;
}): Promise<void> {
	try {
		if (activeTransactionId !== transaction.id) {
			return;
		}
		if (transaction.state !== TRANSACTION_STATE.active) {
			return;
		}
		if (transaction.isFinalizing) {
			claudeLog.warn(
				HANDLER_NAME,
				`Timeout skipped while transaction is finalizing: ${transaction.id}`
			);
			return;
		}

		transaction.isFinalizing = true;
		const reason = `Timed out after ${transaction.timeoutMs}ms`;
		claudeLog.warn(HANDLER_NAME, `Transaction timed out: ${transaction.id}`);

		try {
			const result = await requestRollbackFromRenderer({
				win: transaction.window,
				transactionId: transaction.id,
				reason,
			});
			if (!result.success) {
				setTransactionFinalState({
					transaction,
					state: TRANSACTION_STATE.timedOut,
					error: result.error || reason,
				});
				return;
			}
			setTransactionFinalState({
				transaction,
				state: TRANSACTION_STATE.timedOut,
				error: reason,
			});
		} catch (error) {
			setTransactionFinalState({
				transaction,
				state: TRANSACTION_STATE.timedOut,
				error: error instanceof Error ? error.message : reason,
			});
		}
	} catch (error) {
		claudeLog.error(HANDLER_NAME, "Unexpected timeout handler failure", error);
	}
}

function scheduleTransactionTimeout({
	transaction,
}: {
	transaction: ManagedTransaction;
}): void {
	try {
		clearManagedTransactionTimer({ transaction });
		transaction.timer = setTimeout(() => {
			void timeoutActiveTransaction({ transaction });
		}, transaction.timeoutMs);
	} catch (error) {
		claudeLog.error(HANDLER_NAME, "Failed to schedule transaction timeout", error);
	}
}

export async function beginTransaction({
	win,
	request,
}: {
	win: BrowserWindow;
	request?: TransactionRequest;
}): Promise<Transaction> {
	try {
		ensureNoActiveTransaction();
		const createdAt = Date.now();
		const timeoutMs = normalizeTimeoutMs({ timeoutMs: request?.timeoutMs });
		const transactionId = generateId("txn");
		const expiresAt = createdAt + timeoutMs;
		const label = typeof request?.label === "string" ? request.label.trim() || undefined : undefined;

		const transaction: ManagedTransaction = {
			id: transactionId,
			label,
			state: TRANSACTION_STATE.active,
			createdAt,
			updatedAt: createdAt,
			expiresAt,
			timeoutMs,
			timer: null,
			window: win,
			isFinalizing: false,
		};

		transactionsById.set(transactionId, transaction);
		transactionOrder.push(transactionId);
		activeTransactionId = transactionId;

		let beginResult: RendererTransactionResult;
		try {
			beginResult = await requestBeginFromRenderer({
				win,
				transactionId,
				label,
				timeoutMs,
				createdAt,
				expiresAt,
			});
		} catch (error) {
			transactionsById.delete(transactionId);
			const index = transactionOrder.lastIndexOf(transactionId);
			if (index >= 0) {
				transactionOrder.splice(index, 1);
			}
			if (activeTransactionId === transactionId) {
				activeTransactionId = null;
			}
			throw error;
		}

		if (!beginResult.success) {
			transactionsById.delete(transactionId);
			const index = transactionOrder.lastIndexOf(transactionId);
			if (index >= 0) {
				transactionOrder.splice(index, 1);
			}
			if (activeTransactionId === transactionId) {
				activeTransactionId = null;
			}
			throw new ClaudeTransactionError({
				message: beginResult.error || "Renderer rejected transaction begin",
				statusCode: 409,
				code: "TRANSACTION_BEGIN_REJECTED",
			});
		}

		scheduleTransactionTimeout({ transaction });
		trimStoredTransactions();
		claudeLog.info(HANDLER_NAME, `Transaction started: ${transactionId}`);
		return cloneTransaction({ transaction });
	} catch (error) {
		if (error instanceof ClaudeTransactionError) {
			throw error;
		}
		throw new ClaudeTransactionError({
			message: error instanceof Error ? error.message : "Failed to begin transaction",
			statusCode: 500,
			code: "TRANSACTION_BEGIN_FAILED",
		});
	}
}

export async function commitTransaction({
	transactionId,
}: {
	transactionId: string;
}): Promise<{ transaction: Transaction; historyEntryAdded: boolean }> {
	try {
		const transaction = ensureActiveTransactionMatches({ transactionId });
		if (transaction.isFinalizing) {
			throw new ClaudeTransactionError({
				message: `Transaction is already finalizing: ${transactionId}`,
				statusCode: 409,
				code: "TRANSACTION_FINALIZING",
			});
		}

		transaction.isFinalizing = true;
		clearManagedTransactionTimer({ transaction });

		const result = await requestCommitFromRenderer({
			win: transaction.window,
			transactionId,
			label: transaction.label,
		});

		if (!result.success) {
			transaction.isFinalizing = false;
			scheduleTransactionTimeout({ transaction });
			throw new ClaudeTransactionError({
				message: result.error || "Renderer rejected transaction commit",
				statusCode: 409,
				code: "TRANSACTION_COMMIT_REJECTED",
			});
		}

		setTransactionFinalState({
			transaction,
			state: TRANSACTION_STATE.committed,
		});
		claudeLog.info(HANDLER_NAME, `Transaction committed: ${transactionId}`);
		return {
			transaction: cloneTransaction({ transaction }),
			historyEntryAdded: result.historyEntryAdded === true,
		};
	} catch (error) {
		if (error instanceof ClaudeTransactionError) {
			throw error;
		}
		throw new ClaudeTransactionError({
			message: error instanceof Error ? error.message : "Failed to commit transaction",
			statusCode: 500,
			code: "TRANSACTION_COMMIT_FAILED",
		});
	}
}

export async function rollbackTransaction({
	transactionId,
	reason,
}: {
	transactionId: string;
	reason?: string;
}): Promise<{ transaction: Transaction }> {
	try {
		const transaction = ensureActiveTransactionMatches({ transactionId });
		if (transaction.isFinalizing) {
			throw new ClaudeTransactionError({
				message: `Transaction is already finalizing: ${transactionId}`,
				statusCode: 409,
				code: "TRANSACTION_FINALIZING",
			});
		}

		transaction.isFinalizing = true;
		clearManagedTransactionTimer({ transaction });

		const result = await requestRollbackFromRenderer({
			win: transaction.window,
			transactionId,
			reason: getRollbackReasonText({ reason }),
		});

		if (!result.success) {
			transaction.isFinalizing = false;
			scheduleTransactionTimeout({ transaction });
			throw new ClaudeTransactionError({
				message: result.error || "Renderer rejected transaction rollback",
				statusCode: 409,
				code: "TRANSACTION_ROLLBACK_REJECTED",
			});
		}

		setTransactionFinalState({
			transaction,
			state: TRANSACTION_STATE.rolledBack,
		});
		claudeLog.info(HANDLER_NAME, `Transaction rolled back: ${transactionId}`);
		return { transaction: cloneTransaction({ transaction }) };
	} catch (error) {
		if (error instanceof ClaudeTransactionError) {
			throw error;
		}
		throw new ClaudeTransactionError({
			message: error instanceof Error ? error.message : "Failed to rollback transaction",
			statusCode: 500,
			code: "TRANSACTION_ROLLBACK_FAILED",
		});
	}
}

export function getTransactionStatus({
	transactionId,
}: {
	transactionId: string;
}): Transaction | null {
	try {
		const transaction = getManagedTransaction({ transactionId });
		if (!transaction) {
			return null;
		}
		return cloneTransaction({ transaction });
	} catch (error) {
		claudeLog.error(HANDLER_NAME, "Failed to get transaction status", error);
		return null;
	}
}

export function getActiveTransactionStatus(): Transaction | null {
	try {
		const transaction = getActiveManagedTransaction();
		if (!transaction) {
			return null;
		}
		return cloneTransaction({ transaction });
	} catch (error) {
		claudeLog.error(HANDLER_NAME, "Failed to get active transaction", error);
		return null;
	}
}

export async function undoTimeline({
	win,
}: {
	win: BrowserWindow;
}): Promise<ClaudeUndoRedoResponse> {
	try {
		if (getActiveManagedTransaction()) {
			throw new ClaudeTransactionError({
				message: "Cannot undo while a transaction is active",
				statusCode: 409,
				code: "UNDO_BLOCKED_BY_TRANSACTION",
			});
		}
		return await requestUndoFromRendererInternal({ win });
	} catch (error) {
		if (error instanceof ClaudeTransactionError) {
			throw error;
		}
		throw new ClaudeTransactionError({
			message: error instanceof Error ? error.message : "Undo failed",
			statusCode: 500,
			code: "UNDO_FAILED",
		});
	}
}

export async function redoTimeline({
	win,
}: {
	win: BrowserWindow;
}): Promise<ClaudeUndoRedoResponse> {
	try {
		if (getActiveManagedTransaction()) {
			throw new ClaudeTransactionError({
				message: "Cannot redo while a transaction is active",
				statusCode: 409,
				code: "REDO_BLOCKED_BY_TRANSACTION",
			});
		}
		return await requestRedoFromRendererInternal({ win });
	} catch (error) {
		if (error instanceof ClaudeTransactionError) {
			throw error;
		}
		throw new ClaudeTransactionError({
			message: error instanceof Error ? error.message : "Redo failed",
			statusCode: 500,
			code: "REDO_FAILED",
		});
	}
}

export async function getHistorySummary({
	win,
}: {
	win: BrowserWindow;
}): Promise<ClaudeHistorySummary> {
	try {
		return await requestHistoryFromRendererInternal({ win });
	} catch (error) {
		throw new ClaudeTransactionError({
			message: error instanceof Error ? error.message : "History request failed",
			statusCode: 500,
			code: "HISTORY_FAILED",
		});
	}
}

export function resetTransactionManagerForTests(): void {
	try {
		for (const transaction of transactionsById.values()) {
			clearManagedTransactionTimer({ transaction });
		}
		transactionsById.clear();
		transactionOrder.length = 0;
		activeTransactionId = null;
	} catch (error) {
		claudeLog.warn(HANDLER_NAME, "Failed to reset transaction manager", error);
	}
}

// CommonJS export for compatibility with existing Electron requires
module.exports = {
	beginTransaction,
	commitTransaction,
	rollbackTransaction,
	getTransactionStatus,
	getActiveTransactionStatus,
	undoTimeline,
	redoTimeline,
	getHistorySummary,
	resetTransactionManagerForTests,
	ClaudeTransactionError,
	DEFAULT_TRANSACTION_TIMEOUT_MS,
};
