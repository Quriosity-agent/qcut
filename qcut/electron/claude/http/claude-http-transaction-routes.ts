import type { Router } from "../utils/http-router.js";
import { HttpError } from "../utils/http-router.js";
import type {
	Transaction,
	TransactionRequest,
} from "../../types/claude-api.js";

interface ClaudeHistoryEntry {
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

interface TransactionRouteAccessor {
	beginTransaction(request?: TransactionRequest): Promise<Transaction>;
	commitTransaction(
		transactionId: string
	): Promise<{ transaction: Transaction; historyEntryAdded: boolean }>;
	rollbackTransaction(
		transactionId: string,
		reason?: string
	): Promise<{ transaction: Transaction }>;
	getTransactionStatus(transactionId: string): Promise<Transaction | null>;
	undoTimeline(): Promise<ClaudeUndoRedoResponse>;
	redoTimeline(): Promise<ClaudeUndoRedoResponse>;
	getHistorySummary(): Promise<ClaudeHistorySummary>;
}

function toHttpError({
	error,
	fallbackMessage,
}: {
	error: unknown;
	fallbackMessage: string;
}): HttpError {
	try {
		if (error instanceof HttpError) {
			return error;
		}
		if (
			error &&
			typeof error === "object" &&
			"statusCode" in error &&
			typeof (error as { statusCode: unknown }).statusCode === "number"
		) {
			return new HttpError(
				(error as { statusCode: number }).statusCode,
				error instanceof Error ? error.message : fallbackMessage
			);
		}
		return new HttpError(
			500,
			error instanceof Error ? error.message : fallbackMessage
		);
	} catch {
		return new HttpError(500, fallbackMessage);
	}
}

export function registerTransactionRoutes({
	router,
	accessor,
}: {
	router: Router;
	accessor: TransactionRouteAccessor;
}): void {
	try {
		router.post("/api/claude/transaction/begin", async (req) => {
			try {
				if (
					req.body?.label !== undefined &&
					typeof req.body.label !== "string"
				) {
					throw new HttpError(400, "Optional 'label' must be a string");
				}
				const transaction = await accessor.beginTransaction({
					label:
						typeof req.body?.label === "string" ? req.body.label : undefined,
				});
				return { transactionId: transaction.id };
			} catch (error) {
				throw toHttpError({
					error,
					fallbackMessage: "Failed to begin transaction",
				});
			}
		});

		router.post("/api/claude/transaction/:id/commit", async (req) => {
			try {
				return await accessor.commitTransaction(req.params.id);
			} catch (error) {
				throw toHttpError({
					error,
					fallbackMessage: "Failed to commit transaction",
				});
			}
		});

		router.post("/api/claude/transaction/:id/rollback", async (req) => {
			try {
				if (
					req.body?.reason !== undefined &&
					typeof req.body.reason !== "string"
				) {
					throw new HttpError(400, "Optional 'reason' must be a string");
				}
				return await accessor.rollbackTransaction(
					req.params.id,
					req.body?.reason
				);
			} catch (error) {
				throw toHttpError({
					error,
					fallbackMessage: "Failed to rollback transaction",
				});
			}
		});

		router.get("/api/claude/transaction/:id", async (req) => {
			try {
				const transaction = await accessor.getTransactionStatus(req.params.id);
				if (!transaction) {
					throw new HttpError(404, `Transaction not found: ${req.params.id}`);
				}
				return transaction;
			} catch (error) {
				throw toHttpError({
					error,
					fallbackMessage: "Failed to get transaction status",
				});
			}
		});

		router.post("/api/claude/undo", async () => {
			try {
				return await accessor.undoTimeline();
			} catch (error) {
				throw toHttpError({ error, fallbackMessage: "Undo failed" });
			}
		});

		router.post("/api/claude/redo", async () => {
			try {
				return await accessor.redoTimeline();
			} catch (error) {
				throw toHttpError({ error, fallbackMessage: "Redo failed" });
			}
		});

		router.get("/api/claude/history", async () => {
			try {
				return await accessor.getHistorySummary();
			} catch (error) {
				throw toHttpError({ error, fallbackMessage: "Failed to get history" });
			}
		});
	} catch {
		// no-op
	}
}

module.exports = {
	registerTransactionRoutes,
};
