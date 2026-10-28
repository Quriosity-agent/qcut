/**
 * N7 (2026-10-28 trailer report): a `captions import` whose transaction begin
 * timed out left a transaction that nothing could end, and every later import
 * failed with "Nested transactions are not supported". These tests drive the
 * main-process handler against a scripted editor window that answers late.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => {
	const listeners = new Map<
		string,
		Set<(event: unknown, data: unknown) => void>
	>();
	return {
		listeners,
		ipcMain: {
			on: (channel: string, fn: (event: unknown, data: unknown) => void) => {
				const set = listeners.get(channel) ?? new Set();
				set.add(fn);
				listeners.set(channel, set);
			},
			removeListener: (
				channel: string,
				fn: (event: unknown, data: unknown) => void
			) => {
				listeners.get(channel)?.delete(fn);
			},
		},
		reply: (channel: string, data: unknown) => {
			for (const fn of [...(listeners.get(channel) ?? [])]) fn({}, data);
		},
	};
});

vi.mock("electron", () => ({ ipcMain: ipc.ipcMain }));
vi.mock("../claude/utils/logger.js", () => ({
	claudeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
	beginTransaction,
	commitTransaction,
	listTransactions,
	resetTransactionManagerForTests,
	rollbackTransaction,
} from "../claude/handlers/claude-transaction-handler.js";

/**
 * A stand-in for the editor's transaction bridge. Like the real window it
 * handles messages in the order they were sent; while it is busy (loading a
 * project, say) they queue up and run once it is free.
 */
class FakeEditor extends EventEmitter {
	active: { id: string; expiresAt: number } | null = null;
	/** Nothing is handled before this time; main gives up after 5 s. */
	busyUntil = 0;
	sent: Array<{ channel: string; data: Record<string, unknown> }> = [];
	window = {
		webContents: {
			send: (channel: string, data: Record<string, unknown>) => {
				this.sent.push({ channel, data });
				const wait = Math.max(0, this.busyUntil - Date.now());
				setTimeout(() => this.handle(channel, data), wait);
			},
		},
	};

	busyFor(ms: number): void {
		this.busyUntil = Date.now() + ms;
	}

	private handle(channel: string, data: Record<string, unknown>): void {
		const requestId = data.requestId;
		const respond = (result: unknown) =>
			ipc.reply(`${channel}:response`, { requestId, result });
		if (channel === "claude:transaction:begin") {
			if (this.active) {
				respond({
					success: false,
					error: `Nested transactions are not supported. Active transaction: ${this.active.id}`,
				});
				return;
			}
			this.active = {
				id: data.transactionId as string,
				expiresAt: data.expiresAt as number,
			};
			respond({ success: true });
			return;
		}
		if (
			channel === "claude:transaction:commit" ||
			channel === "claude:transaction:rollback"
		) {
			if (!this.active || this.active.id !== data.transactionId) {
				respond({ success: false, error: "No active transaction" });
				return;
			}
			this.active = null;
			respond({ success: true });
			return;
		}
		if (channel === "claude:transaction:history") {
			respond({
				undoCount: 0,
				redoCount: 0,
				entries: [],
				activeTransaction: this.active
					? {
							id: this.active.id,
							createdAt: 0,
							expiresAt: this.active.expiresAt,
						}
					: null,
			});
		}
	}
}

describe("transaction recovery when the editor answers late", () => {
	let editor: FakeEditor;
	const win = () => editor.window as never;

	beforeEach(() => {
		vi.useFakeTimers();
		resetTransactionManagerForTests();
		editor = new FakeEditor();
	});

	afterEach(() => {
		resetTransactionManagerForTests();
		vi.useRealTimers();
	});

	it("a begin that times out leaves no transaction behind in the editor", async () => {
		editor.busyFor(8000);
		const begin = beginTransaction({
			win: win(),
			request: { label: "Import" },
		});
		const settled = expect(begin).rejects.toMatchObject({
			code: "TRANSACTION_BEGIN_TIMEOUT",
			statusCode: 503,
		});
		await vi.advanceTimersByTimeAsync(5000);
		await settled;
		// Once free, the editor runs the late begin, then the discard behind it.
		await vi.advanceTimersByTimeAsync(3000);
		const discard = editor.sent.find(
			(message) =>
				message.channel === "claude:transaction:rollback" &&
				message.data.discard === true
		);
		expect(discard?.data.transactionId).toBe(editor.sent[0].data.transactionId);
		expect(editor.active).toBeNull();

		// The next import starts normally instead of "Nested transactions…".
		const next = beginTransaction({ win: win() });
		await vi.advanceTimersByTimeAsync(1);
		await expect(next).resolves.toMatchObject({ state: "active" });
	});

	it("a commit the editor answers too late stays recoverable", async () => {
		const begin = beginTransaction({ win: win() });
		await vi.advanceTimersByTimeAsync(1);
		const { id } = await begin;

		editor.busyFor(8000);
		const commit = commitTransaction({ transactionId: id });
		const failed = expect(commit).rejects.toThrow(
			"Timeout waiting for transaction commit"
		);
		await vi.advanceTimersByTimeAsync(5000);
		await failed;

		// Not stuck "finalizing": a rollback is accepted and reaches the editor,
		// which by then has run the late commit and refuses.
		const rollback = rollbackTransaction({ transactionId: id, win: win() });
		const refused = expect(rollback).rejects.toMatchObject({
			code: "TRANSACTION_ROLLBACK_REJECTED",
		});
		await vi.advanceTimersByTimeAsync(3000);
		await refused;
		// The re-armed timeout still finalizes it, freeing the next begin.
		await vi.advanceTimersByTimeAsync(31_000);
		const next = beginTransaction({ win: win() });
		await vi.advanceTimersByTimeAsync(1);
		await expect(next).resolves.toMatchObject({ state: "active" });
	});

	it("rollback ends a transaction only the editor still holds, without restoring", async () => {
		editor.active = { id: "txn_orphan", expiresAt: Date.now() + 60_000 };

		const listed = listTransactions({ win: win() });
		await vi.advanceTimersByTimeAsync(1);
		await expect(listed).resolves.toMatchObject({
			active: null,
			editor: { activeTransaction: { id: "txn_orphan" }, orphaned: true },
		});

		const blocked = beginTransaction({ win: win() });
		const rejected = expect(blocked).rejects.toThrow(
			"qcut editor transaction rollback --transaction-id txn_orphan"
		);
		await vi.advanceTimersByTimeAsync(1);
		await rejected;

		const rollback = rollbackTransaction({
			transactionId: "txn_orphan",
			win: win(),
		});
		await vi.advanceTimersByTimeAsync(1);
		await expect(rollback).resolves.toMatchObject({
			orphaned: true,
			transaction: { id: "txn_orphan", state: "rolledBack" },
		});
		const end = editor.sent.find(
			(message) => message.channel === "claude:transaction:rollback"
		);
		expect(end?.data).toMatchObject({
			transactionId: "txn_orphan",
			discard: true,
		});
		expect(editor.active).toBeNull();
	});

	it("an unknown id that the editor does not hold is still not found", async () => {
		const rollback = rollbackTransaction({
			transactionId: "txn_missing",
			win: win(),
		});
		const missing = expect(rollback).rejects.toMatchObject({
			code: "TRANSACTION_NOT_FOUND",
		});
		await vi.advanceTimersByTimeAsync(1);
		await missing;
	});
});
