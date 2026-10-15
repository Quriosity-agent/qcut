/**
 * `editor:media:batch-import --append-to-track <trackId>`: import files and
 * lay them end to end at the end of a track in one command.
 *
 * Each clip is added with `startTime: "end"` and no duration, so the editor
 * places it after the previous one and gives it its file's own length. The
 * caller never probes files or adds up floating-point start times.
 *
 * @module electron/native-pipeline/editor/editor-media-append
 */

import type { EditorApiClient } from "./editor-api-client.js";
import type {
	BatchImportResult,
	ClaudeBatchAddResponse,
} from "../../types/claude-api.js";

export interface AppendImportedMediaResult {
	imported: BatchImportResult[];
	appended: ClaudeBatchAddResponse | null;
	/** Imported files that were not placed, and why. */
	skipped: Array<{ index: number; name: string; reason: string }>;
}

/** Append every successfully imported video or audio file to `trackId`. */
export async function appendImportedMedia({
	client,
	projectId,
	trackId,
	imported,
}: {
	client: EditorApiClient;
	projectId: string;
	trackId: string;
	imported: unknown;
}): Promise<AppendImportedMediaResult> {
	const results = Array.isArray(imported)
		? (imported as BatchImportResult[])
		: [];
	const skipped: AppendImportedMediaResult["skipped"] = [];
	const elements: Array<Record<string, unknown>> = [];
	for (const result of results) {
		const media = result.mediaFile;
		if (!result.success || !media) continue;
		if (media.type === "image") {
			// A still has no length of its own to lay end to end with.
			skipped.push({
				index: result.index,
				name: media.name,
				reason: "a still image has no length; add it with a duration",
			});
			continue;
		}
		elements.push({
			type: "media",
			trackId,
			sourceId: media.id,
			sourceName: media.name,
			startTime: "end",
		});
	}

	const appended =
		elements.length === 0
			? null
			: await client.post<ClaudeBatchAddResponse>(
					`/api/claude/timeline/${encodeURIComponent(projectId)}/elements/batch`,
					{ elements }
				);
	return { imported: results, appended, skipped };
}
