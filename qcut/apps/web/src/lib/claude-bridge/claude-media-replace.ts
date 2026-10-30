import { useMediaStore } from "@/stores/media/media-store";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { resolveMediaIdForBatchElement } from "./claude-media-resolve";

/** How far new media may fall short of the clip's out-point and still fit. */
const LENGTH_TOLERANCE_SECONDS = 0.001;

/** What a media clip's source changes to, and the timing that follows. */
export interface MediaReplacement {
	mediaId: string;
	name: string;
	duration: number;
	trimStart: number;
	trimEnd: number;
}

/**
 * The first setting that plays or applies a file made from the clip's
 * current media: stems, a converted voice, a cover, AI-denoised sound, a
 * cutout or mask matte, surface tracking. Kept, it would go on using the
 * old file's sound or frames.
 */
function madeFromCurrentMedia({
	element,
}: {
	element: MediaElement;
}): string | undefined {
	const audio = element.audio;
	if (audio?.separation?.enabled) return "audio.separation";
	if (audio?.voiceConversion?.enabled) return "audio.voiceConversion";
	if (audio?.cover?.enabled) return "audio.cover";
	if (audio?.denoise?.enabled && audio.denoise.processedMediaId) {
		return "audio.denoise";
	}
	if (element.customCutout?.enabled && element.customCutout.resultMaskId) {
		return "customCutout";
	}
	const masks = [element.mask, ...(element.masks ?? [])];
	if (masks.some((mask) => mask?.sourceMediaId)) return "masks";
	if (element.surfaceTrackings?.length) return "surfaceTrackings";
	return undefined;
}

/**
 * A media clip with another media item as its source (N24). It keeps its
 * track, start, length on the timeline, in-point and every setting; only the
 * source and the out trim that follows from the new length change, and the
 * in-point when `trimStart` names a new one. The new media must reach the
 * clip's out-point. `sourceDuration`, measured by the caller, stands in while
 * the editor is still reading a file it was just given.
 */
export function planMediaReplacement({
	element,
	mediaId,
	sourceDuration,
	trimStart = element.trimStart,
}: {
	element: MediaElement;
	mediaId: string;
	sourceDuration?: number;
	trimStart?: number;
}): MediaReplacement {
	const { mediaItems } = useMediaStore.getState();
	const resolvedId = resolveMediaIdForBatchElement({ element: { mediaId } });
	const media = resolvedId
		? mediaItems.find((item) => item.id === resolvedId)
		: undefined;
	if (!media) {
		throw new Error(`Media ${mediaId} is not in the project; import it first`);
	}
	if (element.compound) {
		throw new Error(
			`A ${element.compound.kind} clip has no single media to replace`
		);
	}
	const derived = madeFromCurrentMedia({ element });
	if (derived) {
		throw new Error(
			`The clip's ${derived} was made from its current media; turn it off before replacing the media`
		);
	}
	// A renamed clip keeps its name; one still named after its media follows
	// the new media, as the editor's own Replace does.
	const previous = mediaItems.find((item) => item.id === element.mediaId);
	const name =
		!previous || element.name === previous.name ? media.name : element.name;
	const span = element.duration - element.trimStart - element.trimEnd;
	if (media.type === "image") {
		return {
			mediaId: media.id,
			name,
			duration: span,
			trimStart: 0,
			trimEnd: 0,
		};
	}
	const length =
		typeof media.duration === "number" && media.duration > 0
			? media.duration
			: sourceDuration;
	if (typeof length !== "number" || !(length > 0)) {
		throw new Error(
			`The length of ${media.name} is not known yet; try again once the editor has read it`
		);
	}
	const outPoint = trimStart + span;
	if (length + LENGTH_TOLERANCE_SECONDS < outPoint) {
		throw new Error(
			`${media.name} is ${length.toFixed(3)} s long, but the clip reads it from ${trimStart.toFixed(3)} s to ${outPoint.toFixed(3)} s; pick longer media, read it from an earlier point (trimStart), or shorten the clip first`
		);
	}
	return {
		mediaId: media.id,
		name,
		duration: length,
		trimStart,
		trimEnd: Math.max(0, length - outPoint),
	};
}

/**
 * The replacement an element patch asks for with `mediaId`, or undefined when
 * it keeps its media. `trimStart` alongside it is the new in-point; the out
 * trim and length follow from the new media, so a patch that also sets them
 * is refused rather than guessed at.
 */
export function mediaReplacementFromPatch({
	element,
	track,
	changes,
}: {
	element: MediaElement;
	track: Pick<TimelineTrack, "name" | "locked">;
	changes: Record<string, unknown>;
}): MediaReplacement | undefined {
	const { mediaId, sourceDuration, trimStart } = changes;
	if (typeof mediaId !== "string" || mediaId === element.mediaId) {
		return undefined;
	}
	// The store skips edits on a locked track without saying so.
	if (track.locked) throw new Error(`Track "${track.name}" is locked`);
	const timing = ["duration", "trimEnd", "endTime"].filter(
		(key) => changes[key] !== undefined
	);
	if (timing.length > 0) {
		throw new Error(
			`Replace the media on its own: ${timing.join(", ")} follow from the new media's length`
		);
	}
	if (
		sourceDuration !== undefined &&
		(typeof sourceDuration !== "number" || !(sourceDuration > 0))
	) {
		throw new Error("sourceDuration must be a positive number of seconds");
	}
	if (
		trimStart !== undefined &&
		(typeof trimStart !== "number" ||
			!Number.isFinite(trimStart) ||
			trimStart < 0)
	) {
		throw new Error("trimStart must be a number of seconds, 0 or more");
	}
	return planMediaReplacement({ element, mediaId, sourceDuration, trimStart });
}
