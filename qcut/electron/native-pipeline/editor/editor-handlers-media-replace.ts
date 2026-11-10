/**
 * `editor:media:replace`: put a new file in the place of a media item.
 *
 * A file rendered again under the same name (a shake pass, a sound effect on
 * its third take) had no way back into the project: importing it adds a
 * second item beside the first (`name_1.ext`), and the clips go on playing
 * the old one. The only way round was to write over the project's copy on
 * disk, which the export read but the editor's thumbnails, waveforms and
 * proxies did not.
 *
 * The new file is imported, every clip that played the old item is given the
 * new one in one undo step (each as `timeline replace-media` would: its
 * place, length and settings kept, a file too short for it refused), and the
 * old item is then removed. The new item has an id of its own, so nothing the
 * editor worked out for the old file can be shown for the new one.
 *
 * @module electron/native-pipeline/editor/editor-handlers-media-replace
 */

import fs from "node:fs";
import type { ClaudeElement, ClaudeTimeline } from "../../types/claude-api.js";
import type { CLIResult, CLIRunOptions } from "../cli/cli-runner/types.js";
import { type EditorApiClient, EditorApiError } from "./editor-api-client.js";
import {
	importSource,
	readMedia,
	removeImported,
} from "./editor-handlers-replace-media.js";

interface MediaClip {
	elementId: string;
	trackId?: string;
	name?: string;
}

/** The clips of the timeline that play `mediaId`. */
function clipsPlaying({
	timeline,
	mediaId,
}: {
	timeline: ClaudeTimeline;
	mediaId: string;
}): MediaClip[] {
	return timeline.tracks.flatMap((track) =>
		track.elements
			.filter(
				(element: ClaudeElement) =>
					(element.sourceId ?? element.mediaId) === mediaId
			)
			.map((element: ClaudeElement) => ({
				elementId: element.id,
				trackId: track.id,
				name: element.name,
			}))
	);
}

async function endTransaction({
	client,
	transactionId,
	action,
}: {
	client: EditorApiClient;
	transactionId: string;
	action: "commit" | "rollback";
}): Promise<void> {
	await client.post(
		`/api/claude/transaction/${encodeURIComponent(transactionId)}/${action}`,
		{}
	);
}

/** Handle `editor:media:replace --media-id <id> --source <file>`. */
export async function mediaReplace(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const { projectId, mediaId: oldMediaId, source } = opts;
	if (!projectId) return { success: false, error: "Missing --project-id" };
	if (!oldMediaId) return { success: false, error: "Missing --media-id" };
	if (!source) return { success: false, error: "Missing --source" };
	if (!fs.existsSync(source)) {
		return { success: false, error: `File not found: ${source}` };
	}

	const project = encodeURIComponent(projectId);
	const old = await readMedia({ client, project, mediaId: oldMediaId });
	if (!old) {
		return {
			success: false,
			error: `Media ${oldMediaId} is not in project ${projectId} (see editor:media:list)`,
		};
	}
	const timelinePath = `/api/claude/timeline/${project}`;
	const clips = clipsPlaying({
		timeline: await client.get<ClaudeTimeline>(timelinePath),
		mediaId: oldMediaId,
	});

	const imported = await importSource({ client, project, source });
	if (imported.error || !imported.mediaFile) {
		return { success: false, error: imported.error ?? "Import failed" };
	}
	const newMediaId = imported.mediaFile.id;
	const media = await readMedia({ client, project, mediaId: newMediaId });
	const sourceDuration =
		typeof media?.duration === "number" && media.duration > 0
			? media.duration
			: undefined;

	// One undo step; a clip the editor refuses puts every clip back.
	const { transactionId } = await client.post<{ transactionId: string }>(
		"/api/claude/transaction/begin",
		{ label: "Replace media" }
	);
	for (const clip of clips) {
		try {
			await client.patch(
				`${timelinePath}/elements/${encodeURIComponent(clip.elementId)}`,
				{
					mediaId: newMediaId,
					...(sourceDuration ? { sourceDuration } : {}),
				}
			);
		} catch (error) {
			await endTransaction({ client, transactionId, action: "rollback" });
			const reason = error instanceof Error ? error.message : String(error);
			// A refusal (409) leaves the project as it was, so the import goes
			// too; after anything else the editor may yet act, and it stays.
			const refused =
				error instanceof EditorApiError && error.statusCode === 409;
			const cleanup = refused
				? await removeImported({ client, project, mediaId: newMediaId })
				: { removed: false };
			return {
				success: false,
				error:
					`Clip ${clip.elementId}${clip.name ? ` (${clip.name})` : ""} could not take ${imported.mediaFile.name}: ${reason}. No clip was changed` +
					(cleanup.removed
						? "."
						: `; ${imported.mediaFile.name} (${newMediaId}) is still in the project ("qcut editor:media:delete --project-id ${projectId} --media-id ${newMediaId}" removes it).`),
			};
		}
	}
	await endTransaction({ client, transactionId, action: "commit" });

	// Removing a media item removes the clips that play it, so the old one
	// goes only once the timeline is read back without any.
	const left = clipsPlaying({
		timeline: await client.get<ClaudeTimeline>(timelinePath),
		mediaId: oldMediaId,
	});
	const replaced = {
		oldMediaId,
		oldName: old.name,
		mediaId: newMediaId,
		name: imported.mediaFile.name,
		clips,
	};
	if (left.length > 0) {
		return {
			success: true,
			data: {
				...replaced,
				oldMediaRemoved: false,
				warning: `${left.length} clip(s) still play ${old.name ?? oldMediaId} (${left.map((clip) => clip.elementId).join(", ")}), so it was kept`,
			},
		};
	}
	const removal = await removeImported({
		client,
		project,
		mediaId: oldMediaId,
	});
	return {
		success: true,
		data: {
			...replaced,
			oldMediaRemoved: removal.removed,
			...(removal.removed
				? {}
				: {
						warning: `${old.name ?? oldMediaId} could not be removed${removal.reason ? ` (${removal.reason})` : ""}; "qcut editor:media:delete --project-id ${projectId} --media-id ${oldMediaId}" removes it`,
					}),
		},
	};
}
