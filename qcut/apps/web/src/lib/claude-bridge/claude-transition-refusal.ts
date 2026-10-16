import { getTimelineElementDuration } from "@/lib/timeline";
import {
	CLIP_TRANSITION_TYPES,
	clampClipTransitionDuration,
	isClipTransitionType,
	type MediaElement,
	type TimelineTrack,
} from "@/types/timeline";

/** One frame at 30 fps, the seam tolerance editor-core's resolver uses. */
const SEAM_TOLERANCE_SECONDS = 1 / 30;

/**
 * Why the timeline store refused a transition between two elements: the same
 * checks `addTransition` runs, each answered with the clip and the number that
 * failed, instead of one sentence that covers every cause.
 */
export function describeTransitionRefusal({
	track,
	fromElementId,
	toElementId,
	type,
	videoMediaIds,
	mediaTypeOf,
}: {
	track: TimelineTrack | undefined;
	fromElementId: string;
	toElementId: string;
	type: string;
	videoMediaIds: ReadonlySet<string>;
	/** The media library type of a media id; undefined when it is not there. */
	mediaTypeOf: (mediaId: string) => string | undefined;
}): string {
	if (!track) return "the track was not found";
	if (track.type !== "media") {
		return `track "${track.name}" is a ${track.type} track; transitions need a media track`;
	}
	if (track.locked) return `track "${track.name}" is locked`;
	if (!isClipTransitionType({ value: type })) {
		return `unsupported transition type "${type}"; expected one of ${CLIP_TRANSITION_TYPES.join(", ")}`;
	}
	const ends: Array<[string, string]> = [
		["from", fromElementId],
		["to", toElementId],
	];
	const clips: MediaElement[] = [];
	for (const [role, id] of ends) {
		const element = track.elements.find((item) => item.id === id);
		if (!element)
			return `${role} element ${id} is not on track "${track.name}"`;
		if (element.type !== "media") {
			return `${role} element "${element.name}" is a ${element.type} element, not a video clip`;
		}
		if (!videoMediaIds.has(element.mediaId)) {
			const mediaType = mediaTypeOf(element.mediaId);
			return `${role} element "${element.name}" is not a video clip: its media is ${
				mediaType
					? `a${mediaType === "audio" || mediaType === "image" ? "n" : ""} ${mediaType}`
					: "missing from the media library"
			}`;
		}
		clips.push(element);
	}
	const [from, to] = clips;
	const ordered = track.elements
		.filter((item): item is MediaElement => item.type === "media")
		.sort(
			(left, right) =>
				left.startTime - right.startTime || left.id.localeCompare(right.id)
		);
	const fromIndex = ordered.findIndex((item) => item.id === from.id);
	const toIndex = ordered.findIndex((item) => item.id === to.id);
	if (toIndex < fromIndex) {
		return `"${to.name}" starts before "${from.name}"; swap the from and to elements`;
	}
	if (toIndex !== fromIndex + 1) {
		const between = ordered
			.slice(fromIndex + 1, toIndex)
			.map((item) => `"${item.name}"`);
		return `"${from.name}" and "${to.name}" are not consecutive: ${between.join(", ")} ${between.length === 1 ? "lies" : "lie"} between them`;
	}
	const fromDuration = getTimelineElementDuration({ element: from });
	const toDuration = getTimelineElementDuration({ element: to });
	const fromEnd = from.startTime + fromDuration;
	const gap = to.startTime - fromEnd;
	if (Math.abs(gap) > SEAM_TOLERANCE_SECONDS) {
		return `"${from.name}" ends at ${fromEnd.toFixed(3)} s but "${to.name}" starts at ${to.startTime.toFixed(3)} s (${gap > 0 ? "gap" : "overlap"} of ${Math.abs(gap).toFixed(3)} s); the clips must be adjacent`;
	}
	const room = 2 * Math.min(fromDuration, toDuration);
	if (
		clampClipTransitionDuration({ duration: room, maxDuration: room }) === null
	) {
		return `the shorter of "${from.name}" and "${to.name}" leaves no room for a transition`;
	}
	return "neighbouring transitions leave no room at this cut";
}
