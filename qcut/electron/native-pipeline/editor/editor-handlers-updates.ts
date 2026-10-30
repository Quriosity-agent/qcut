/**
 * `editor updates status|pause|resume`: hold QCut's own updates back while a
 * project is under way (N26, 2026-10-30 trailer report: an update installed
 * itself overnight and changed how an export sounded). While paused nothing
 * downloads by itself, and a downloaded update does not install when QCut
 * quits.
 *
 * @module electron/native-pipeline/editor/editor-handlers-updates
 */

import type { CLIResult, CLIRunOptions } from "../cli/cli-runner/types.js";
import type { ClaudeUpdateStatus } from "../../types/claude-api.js";
import type { EditorApiClient } from "./editor-api-client.js";

const ACTIONS = ["status", "pause", "resume"] as const;

function hint(status: ClaudeUpdateStatus): string | undefined {
	if (!status.available) return undefined;
	if (status.paused) {
		return status.staged
			? `QCut ${status.staged} is downloaded and stays uninstalled until: qcut editor updates resume`
			: "Nothing downloads or installs until: qcut editor updates resume";
	}
	if (status.staged) {
		return `QCut ${status.staged} installs the next time QCut quits; hold it back with: qcut editor updates pause`;
	}
	return undefined;
}

export async function handleUpdatesCommand(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const action = opts.command.split(":")[2];
	if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
		return {
			success: false,
			error: `Unknown updates action: ${action}. Available: ${ACTIONS.join(", ")}`,
		};
	}
	const status =
		action === "status"
			? await client.get<ClaudeUpdateStatus>("/api/claude/updates")
			: await client.post<ClaudeUpdateStatus>(
					`/api/claude/updates/${action}`,
					{}
				);
	const next = hint(status);
	return { success: true, data: next ? { ...status, hint: next } : status };
}
