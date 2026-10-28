import type { BrowserWindow } from "electron";
import { generateId } from "../utils/helpers.js";
import { claudeLog } from "../utils/logger.js";
import {
	TRANSACTION_STATE,
	type Transaction,
	type TransactionList,
	type TransactionRequest,
} from "../../types/claude-api.js";
import {
	type ClaudeHistorySummary,
	type ClaudeUndoRedoResponse,
	RENDERER_REQUEST_TIMEOUT_MS,
	type RendererTransactionResult,
	type RendererTransactionSummary,
	discardAbandonedBegin,
	requestBeginFromRenderer,
	requestCommitFromRenderer,
	requestHistoryFromRenderer,
	requestRedoFromRenderer,
	requestRollbackFromRenderer,
	requestUndoFromRenderer,
} from "./claude-transaction-renderer.js";

export type {
	ClaudeHistoryEntry,
	ClaudeHistorySummary,
	ClaudeUndoRedoResponse,
	RendererTransactionSummary,
} from "./claude-transaction-renderer.js";

const HANDLER_NAME = "Transaction";
export const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000;
const MAX_STORED_TRANSACTIONS = 200;
/** How many finished transactions `listTransactions` reports. */
const LISTED_RECENT_TRANSACTIONS = 20;

type ManagedTransaction = Transaction & {
	timeoutMs: number;
	timer: NodeJS.Timeout | null;
	window: BrowserWindow;
	isFinalizing: boolean;
};

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

function normalizeTimeoutMs({ timeoutMs }: { timeoutMs?: number }): number {
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
	if (
		activeTransactionId !== transactionId ||
		transaction.state !== TRANSACTION_STATE.active
	) {
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
		claudeLog.error(
			HANDLER_NAME,
			"Failed to schedule transaction timeout",
			error
		);
	}
}

/** Removes a transaction whose begin never completed from the registry. */
function forgetTransaction({ transactionId }: { transactionId: string }): void {
	transactionsById.delete(transactionId);
	const index = transactionOrder.lastIndexOf(transactionId);
	if (index >= 0) {
		transactionOrder.splice(index, 1);
	}
	if (activeTransactionId === transactionId) {
		activeTransactionId = null;
	}
}

/** The editor holds a transaction this process does not know: say how to end it. */
function beginRejectionMessage({ error }: { error?: string }): string {
	const message = error || "Renderer rejected transaction begin";
	const held = /Active transaction: (\S+)/.exec(message)?.[1];
	if (!held || getManagedTransaction({ transactionId: held })) return message;
	return `${message}. QCut no longer tracks that transaction; end it with \`qcut editor transaction rollback --transaction-id ${held}\` (nothing is restored), or wait: it ends on its own once it expires.`;
}

/**
 * Runs a commit or rollback request; when the editor never answers, the
 * transaction goes back to active with its timeout re-armed, so a retry,
 * a rollback or the timeout can still end it instead of it staying
 * "finalizing" (and blocking every later transaction) forever.
 */
async function withRecoverableFinalize<T>({
	transaction,
	request,
}: {
	transaction: ManagedTransaction;
	request: () => Promise<T>;
}): Promise<T> {
	try {
		return await request();
	} catch (error) {
		transaction.isFinalizing = false;
		scheduleTransactionTimeout({ transaction });
		throw error;
	}
}

/**
 * A transaction the editor window still holds but this process does not
 * (its begin timed out, or the app predates the discard on timeout): drop it
 * in the window without restoring, since no caller ever edited under it and
 * restoring would undo everything done since it opened. Null when the window
 * holds a different one or none.
 */
async function discardOrphanedTransaction({
	win,
	transactionId,
	reason,
}: {
	win: BrowserWindow;
	transactionId: string;
	reason?: string;
}): Promise<{ transaction: Transaction; orphaned: true } | null> {
	const history = await requestHistoryFromRenderer({ win });
	const held = history.activeTransaction;
	if (!held || held.id !== transactionId) return null;
	const result = await requestRollbackFromRenderer({
		win,
		transactionId,
		reason: reason ?? "Rolled back by request",
		discard: true,
	});
	if (!result.success) {
		throw new ClaudeTransactionError({
			message: result.error || "The editor did not end the transaction",
			statusCode: 409,
			code: "TRANSACTION_ROLLBACK_REJECTED",
		});
	}
	claudeLog.warn(
		HANDLER_NAME,
		`Discarded orphaned transaction ${transactionId} held by the editor`
	);
	const now = Date.now();
	return {
		transaction: {
			id: held.id,
			label: held.label,
			state: TRANSACTION_STATE.rolledBack,
			createdAt: held.createdAt,
			updatedAt: now,
			expiresAt: held.expiresAt,
			error:
				"Discarded: QCut no longer tracked this transaction; the timeline was left as it is",
		},
		orphaned: true,
	};
}

