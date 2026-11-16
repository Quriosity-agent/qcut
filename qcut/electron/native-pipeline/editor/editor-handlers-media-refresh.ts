/**
 * `editor:media:refresh`: have the editor read again the media files that
 * were written over in the project folder since it copied them.
 *
 * The editor plays its own copy of each media file; the native export and
 * `media list` read the file in the project folder. The editor checks on its
 * own (when its window is looked at again, before a timeline apply and
 * before an export); this asks for the check outright and says what it did.
 *
 * @module electron/native-pipeline/editor/editor-handlers-media-refresh
 */

import type { CLIResult, CLIRunOptions } from "../cli/cli-runner/types.js";
import type { EditorApiClient } from "./editor-api-client.js";

/** Handle `editor:media:refresh --project-id <id>`. */
export async function mediaRefresh(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	const data = await client.post<{
		failed?: Array<{ name: string; error: string }>;
	}>(`/api/claude/media/${encodeURIComponent(opts.projectId)}/refresh`, {});
	const failed = data?.failed ?? [];
	if (failed.length > 0) {
		return {
			success: false,
			error: `${failed.length} changed media file(s) could not be read again, and the editor still plays its old copy of each: ${failed
				.map((entry) => `${entry.name} (${entry.error})`)
				.join("; ")}`,
			data,
		};
	}
	return { success: true, data };
}
