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
 * frame interpolation on one, or a text, sticker or effect layer under one —
 * makes the timeline a renderer export instead of a wrong one.
 *
 * An adjustment layer under an overlay is stacked: it is graded inside the
 * overlay pass, at its own place, so the overlays above it are left alone.
 * The one case that is not: a layer that is also above every text or sticker
 * track. Its grade has to wait for that text to be drawn, which happens after
 * the overlay pass, and by then the overlay above it is in the picture too.
 */

/** The layers the native export draws after the media overlays. */
export const TEXT_LAYER_TYPES: ReadonlySet<string> = new Set([
	"sticker",
	"text",
	"captions",
	"markdown",
]);

/** "an adjustment layer", "a text layer". */
function withArticle(noun: string): string {
	return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

/**
 * The highest track (lowest index) that shows a text or sticker layer, or
 * infinity when the timeline shows none. An adjustment layer above it grades
 * those layers too, so its grade runs after they are drawn.
 */
export function textLayerTop({
	timeline,
}: {
	timeline: {
		tracks: Array<{
			hidden?: boolean;
			elements: Array<{ type?: string; hidden?: boolean }>;
		}>;
	};
}): number {
	let top = Number.POSITIVE_INFINITY;
	for (const [trackOrder, track] of timeline.tracks.entries()) {
		if (track.hidden) continue;
		if (
			track.elements.some(
				(element) => TEXT_LAYER_TYPES.has(element.type ?? "") && !element.hidden
			)
		) {
			top = Math.min(top, trackOrder);
		}
	}
	return top;
}

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
	const textTop = textLayerTop({ timeline });
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
			const underOverlay = [...overlays].some(
				(overlay) =>
					trackOrder > overlay.trackOrder &&
					overlapSeconds(layer, overlay) > tolerance
			);
			if (!underOverlay) continue;
			if (element.type !== "adjustment") {
				return `${withArticle(element.type ?? track.type ?? "visual")} layer under a media clip stacked over a lower track`;
			}
			// Graded inside the overlay pass, unless it must wait for text.
			if (Number.isFinite(textTop) && trackOrder < textTop) {
				return "an adjustment layer that is under a media clip stacked over a lower track and over the text or sticker tracks";
			}
		}
	}
	return null;
}
