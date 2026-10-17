/**
 * Which clips the native export joins and which it draws as overlays, and
 * the overlays' sound.
 *
 * See `types/media-overlay-export-policy.ts` for the rule. An overlay's sound
 * goes into the mix on its own track (that track's level, pan, bus and
 * mute), like a clip on an audio track; a file without sound adds nothing.
 *
 * @module electron/claude/handlers/claude-export-handler/media-overlay-plan
 */

import type { AudioFile } from "../../../ffmpeg/types.js";
import type { ClaudeTimeline } from "../../../types/claude-api.js";
import {
	findOverlayClips,
	mediaOverlayRendererReason,
} from "../../../types/media-overlay-export-policy.js";
import { buildTimelineAudioFile } from "./timeline-audio-file.js";
import type { ExportSegment } from "./types.js";

export interface MediaOverlayPlan {
	/** Joined end to end, as before overlays existed. */
	base: ExportSegment[];
	/** Drawn over the joined picture, in the export pass for overlays. */
	overlays: ExportSegment[];
	/** The overlays' sound, as audio-track inputs of the mix. */
	overlayAudioFiles: AudioFile[];
}

/**
 * Splits `segments` (sorted by start time) into joined clips and overlays.
 * Throws, naming the reason, when the native export cannot stack them; the
 * export route sends such timelines to the renderer before reaching here.
 */
export async function planMediaOverlays({
	timeline,
	segments,
	hasAudioStream,
}: {
	timeline: ClaudeTimeline;
	segments: ExportSegment[];
	hasAudioStream: ({ mediaPath }: { mediaPath: string }) => Promise<boolean>;
}): Promise<MediaOverlayPlan> {
	const reason = mediaOverlayRendererReason({ timeline });
	if (reason) {
		throw new Error(
			`The native export cannot stack this timeline's media overlays (${reason}). Export it with --engine muxer.`
		);
	}
	const overlayClips = findOverlayClips({
		clips: segments.map((segment) => ({
			segment,
			trackOrder: segment.trackOrder,
			startTime: segment.startTime,
			endTime: segment.startTime + segment.duration,
		})),
		fps: timeline.fps,
	});
	const overlaySegments = new Set(
		[...overlayClips].map((clip) => clip.segment)
	);
	const base = segments.filter((segment) => !overlaySegments.has(segment));
	const overlays = segments.filter((segment) => overlaySegments.has(segment));

	const overlayAudioFiles: AudioFile[] = [];
	for (const segment of overlays) {
		if (segment.isImage) continue;
		const track = timeline.tracks[segment.trackOrder];
		if (!track || track.muted === true) continue;
		const element = track.elements.find(
			(candidate) => candidate.id === segment.elementId
		);
		if (!element) continue;
		if (!(await hasAudioStream({ mediaPath: segment.sourcePath }))) continue;
		const audioFile = buildTimelineAudioFile({
			element,
			trackId: segment.trackId,
			mediaPath: segment.sourcePath,
		});
		if (audioFile) overlayAudioFiles.push(audioFile);
	}
	return { base, overlays, overlayAudioFiles };
}
