/**
 * Export policy for media clips stacked over other media clips.
 *
 * A media clip that plays while a clip on a lower media track plays too is
 * drawn over it, the way the preview stacks tracks: it is an overlay. The
 * native export joins the other clips end to end and then composites the
 * overlays over that picture, lowest track first. A clip counts as an overlay
 * only when it overlaps a lower clip by more than half a frame, so clips on
 * different tracks that take turns still join as before.
 *
 * Every overlay sits above every joined clip it overlaps (a joined clip has
 * no overlapping clip below it), so that order reproduces the stack. What the
 * native export cannot stack — a transition into or out of an overlay, neural
 * frame interpolation on one, or a text, sticker, adjustment or effect layer
 * under one — makes the timeline a renderer export instead of a wrong one.
 */

export interface StackedClip {
	/** UI order, top to bottom: a higher value is a lower track. */
	trackOrder: number;
	startTime: number;
	endTime: number;
}

const MEDIA_CLIP_TYPES = new Set(["media", "video", "image"]);

function overlapSeconds(left: StackedClip, right: StackedClip): number {
	return (
		Math.min(left.endTime, right.endTime) -
		Math.max(left.startTime, right.startTime)
	);
}

/** Half a frame: shorter overlaps are cut-point noise, not a stack. */
export function stackToleranceSeconds({ fps }: { fps: number }): number {
	return 0.5 / Math.max(1, Number.isFinite(fps) ? fps : 30);
}

/** The clips that overlap a clip on a lower track. */
export function findOverlayClips<Clip extends StackedClip>({
	clips,
	fps,
}: {
	clips: Clip[];
	fps: number;
}): Set<Clip> {
	const tolerance = stackToleranceSeconds({ fps });
	const overlays = new Set<Clip>();
	for (const clip of clips) {
		if (
			clips.some(
				(other) =>
					other.trackOrder > clip.trackOrder &&
					overlapSeconds(clip, other) > tolerance
			)
		) {
			overlays.add(clip);
		}
	}
	return overlays;
}

interface OverlayPolicyElement {
	id?: string;
	type?: string;
	hidden?: boolean;
	startTime: number;
	endTime: number;
	frameInterpolation?: unknown;
}

interface OverlayPolicyTimeline {
	fps?: number;
	tracks: Array<{
		type?: string;
		hidden?: boolean;
		elements: OverlayPolicyElement[];
		transitions?: Array<{ fromElementId: string; toElementId: string }> | null;
	}>;
}

interface TimelineClip extends StackedClip {
	element: OverlayPolicyElement;
}

/** The visible media clips of `timeline`, with their track order. */
export function timelineMediaClips({
	timeline,
}: {
	timeline: OverlayPolicyTimeline;
}): TimelineClip[] {
	const clips: TimelineClip[] = [];
	for (const [trackOrder, track] of timeline.tracks.entries()) {
		if (track.hidden) continue;
		for (const element of track.elements) {
			if (element.hidden || !MEDIA_CLIP_TYPES.has(element.type ?? "")) continue;
			clips.push({
				trackOrder,
				startTime: element.startTime,
				endTime: element.endTime,
				element,
			});
		}
	}
	return clips;
}

/**
 * Why the native export cannot stack this timeline's overlays, or null when
 * it can (including when there are none).
 */
export function mediaOverlayRendererReason({
	timeline,
}: {
	timeline: OverlayPolicyTimeline;
}): string | null {
	const fps = timeline.fps ?? 30;
	const overlays = findOverlayClips({
		clips: timelineMediaClips({ timeline }),
		fps,
	});
	if (overlays.size === 0) return null;
	const overlayIds = new Set(
		[...overlays].map((overlay) => overlay.element.id).filter(Boolean)
	);
	for (const track of timeline.tracks) {
		if (track.hidden) continue;
		for (const transition of track.transitions ?? []) {
			if (
				overlayIds.has(transition.fromElementId) ||
				overlayIds.has(transition.toElementId)
			) {
				return "a transition on a media clip stacked over a lower track";
			}
		}
	}
	for (const overlay of overlays) {
		if (overlay.element.frameInterpolation === "neural") {
			return "neural frame interpolation on a media clip stacked over a lower track";
		}
	}
	const tolerance = stackToleranceSeconds({ fps });
	for (const [trackOrder, track] of timeline.tracks.entries()) {
		if (track.hidden || track.type === "media" || track.type === "audio")
			continue;
		for (const element of track.elements) {
			if (element.hidden) continue;
			const layer = {
				trackOrder,
				startTime: element.startTime,
				endTime: element.endTime,
			};
			for (const overlay of overlays) {
				if (
					trackOrder > overlay.trackOrder &&
					overlapSeconds(layer, overlay) > tolerance
				) {
					return `a ${element.type ?? track.type ?? "visual"} layer under a media clip stacked over a lower track`;
				}
			}
		}
	}
	return null;
}
