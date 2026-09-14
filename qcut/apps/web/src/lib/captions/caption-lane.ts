import {
	findRangeCollisions,
	type TimeRange,
} from "@qcut/editor-core/timeline";
import { getTimelineElementEndTime } from "@/lib/timeline";
import type { CreateCaptionElement, TimelineTrack } from "@/types/timeline";

/** The [start, end) a new caption occupies, as the store's collision check sees it. */
function captionRange(element: CreateCaptionElement): TimeRange {
	return {
		startTime: element.startTime,
		endTime:
			element.startTime +
			Math.max(0, element.duration - element.trimStart - element.trimEnd),
	};
}

/**
 * Split a caption batch into groups whose captions never overlap each other.
 *
 * Subtitle files and recognition output can carry overlapping cues. One lane
 * rejects every later caption that overlaps an earlier one (same-track
 * no-overlap rule), so each group needs a lane of its own. Captions are placed
 * earliest-start first into the first group with room; a batch without
 * overlaps stays a single group.
 */
export function partitionCaptionBatch({
	elements,
}: {
	elements: readonly CreateCaptionElement[];
}): CreateCaptionElement[][] {
	const groups: {
		elements: CreateCaptionElement[];
		ranges: { id: string; startTime: number; endTime: number }[];
	}[] = [];
	const ordered = elements
		.map((element, index) => ({ element, index }))
		.sort(
			(a, b) => a.element.startTime - b.element.startTime || a.index - b.index
		);
	for (const { element, index } of ordered) {
		const range = captionRange(element);
		let group = groups.find(
			(candidate) =>
				findRangeCollisions({ items: candidate.ranges, range }).length === 0
		);
		if (!group) {
			group = { elements: [], ranges: [] };
			groups.push(group);
		}
		group.elements.push(element);
		group.ranges.push({ id: String(index), ...range });
	}
	return groups.map((group) => group.elements);
}

/**
 * Pick an existing captions lane that has room for every new caption.
 *
 * Adding a caption on top of one that already occupies the same time fails
 * per element (same-track no-overlap rule), so a batch aimed at a busy lane
 * loses captions one by one. Pass a batch from `partitionCaptionBatch`, whose
 * captions do not overlap each other. Returns null when no unlocked lane can
 * take the whole batch; the caller then opens a fresh captions lane.
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
		if (track.type !== "captions" || track.locked) continue;
		const occupied = track.elements.map((element) => ({
			id: element.id,
			startTime: element.startTime,
			endTime: getTimelineElementEndTime({ element, fps }),
		}));
		const fits = elements.every(
			(element) =>
				findRangeCollisions({ items: occupied, range: captionRange(element) })
					.length === 0
		);
		if (fits) return track.id;
	}
	return null;
}
