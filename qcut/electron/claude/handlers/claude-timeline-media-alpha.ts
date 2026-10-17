/**
 * `timeline export` says whether each media clip's source carries alpha, from
 * the same ffprobe facts as `editor:media:info` (claude-media-probe.ts), so a
 * caller can tell a transparent overlay from an opaque clip without probing
 * the files itself. Only the media the timeline uses are probed.
 *
 * @module electron/claude/handlers/claude-timeline-media-alpha
 */

import type { ClaudeTimeline, MediaFile } from "../../types/claude-api.js";
import { withMediaProbes } from "./claude-media-probe.js";

const MEDIA_CLIP_TYPES = new Set(["media", "video"]);

/** `timeline` with `hasAlpha` on every media clip whose source was probed. */
export async function withMediaElementAlpha({
	timeline,
	mediaFiles,
	probe = withMediaProbes,
}: {
	timeline: ClaudeTimeline;
	mediaFiles: MediaFile[];
	probe?: typeof withMediaProbes;
}): Promise<ClaudeTimeline> {
	const clips = timeline.tracks.flatMap((track) =>
		track.elements.filter((element) => MEDIA_CLIP_TYPES.has(element.type))
	);
	if (clips.length === 0) return timeline;
	const ids = new Set(
		clips.flatMap((clip) => [clip.sourceId, clip.mediaId]).filter(Boolean)
	);
	const names = new Set(clips.map((clip) => clip.sourceName).filter(Boolean));
	const used = mediaFiles.filter(
		(file) =>
			file.type === "video" && (ids.has(file.id) || names.has(file.name))
	);
	if (used.length === 0) return timeline;
	const probed = await probe(used);
	const byId = new Map(probed.map((file) => [file.id, file]));
	const byName = new Map(probed.map((file) => [file.name, file]));
	return {
		...timeline,
		tracks: timeline.tracks.map((track) => ({
			...track,
			elements: track.elements.map((element) => {
				if (!MEDIA_CLIP_TYPES.has(element.type)) return element;
				const file =
					byId.get(element.sourceId ?? "") ??
					byId.get(element.mediaId ?? "") ??
					byName.get(element.sourceName ?? "");
				return file?.hasAlpha === undefined
					? element
					: { ...element, hasAlpha: file.hasAlpha };
			}),
		})),
	};
}
