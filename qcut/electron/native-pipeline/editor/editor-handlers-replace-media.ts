/**
 * `editor:timeline:replace-media`: give a media clip another file, or another
 * media item of the project, in one step (N24, 2026-10-30 trailer report).
 *
 * The clip keeps its track, start, length on the timeline, in-point and every
 * setting; only its source and the out trim that follows from the new
 * length change (`--trim-start` names a new in-point). Media too short to
 * reach the clip's out-point is refused and the clip stays as it was. The
 * command reads the clip back, so its answer is what the timeline now holds.
 *
 * @module electron/native-pipeline/editor/editor-handlers-replace-media
 */

import fs from "node:fs";
import type { CLIResult, CLIRunOptions } from "../cli/cli-runner/types.js";
import type {
	BatchImportResult,
	ClaudeElement,
	ClaudeTimeline,
} from "../../types/claude-api.js";
import { type EditorApiClient, EditorApiError } from "./editor-api-client.js";

/** The clip as the timeline holds it after the replacement. */
function describeClip({
	timeline,
	elementId,
}: {
	timeline: ClaudeTimeline;
	elementId: string;
}): Record<string, unknown> | undefined {
	for (const track of timeline.tracks) {
		const clip = track.elements.find(
			(element: ClaudeElement) => element.id === elementId
		);
		if (!clip) continue;
		return {
			elementId: clip.id,
			trackId: track.id,
			name: clip.name,
			mediaId: clip.sourceId,
			sourceName: clip.sourceName,
			startTime: clip.startTime,
			endTime: clip.endTime,
			trimStart: clip.trimStart,
			trimEnd: clip.trimEnd,
		};
	}
	return undefined;
}

/** Copy `source` into the project and wait for the editor to load it. */
async function importSource({
	client,
	project,
	source,
}: {
	client: EditorApiClient;
	project: string;
	source: string;
}): Promise<{ mediaFile?: BatchImportResult["mediaFile"]; error?: string }> {
	const [result] = await client.post<BatchImportResult[]>(
		`/api/claude/media/${project}/batch-import`,
		{ items: [{ path: source }] }
	);
	if (!result?.success || !result.mediaFile) {
		return {
			error: `Could not import ${source}: ${result?.error ?? "unknown error"}`,
		};
	}
	if (result.editorReady === false) {
		const { id, name } = result.mediaFile;
		return {
			error: `${name} was imported as ${id}, but the editor has not loaded it yet (${result.warning ?? "still loading"}); run again with --media-id ${id}`,
		};
	}
	return { mediaFile: result.mediaFile };
}

/** Milliseconds before a second attempt at taking back an imported file. */
const CLEANUP_RETRY_DELAY_MS = 250;

/**
 * Take back a file this command imported, and say whether it went.
 *
 * The delete asks the editor to drop the item before it unlinks the file, so
 * a renderer that refuses — which a save still writing that item's storage
 * entry can cause — leaves both the library entry and the copy in the
 * project's media folder. The route also answers `false` with a 200 when it
 * cannot find the media. A single fire-and-forget attempt discarded both
 * outcomes, so the command reported a clean refusal while its import stayed
 * behind, twice in six attempts (N30). Retried once, because that race is
 * transient.
 */
async function removeImported({
	client,
	project,
	mediaId,
}: {
	client: EditorApiClient;
	project: string;
	mediaId: string;
}): Promise<{ removed: boolean; reason?: string }> {
	let reason: string | undefined;
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		if (attempt > 1) {
			await new Promise((resolve) => {
				setTimeout(resolve, CLEANUP_RETRY_DELAY_MS);
			});
		}
		try {
			const answer = await client.delete<unknown>(
				`/api/claude/media/${project}/${encodeURIComponent(mediaId)}`
			);
			if (answer !== false) return { removed: true };
			reason = "the editor did not find it";
		} catch (error) {
			reason = error instanceof Error ? error.message : String(error);
		}
	}
	return { removed: false, reason };
}

