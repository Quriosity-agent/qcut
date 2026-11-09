/**
 * `editor:timeline:replace-media`: give a media clip another file, or another
 * media item of the project, in one step (N24, 2026-10-30 trailer report).
 *
 * The clip keeps its track, start, length on the timeline, in-point and every
 * setting; only its source and the out trim that follows from the new
 * length change (`--trim-start` names a new in-point). Media too short to
 * reach the clip's out-point is refused and the clip stays as it was. The
 * command reads the clip back, so its answer is what the timeline now holds.
 * With `--match-loudness` the clip's gain also moves by the difference in
 * loudness between the two files (editor-replace-media-loudness.ts).
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
import {
	type ClipGainChange,
	clipSourceSeconds,
	matchedClipGain,
	measureStretchLoudness,
} from "./editor-replace-media-loudness.js";

/** The clip and the id of its track. */
function findClip({
	timeline,
	elementId,
}: {
	timeline: ClaudeTimeline;
	elementId: string;
}): { clip: ClaudeElement; trackId?: string } | undefined {
	for (const track of timeline.tracks) {
		const clip = track.elements.find(
			(element: ClaudeElement) => element.id === elementId
		);
		if (clip) return { clip, trackId: track.id };
	}
	return undefined;
}

/** The clip as the timeline holds it after the replacement. */
function describeClip({
	timeline,
	elementId,
}: {
	timeline: ClaudeTimeline;
	elementId: string;
}): Record<string, unknown> | undefined {
	const found = findClip({ timeline, elementId });
	if (!found) return undefined;
	const { clip, trackId } = found;
	return {
		elementId: clip.id,
		trackId,
		name: clip.name,
		mediaId: clip.sourceId,
		sourceName: clip.sourceName,
		startTime: clip.startTime,
		endTime: clip.endTime,
		trimStart: clip.trimStart,
		trimEnd: clip.trimEnd,
	};
}

/** A media item's file and length, as the editor knows them. */
async function readMedia({
	client,
	project,
	mediaId,
}: {
	client: EditorApiClient;
	project: string;
	mediaId: string;
}): Promise<{ duration?: number; path?: string; name?: string } | null> {
	return client
		.get<{ duration?: number; path?: string; name?: string } | null>(
			`/api/claude/media/${project}/${encodeURIComponent(mediaId)}`
		)
		.catch(() => null);
}

/** The clip before the swap and how loud its file plays over the clip. */
interface MeasuredClip {
	clip: ClaudeElement;
	lufs: number;
	sourceSeconds: number;
}

/** Reads the clip and measures the stretch of its current file it plays. */
async function measureCurrentClip({
	client,
	project,
	elementId,
}: {
	client: EditorApiClient;
	project: string;
	elementId: string;
}): Promise<MeasuredClip | { error: string }> {
	const timeline = await client.get<ClaudeTimeline>(
		`/api/claude/timeline/${project}`
	);
	const clip = findClip({ timeline, elementId })?.clip;
	if (!clip) return { error: `Clip ${elementId} is not on the timeline` };
	const mediaId = clip.sourceId ?? clip.mediaId;
	const media = mediaId ? await readMedia({ client, project, mediaId }) : null;
	if (!media?.path) {
		return {
			error: `--match-loudness: the editor did not say which file clip ${elementId} plays`,
		};
	}
	const sourceSeconds = clipSourceSeconds({ clip });
	const lufs = await measureStretchLoudness({
		stretch: {
			path: media.path,
			start: clip.trimStart ?? 0,
			duration: sourceSeconds,
		},
	});
	if (lufs === null) {
		return {
			error: `--match-loudness: clip ${elementId} has no sound to match (${media.name ?? media.path} is silent over the clip); replace it without --match-loudness`,
		};
	}
	return { clip, lufs, sourceSeconds };
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
 * project's media folder. A single fire-and-forget attempt discarded that, so
 * the command reported a clean refusal while its import stayed behind, twice
 * in six attempts (N30). Retried once, because that race is transient.
 *
 * A `false` body is not a refusal: the route answers it when its lookup finds
 * no media, before anything is removed. That is usually nothing to clean up,
 * but the lookup also swallows an unreadable directory, so it can mean it
 * could not look — reported as unconfirmed rather than as removed.
 */
async function removeImported({
	client,
	project,
	mediaId,
}: {
	client: EditorApiClient;
	project: string;
	mediaId: string;
}): Promise<{ removed: boolean; absent?: boolean; reason?: string }> {
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
			// Nothing was removed and nothing was looked at twice: retrying a
			// lookup that found nothing would not change the answer.
			if (answer === false) return { removed: false, absent: true };
			return { removed: true };
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
	absent,
}: {
	imported: BatchImportResult["mediaFile"];
	mediaId: string;
	projectId: string;
	reason?: string;
	/** The editor's lookup found no such media, so this is unconfirmed. */
	absent?: boolean;
}): string {
	const name = imported?.name ?? mediaId;
	const removal = ` — "qcut editor:media:delete --project-id ${projectId} --media-id ${mediaId}" removes it`;
	if (absent) {
		return (
			"; the editor found no media to remove for the file this command" +
			` imported, ${name} (${mediaId}), moments after importing it, so check` +
			` the project's media folder${removal}`
		);
	}
	return (
		`; the file this command imported is still in the project: ${name} (${mediaId})` +
		removal +
		(reason ? ` (cleanup failed: ${reason})` : "")
	);
}