/**
 * Every transaction this process knows (the open one first, then the most
 * recent), plus the one the editor window holds, which is `orphaned` when
 * this process does not know it — the state `editor transaction rollback`
 * can end.
 */
export async function listTransactions({
	win,
}: {
	win?: BrowserWindow;
} = {}): Promise<TransactionList> {
	const active = getActiveTransactionStatus();
	const recent = [...transactionOrder]
		.reverse()
		.filter((id) => id !== active?.id)
		.slice(0, LISTED_RECENT_TRANSACTIONS)
		.map((id) => transactionsById.get(id))
		.filter((transaction): transaction is ManagedTransaction =>
			Boolean(transaction)
		)
		.map((transaction) => cloneTransaction({ transaction }));
	if (!win) return { active, recent };
	try {
		const history = await requestHistoryFromRenderer({ win });
		const held: RendererTransactionSummary | null =
			history.activeTransaction ?? null;
		return {
			active,
			recent,
			editor: {
				activeTransaction: held,
				orphaned: Boolean(held && held.id !== active?.id),
			},
		};
	} catch (error) {
		return {
			active,
			recent,
			editor: {
				error: error instanceof Error ? error.message : String(error),
			},
		};
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
		const label =
			typeof request?.label === "string"
				? request.label.trim() || undefined
				: undefined;

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
			forgetTransaction({ transactionId });
			// The editor answers in order once it is free, so a begin it has not
			// answered yet still runs later and would hold the timeline forever
			// (nothing tracks it any more). The discard queued behind it ends it.
			discardAbandonedBegin({ win, transactionId });
			throw new ClaudeTransactionError({
				message: `${error instanceof Error ? error.message : "Transaction begin failed"}: the editor did not answer within ${RENDERER_REQUEST_TIMEOUT_MS / 1000}s (it may still be loading a project). Nothing was changed; retry once it is ready.`,
				statusCode: 503,
				code: "TRANSACTION_BEGIN_TIMEOUT",
			});
		}

		if (!beginResult.success) {
			forgetTransaction({ transactionId });
			throw new ClaudeTransactionError({
				message: beginRejectionMessage({ error: beginResult.error }),
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
			message:
				error instanceof Error ? error.message : "Failed to begin transaction",
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

		const result = await withRecoverableFinalize({
			transaction,
			request: () =>
				requestCommitFromRenderer({
					win: transaction.window,
					transactionId,
					label: transaction.label,
				}),
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
			message:
				error instanceof Error ? error.message : "Failed to commit transaction",
			statusCode: 500,
			code: "TRANSACTION_COMMIT_FAILED",
		});
	}
}

export async function rollbackTransaction({
	transactionId,
	reason,
	win,
}: {
	transactionId: string;
	reason?: string;
	/** The editor window, to end a transaction only it still holds. */
	win?: BrowserWindow;
}): Promise<{ transaction: Transaction; orphaned?: boolean }> {
	try {
		if (win && activeTransactionId !== transactionId) {
			const orphan = await discardOrphanedTransaction({
				win,
				transactionId,
				reason: getRollbackReasonText({ reason }),
			});
			if (orphan) return orphan;
		}
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

		const result = await withRecoverableFinalize({
			transaction,
			request: () =>
				requestRollbackFromRenderer({
					win: transaction.window,
					transactionId,
					reason: getRollbackReasonText({ reason }),
				}),
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
			message:
				error instanceof Error
					? error.message
					: "Failed to rollback transaction",
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
		return await requestUndoFromRenderer({ win });
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
		return await requestRedoFromRenderer({ win });
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
		return await requestHistoryFromRenderer({ win });
	} catch (error) {
		throw new ClaudeTransactionError({
			message:
				error instanceof Error ? error.message : "History request failed",
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
	listTransactions,
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
