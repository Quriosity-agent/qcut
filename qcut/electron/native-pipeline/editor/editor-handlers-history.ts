/**
 * `editor undo|redo`: take back or redo one step of the editor's history.
 * The answer names the step (`label`) and what it changed (`changes`); a
 * step that changed nothing fails rather than printing ok over an unchanged
 * timeline (N18, 2026-10-28 trailer report).
 *
 * @module electron/native-pipeline/editor/editor-handlers-history
 */

import type { CLIResult } from "../cli/cli-runner/types.js";
import type { EditorApiClient } from "./editor-api-client.js";

interface HistoryStepResponse {
	applied?: boolean;
	undoCount?: number;
	redoCount?: number;
}

export async function handleHistoryStep({
	client,
	step,
}: {
	client: EditorApiClient;
	step: "undo" | "redo";
}): Promise<CLIResult> {
	const data = await client.post<HistoryStepResponse>(
		`/api/claude/${step}`,
		{}
	);
	if (data?.applied !== false) return { success: true, data };
	const left = step === "undo" ? data.undoCount : data.redoCount;
	return {
		success: false,
		error:
			left === 0
				? `Nothing to ${step}: the ${step} history is empty`
				: `The editor did not ${step}: a transaction is open in it`,
		data,
	};
}