/** Names a file the command imported and did not take back, and how to. */
function leftoverNote({
	imported,
	mediaId,
	projectId,
	reason,
}: {
	imported: BatchImportResult["mediaFile"];
	mediaId: string;
	projectId: string;
	reason?: string;
}): string {
	const name = imported?.name ?? mediaId;
	return (
		`; the file this command imported is still in the project: ${name} (${mediaId})` +
		` — remove it with "qcut editor:media:delete --project-id ${projectId} --media-id ${mediaId}"` +
		(reason ? ` (cleanup failed: ${reason})` : "")
	);
}

/** Handle `editor:timeline:replace-media`. */
export async function timelineReplaceMedia(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const { projectId, elementId, source, trimStart } = opts;
	if (!projectId) return { success: false, error: "Missing --project-id" };
	if (!elementId) return { success: false, error: "Missing --element-id" };
	if (Boolean(source) === Boolean(opts.mediaId)) {
		return {
			success: false,
			error: "Give either --source <file> or --media-id <id>",
		};
	}
	if (
		trimStart !== undefined &&
		!(Number.isFinite(trimStart) && trimStart >= 0)
	) {
		return {
			success: false,
			error: "--trim-start must be a number of seconds, 0 or more",
		};
	}
	if (source && !fs.existsSync(source)) {
		return { success: false, error: `File not found: ${source}` };
	}

	const project = encodeURIComponent(projectId);
	let mediaId = opts.mediaId;
	let imported: BatchImportResult["mediaFile"];
	if (source) {
		const result = await importSource({ client, project, source });
		if (result.error) return { success: false, error: result.error };
		imported = result.mediaFile;
		mediaId = imported?.id;
	}
	if (!mediaId) return { success: false, error: "No media to replace with" };

	// The editor may not know a file's length yet right after an import; the
	// probed length stands in until it does.
	const media = await client
		.get<{ duration?: number } | null>(
			`/api/claude/media/${project}/${encodeURIComponent(mediaId)}`
		)
		.catch(() => null);
	const sourceDuration =
		typeof media?.duration === "number" && media.duration > 0
			? media.duration
			: undefined;

	let patch: { ignoredFields?: string[] };
	try {
		patch = await client.patch<{ ignoredFields?: string[] }>(
			`/api/claude/timeline/${project}/elements/${encodeURIComponent(elementId)}`,
			{
				mediaId,
				...(sourceDuration ? { sourceDuration } : {}),
				...(trimStart !== undefined ? { trimStart } : {}),
			}
		);
	} catch (error) {
		// A refused swap (409) leaves the project as it was: without the file
		// this command imported for it. After a timeout the editor may still
		// make the swap, so the file stays.
		if (
			imported &&
			error instanceof EditorApiError &&
			error.statusCode === 409
		) {
			const cleanup = await removeImported({ client, project, mediaId });
			if (!cleanup.removed) {
				throw new EditorApiError(
					error.message +
						leftoverNote({
							imported,
							mediaId,
							projectId,
							reason: cleanup.reason,
						}),
					error.statusCode,
					error.apiError
				);
			}
		}
		throw error;
	}
	const timeline = await client.get<ClaudeTimeline>(
		`/api/claude/timeline/${project}`
	);
	const clip = describeClip({ timeline, elementId });
	if (clip?.mediaId !== mediaId) {
		// The patch was accepted, so the editor may yet apply it and the clip
		// would then need this media: name the import rather than delete it.
		return {
			success: false,
			error:
				`The editor answered, but clip ${elementId} still plays ${String(clip?.sourceName ?? "its old media")}` +
				(imported ? leftoverNote({ imported, mediaId, projectId }) : ""),
		};
	}
	return {
		success: true,
		data: {
			replaced: true,
			clip,
			...(imported ? { imported } : {}),
			...(patch?.ignoredFields?.length
				? { ignoredFields: patch.ignoredFields }
				: {}),
		},
	};
}
