/**
 * Editor pointer CLI entry: dispatches `editor:pointer:*` commands and re-exports the pointer handlers.
 *
 * @module electron/native-pipeline/cli/cli-handlers-pointer
 */

import type { EditorApiClient } from "../editor/editor-api-client.js";
import type { CLIRunOptions, CLIResult } from "./cli-runner/types.js";
import { waitForRequestedState } from "./cli-handlers-pointer-targets.js";
import {
	postTargetAction,
	handleDrag,
	handleScroll,
	handleDropFiles,
	handleHitTest,
} from "./cli-handlers-pointer-actions.js";
import { runPointerSequence } from "./cli-handlers-pointer-sequence.js";

export async function handlePointerCommand({
	client,
	options,
}: {
	client: EditorApiClient;
	options: CLIRunOptions;
}): Promise<CLIResult> {
	const action = options.command.split(":")[2];
	switch (action) {
		case "move":
		case "hover":
		case "click":
		case "double-click":
		case "right-click":
			return await postTargetAction({ client, options, action });
		case "drag":
			return await handleDrag({ client, options });
		case "sequence":
			return await runPointerSequence({ client, options });
		case "wait-for": {
			const requested = options.target ?? options.text;
			if (!requested) {
				return {
					success: false,
					error: "Pointer wait-for requires --target or --text",
				};
			}
			return await waitForRequestedState({
				client,
				value: requested,
				timeoutMs: options.timeoutMs,
				intervalMs: options.intervalMs,
				projectId: options.projectId,
			});
		}
		case "scroll":
			return await handleScroll({ client, options });
		case "hide": {
			const data = await client.post("/api/claude/pointer/hide", {});
			return { success: true, data };
		}
		case "state": {
			const data = await client.get(
				"/api/claude/pointer/state",
				typeof options.windowId === "number"
					? { windowId: String(options.windowId) }
					: undefined
			);
			return { success: true, data };
		}
		case "hit-test":
			return await handleHitTest({ client, options });
		case "drop-files":
			return await handleDropFiles({ client, options });
		default:
			return {
				success: false,
				error: `Unknown pointer action: ${action ?? ""}. Available: move, hover, click, double-click, right-click, drag, scroll, wait-for, sequence, hide, state, hit-test, drop-files`,
			};
	}
}

export {
	handleKeyboardCommand,
	handleWindowsCommand,
} from "./cli-handlers-pointer-actions.js";
export { waitForEditorUi } from "./cli-handlers-pointer-targets.js";
export { runPointerSequence } from "./cli-handlers-pointer-sequence.js";
