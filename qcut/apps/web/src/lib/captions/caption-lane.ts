import { findRangeCollisions } from "@qcut/editor-core/timeline";
import { getTimelineElementEndTime } from "@/lib/timeline";
import type { CreateCaptionElement, TimelineTrack } from "@/types/timeline";

/**
 * Pick an existing captions lane that has room for every new caption.
 *
 * Adding a caption on top of one that already occupies the same time fails
 * per element (same-track no-overlap rule), so a batch aimed at a busy lane
 * loses captions one by one. Returns null when no lane can take the whole
 * batch; the caller then opens a fresh captions lane.
 */
export function pickCaptionLane({
	tracks,
	elements,
	fps,
}: {
	tracks: readonly TimelineTrack[];
	elements: readonly CreateCaptionElement[];
	fps: number;
}): string | null {
	for (const track of tracks) {
		if (track.type !== "captions") continue;
		const occupied = track.elements.map((element) => ({
			id: element.id,
			startTime: element.startTime,
			endTime: getTimelineElementEndTime({ element, fps }),
		}));
		const fits = elements.every(
			(element) =>
				findRangeCollisions({
					items: occupied,
					range: {
						startTime: element.startTime,
						endTime:
							element.startTime +
							Math.max(
								0,
								element.duration - element.trimStart - element.trimEnd
							),
					},
				}).length === 0
		);
		if (fits) return track.id;
	}
	return null;
}
