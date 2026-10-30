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
import type { EditorApiClient } from "./editor-api-client.js";

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
		// A refused swap leaves the project as it was: without the file this
		// command imported for it.
		if (imported) {
			await client
				.delete(`/api/claude/media/${project}/${encodeURIComponent(mediaId)}`)
				.catch(() => undefined);
		}
		throw error;
	}
	const timeline = await client.get<ClaudeTimeline>(
		`/api/claude/timeline/${project}`
	);
	const clip = describeClip({ timeline, elementId });
	if (clip?.mediaId !== mediaId) {
		return {
			success: false,
			error: `The editor answered, but clip ${elementId} still plays ${String(clip?.sourceName ?? "its old media")}`,
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
