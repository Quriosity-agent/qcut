/**
 * `editor transaction list|status|rollback`: see and end the timeline
 * transactions that commands such as `captions import` open, including one
 * only the editor window still holds (it blocks every new transaction with
 * "Nested transactions are not supported" until it is ended).
 *
 * @module electron/native-pipeline/editor/editor-handlers-transaction
 */

import type { CLIResult, CLIRunOptions } from "../cli/cli-runner/types.js";
import type { EditorApiClient } from "./editor-api-client.js";

interface TransactionListResponse {
	active: { id: string } | null;
	editor?:
		| { activeTransaction: { id: string } | null; orphaned: boolean }
		| { error: string };
}

const ACTIONS = ["list", "status", "rollback"] as const;

function transactionPath(transactionId: string): string {
	return `/api/claude/transaction/${encodeURIComponent(transactionId)}`;
}

async function transactionList(client: EditorApiClient): Promise<CLIResult> {
	const data = await client.get<TransactionListResponse>(
		"/api/claude/transaction"
	);
	const editor = data.editor;
	if (editor && "orphaned" in editor && editor.orphaned) {
		const held = editor.activeTransaction?.id;
		return {
			success: true,
			data: {
				...data,
				hint: `The editor holds ${held}, which QCut no longer tracks; it blocks new transactions. End it with: qcut editor transaction rollback --transaction-id ${held}`,
			},
		};
	}
	return { success: true, data };
}

export async function handleTransactionCommand(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const action = opts.command.split(":")[2];
	if (action === "list") return transactionList(client);
	if (action !== "status" && action !== "rollback") {
		return {
			success: false,
			error: `Unknown transaction action: ${action}. Available: ${ACTIONS.join(", ")}`,
		};
	}
	const transactionId = opts.transactionId?.trim();
	if (!transactionId) {
		return {
			success: false,
			error:
				"Missing --transaction-id (qcut editor transaction list shows the open ones)",
		};
	}
	if (action === "status") {
		const data = await client.get(transactionPath(transactionId));
		return { success: true, data };
	}
	const data = await client.post(`${transactionPath(transactionId)}/rollback`, {
		reason: "Rolled back from the CLI",
	});
	return { success: true, data };
}
