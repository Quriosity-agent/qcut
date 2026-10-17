import type { CaptionElement, TimelineTrack } from "@/types/timeline";
import { resolveSubtitleStyle } from "./subtitle-style";

/**
 * Where a caption sits when other captions share its edge while it is on
 * screen. The one that started first keeps the edge; each later one is
 * pushed away from the edge by the block height of those under it, for its
 * whole life (so it does not jump when a neighbour ends). The preview, the
 * canvas export and the native pass (text-overlay.ts) all use this order and
 * these heights, so the three agree.
 */

/** The preview's caption box padding (8 px top and bottom). */
const CAPTION_BOX_PADDING_Y = 8;

export function captionBlockHeight({
	element,
	lines = 1,
}: {
	element: CaptionElement;
	lines?: number;
}): number {
	const style = resolveSubtitleStyle(element.style);
	return (
		Math.max(1, lines) * style.fontSize * style.lineSpacing +
		2 * CAPTION_BOX_PADDING_Y
	);
}

function overlaps(
	left: { startTime: number; duration: number },
	right: { startTime: number; duration: number }
): boolean {
	return (
		left.startTime < right.startTime + right.duration &&
		right.startTime < left.startTime + left.duration
	);
}

/**
 * Captions on unhidden tracks that share `element`'s edge and overlap it in
 * time (itself included), in stacking order: earliest start first, then
 * track order (top row last).
 */
export function captionsSharingEdge({
	tracks,
	element,
}: {
	tracks: readonly TimelineTrack[];
	element: CaptionElement;
}): CaptionElement[] {
	const align = resolveSubtitleStyle(element.style).position.align;
	const sharing: Array<{ caption: CaptionElement; trackIndex: number }> = [];
	tracks.forEach((track, trackIndex) => {
		if (track.hidden) return;
		for (const candidate of track.elements) {
			if (candidate.type !== "captions" || candidate.hidden) continue;
			if (candidate.id !== element.id && !overlaps(candidate, element)) {
				continue;
			}
			if (resolveSubtitleStyle(candidate.style).position.align !== align) {
				continue;
			}
			sharing.push({ caption: candidate, trackIndex });
		}
	});
	return sharing
		.sort(
			(left, right) =>
				left.caption.startTime - right.caption.startTime ||
				right.trackIndex - left.trackIndex
		)
		.map((entry) => entry.caption);
}

/**
 * How far from its edge `element` draws, in canvas pixels: the summed block
 * heights of the captions stacked under it (0 for the first or only one, and
 * always 0 for centre-aligned captions, which overlap).
 */
export function captionStackOffset({
	tracks,
	element,
}: {
	tracks: readonly TimelineTrack[];
	element: CaptionElement;
}): number {
	if (resolveSubtitleStyle(element.style).position.align === "center") return 0;
	let offset = 0;
	for (const caption of captionsSharingEdge({ tracks, element })) {
		if (caption.id === element.id) return offset;
		offset += captionBlockHeight({ element: caption });
	}
	return 0;
}
