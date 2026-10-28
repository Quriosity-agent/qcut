import { describe, expect, it, vi } from "vitest";
import type { CLIRunOptions } from "../native-pipeline/cli/cli-runner/types.js";
import type { EditorApiClient } from "../native-pipeline/editor/editor-api-client.js";
import { handleTransactionCommand } from "../native-pipeline/editor/editor-handlers-transaction.js";

function fakeClient(list: unknown) {
	const calls: Array<{ method: string; path: string; body?: unknown }> = [];
	const client = {
		get: vi.fn(async (path: string) => {
			calls.push({ method: "GET", path });
			return path === "/api/claude/transaction" ? list : { id: "txn_1" };
		}),
		post: vi.fn(async (path: string, body: unknown) => {
			calls.push({ method: "POST", path, body });
			return { transaction: { id: "txn_1", state: "rolledBack" } };
		}),
	} as unknown as EditorApiClient;
	return { client, calls };
}

function opts(command: string, extra: Partial<CLIRunOptions> = {}) {
	return {
		command,
		outputDir: "./output",
		json: true,
		verbose: false,
		quiet: false,
		saveIntermediates: false,
		...extra,
	} as CLIRunOptions;
}

describe("editor transaction commands", () => {
	it("list names the command that ends a transaction only the editor holds", async () => {
		const { client } = fakeClient({
			active: null,
			recent: [],
			editor: { activeTransaction: { id: "txn_orphan" }, orphaned: true },
		});
		const result = await handleTransactionCommand(
			client,
			opts("editor:transaction:list")
		);
		expect(result.success).toBe(true);
		expect((result.data as { hint: string }).hint).toContain(
			"qcut editor transaction rollback --transaction-id txn_orphan"
		);
	});

	it("list adds no hint when nothing is orphaned", async () => {
		const list = {
			active: null,
			recent: [],
			editor: { activeTransaction: null, orphaned: false },
		};
		const { client } = fakeClient(list);
		const result = await handleTransactionCommand(
			client,
			opts("editor:transaction:list")
		);
		expect(result.data).toEqual(list);
	});

	it("rollback posts to the transaction and requires its id", async () => {
		const { client, calls } = fakeClient({});
		const missing = await handleTransactionCommand(
			client,
			opts("editor:transaction:rollback")
		);
		expect(missing.success).toBe(false);
		expect(missing.error).toContain("--transaction-id");

		const result = await handleTransactionCommand(
			client,
			opts("editor:transaction:rollback", { transactionId: "txn_1" })
		);
		expect(result.success).toBe(true);
		expect(calls).toContainEqual({
			method: "POST",
			path: "/api/claude/transaction/txn_1/rollback",
			body: { reason: "Rolled back from the CLI" },
		});
	});

	it("status reads one transaction", async () => {
		const { client, calls } = fakeClient({});
		await handleTransactionCommand(
			client,
			opts("editor:transaction:status", { transactionId: "txn_1" })
		);
		expect(calls).toContainEqual({
			method: "GET",
			path: "/api/claude/transaction/txn_1",
		});
	});
});
