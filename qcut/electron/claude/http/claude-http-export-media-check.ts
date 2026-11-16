/**
 * The check of the editor's media copies that precedes an export.
 *
 * The editor plays its own copy of each media file. Before an export it
 * reads again the files that were written over in the project folder. A
 * native export reads the folder and does not need the answer; a renderer
 * export draws from the editor's copies, and must not start while one of the
 * files it plays could not be brought up to date, or while the check gave no
 * answer at all.
 *
 * @module electron/claude/http/claude-http-export-media-check
 */
import type { ClaudeMediaRefreshResult } from "../../types/claude-media-bridge-api.js";
import { MEDIA_REFRESH_BEFORE_EXPORT_MS } from "../handlers/claude-media-deadlines.js";
import { claudeLog } from "../utils/logger.js";

export interface MediaCheckBeforeExport {
	/** Changed files the editor could not bring up to date. */
	failed: ClaudeMediaRefreshResult["failed"];
	/** Why the check gave no answer, when it gave none. */
	unanswered?: string;
}

/** What names a clip's media, in a timeline as the editor reports it. */
interface ClipOfMedia {
	sourceId?: string;
	sourceName?: string;
	mediaId?: string;
}

/** Has the editor read again the media files that changed on disk. */
export async function checkMediaBeforeExport({
	accessor,
	projectId,
}: {
	accessor: {
		requestMediaRefresh?(payload: {
			projectId: string;
			timeoutMs?: number;
		}): Promise<ClaudeMediaRefreshResult>;
	};
	projectId: string;
}): Promise<MediaCheckBeforeExport> {
	if (!accessor.requestMediaRefresh) return { failed: [] };
	try {
		const answer = await accessor.requestMediaRefresh({
			projectId,
			timeoutMs: MEDIA_REFRESH_BEFORE_EXPORT_MS,
		});
		return { failed: Array.isArray(answer?.failed) ? answer.failed : [] };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		claudeLog.warn(
			"HTTP",
			`Could not check the editor's media copies before the export: ${reason}`
		);
		return { failed: [], unanswered: reason };
	}
}

/**
 * Says why a renderer export of `tracks` would draw an old copy, or null
 * when it would not.
 *
 * Only a file that a clip of the exported tracks plays counts: a changed
 * file the timeline does not use holds no export up. A check that gave no
 * answer cannot say which files changed, so it counts whatever the timeline
 * plays.
 */
export function staleCopiesOnTimeline({
	check,
	tracks,
}: {
	check: MediaCheckBeforeExport;
	tracks: ReadonlyArray<{ elements?: readonly ClipOfMedia[] }>;
}): string | null {
	if (check.unanswered !== undefined) {
		return `the editor did not confirm that its media copies match the project folder (${check.unanswered}). It may still be reading files that changed; retry in a moment`;
	}
	const ids = new Set<string>();
	const names = new Set<string>();
	for (const track of tracks) {
		for (const clip of track.elements ?? []) {
			if (clip.sourceId) ids.add(clip.sourceId);
			if (clip.mediaId) ids.add(clip.mediaId);
			if (clip.sourceName) names.add(clip.sourceName);
		}
	}
	const played = check.failed.filter(
		(entry) => ids.has(entry.id) || names.has(entry.name)
	);
	if (played.length === 0) return null;
	return `${played.length} media file(s) on the timeline changed in the project folder and the editor could not read them again: ${played
		.map((entry) => `${entry.name} (${entry.error})`)
		.join("; ")}. Fix the files or import them again, then retry`;
}