/** Refuses the swap, taking back the file this command imported for it. */
async function refuseAfterImport({
	client,
	project,
	projectId,
	mediaId,
	imported,
	message,
}: {
	client: EditorApiClient;
	project: string;
	projectId: string;
	mediaId: string;
	imported: BatchImportResult["mediaFile"];
	message: string;
}): Promise<CLIResult> {
	if (!imported) return { success: false, error: message };
	const cleanup = await removeImported({ client, project, mediaId });
	return {
		success: false,
		error: cleanup.removed
			? message
			: message +
				leftoverNote({
					imported,
					mediaId,
					projectId,
					reason: cleanup.reason,
					absent: cleanup.absent,
				}),
	};
}

/** The new file over the stretch the clip will play, and the gain to match. */
async function matchReplacementLoudness({
	current,
	media,
	start,
}: {
	current: MeasuredClip;
	media: { path?: string; name?: string } | null;
	start: number;
}): Promise<{ lufs: number; change: ClipGainChange } | { error: string }> {
	if (!media?.path) {
		return {
			error: "--match-loudness: the editor did not say where the new file is",
		};
	}
	// A measurement that fails (ffprobe or ffmpeg refusing the file, a
	// timeout) is a refusal like any other, so the import is taken back.
	let lufs: number | null;
	try {
		lufs = await measureStretchLoudness({
			stretch: { path: media.path, start, duration: current.sourceSeconds },
		});
	} catch (error) {
		return {
			error: `--match-loudness: could not measure ${media.name ?? media.path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	if (lufs === null) {
		return {
			error: `--match-loudness: ${media.name ?? media.path} has no sound over the stretch the clip would play; replace it without --match-loudness`,
		};
	}
	return {
		lufs,
		change: matchedClipGain({
			clip: current.clip,
			differenceDb: current.lufs - lufs,
		}),
	};
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
	// Measured before anything is imported, so a refusal leaves nothing behind.
	const current = opts.matchLoudness
		? await measureCurrentClip({ client, project, elementId })
		: undefined;
	if (current && "error" in current) {
		return { success: false, error: current.error };
	}
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
	const media = await readMedia({ client, project, mediaId });
	const sourceDuration =
		typeof media?.duration === "number" && media.duration > 0
			? media.duration
			: undefined;

	const matched = current
		? await matchReplacementLoudness({
				current,
				media,
				start: trimStart ?? current.clip.trimStart ?? 0,
			})
		: undefined;
	if (matched && "error" in matched) {
		return refuseAfterImport({
			client,
			project,
			projectId,
			mediaId,
			imported,
			message: matched.error,
		});
	}

	let patch: { ignoredFields?: string[] };
	try {
		patch = await client.patch<{ ignoredFields?: string[] }>(
			`/api/claude/timeline/${project}/elements/${encodeURIComponent(elementId)}`,
			{
				mediaId,
				...(sourceDuration ? { sourceDuration } : {}),
				...(trimStart !== undefined ? { trimStart } : {}),
				...(matched ? { audio: matched.change.audio } : {}),
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
							absent: cleanup.absent,
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
			...(current && matched
				? {
						loudness: {
							previousLufs: current.lufs,
							replacementLufs: matched.lufs,
							gainChangeDb: matched.change.appliedDb,
							volumeDb: matched.change.audio.volumeDb,
							...(matched.change.clamped ? { clamped: true } : {}),
						},
					}
				: {}),
			...(imported ? { imported } : {}),
			...(patch?.ignoredFields?.length
				? { ignoredFields: patch.ignoredFields }
				: {}),
		},
	};
}
