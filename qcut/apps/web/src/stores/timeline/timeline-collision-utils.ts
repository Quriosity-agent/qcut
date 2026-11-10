import {
	assignNewStickerInstanceId,
	createStickerInstanceId,
} from "@/lib/stickers/sticker-instance";
import { getTimelineElementEndTime } from "@/lib/timeline";
import {
	getSeamToleranceSeconds,
	startsAtOrAfter,
} from "@/lib/timeline-occupancy";
import { generateUUID } from "@/lib/utils";
import type { TimelineElement } from "@/types/timeline";
import {
	classifyRangeCollision,
	type TimeRange,
} from "@qcut/editor-core/timeline";
import { getElementNameWithSuffix } from "./index";
import { getTimelineSplitUpdates } from "./timeline-split-utils";

/**
 * Applies collision plans to one track's element list (QTL-002). This is the
 * single place that turns the pure interval plans from
 * `@qcut/editor-core/timeline/collision-policy` into real element edits, so
 * add-with-overwrite, deleteTimeRange, and ripple range deletion all share
 * one implementation of the trim/split math.
 */

export interface OverwriteRangeResult {
	elements: TimelineElement[];
	deletedElements: number;
	splitElements: number;
}

/**
 * Clear [range.startTime, range.endTime) from the element list without
 * moving anything outside the range. Split parts keep their names — this
 * mirrors the long-standing deleteTimeRange behavior.
 */
export function overwriteRangeInElements({
	elements,
	range,
	fps,
}: {
	elements: readonly TimelineElement[];
	range: TimeRange;
	fps: number;
}): OverwriteRangeResult {
	const nextElements: TimelineElement[] = [];
	let deletedElements = 0;
	let splitElements = 0;

	// Half a frame: a remnant shorter than that is not a clip, it is rounding.
	const tolerance = 0.5 / Math.max(1, fps);
	for (const element of elements) {
		const kind = classifyRangeCollision({
			item: {
				startTime: element.startTime,
				endTime: getTimelineElementEndTime({ element }),
			},
			range,
			tolerance,
		});

		if (kind === "none") {
			nextElements.push(element);
			continue;
		}

		if (kind === "inside") {
			deletedElements++;
			continue;
		}

		if (kind === "ends-inside") {
			splitElements++;
			const splitUpdates = getTimelineSplitUpdates({
				element,
				splitTime: range.startTime,
				fps,
			});
			nextElements.push({ ...element, ...splitUpdates.left });
			continue;
		}

		if (kind === "starts-inside") {
			splitElements++;
			const splitUpdates = getTimelineSplitUpdates({
				element,
				splitTime: range.endTime,
				fps,
			});
			nextElements.push({
				...element,
				startTime: range.endTime,
				...splitUpdates.right,
			});
			continue;
		}

		// spans: keep both outer parts, the right one as a new element.
		splitElements++;
		const leftSplitUpdates = getTimelineSplitUpdates({
			element,
			splitTime: range.startTime,
			fps,
		});
		const rightSplitUpdates = getTimelineSplitUpdates({
			element,
			splitTime: range.endTime,
			fps,
		});
		nextElements.push({ ...element, ...leftSplitUpdates.left });
		nextElements.push(
			assignNewStickerInstanceId({
				element: {
					...element,
					id: generateUUID(),
					startTime: range.endTime,
					...rightSplitUpdates.right,
				},
				newStickerId: createStickerInstanceId(),
			})
		);
	}

	return { elements: nextElements, deletedElements, splitElements };
}

/**
 * The elements as they lie around `time`: untouched before it, marked `after`
 * from it on. The element spanning the point is split there, its parts named
 * like a manual split. Seams less than the seam tolerance apart count as
 * touching.
 */
function splitElementsAtTime({
	elements,
	time,
	fps,
}: {
	elements: readonly TimelineElement[];
	time: number;
	fps: number;
}): Array<{ element: TimelineElement; after: boolean; split?: true }> {
	const tolerance = getSeamToleranceSeconds(fps);
	const pieces: Array<{
		element: TimelineElement;
		after: boolean;
		split?: true;
	}> = [];

	for (const element of elements) {
		if (startsAtOrAfter({ startTime: element.startTime, time, fps })) {
			pieces.push({ element, after: true });
			continue;
		}

		const endTime = getTimelineElementEndTime({ element });
		if (endTime <= time + tolerance) {
			pieces.push({ element, after: false });
			continue;
		}

		const splitUpdates = getTimelineSplitUpdates({
			element,
			splitTime: time,
			fps,
		});
		pieces.push({
			element: {
				...element,
				...splitUpdates.left,
				name: getElementNameWithSuffix(element.name, "left"),
			},
			after: false,
		});
		pieces.push({
			element: assignNewStickerInstanceId({
				element: {
					...element,
					id: generateUUID(),
					startTime: time,
					...splitUpdates.right,
					name: getElementNameWithSuffix(element.name, "right"),
				},
				newStickerId: createStickerInstanceId(),
			}),
			after: true,
			split: true,
		});
	}
	return pieces;
}

/**
 * Makes room for `insertDuration` at `insertTime`. The element spanning the
 * point is split (named like a manual split), and every element from the
 * point on moves right as far as the inserted one needs: its whole length
 * when something starts at the point, less when a gap is there, and not at
 * all when the gap fits it (N20: a clip put back into the gap its
 * predecessor left pushed the 30 clips after it 1.29 s right). Seams less
 * than the seam tolerance apart count as touching.
 */
export function insertGapInElements({
	elements,
	insertTime,
	insertDuration,
	fps,
}: {
	elements: readonly TimelineElement[];
	insertTime: number;
	insertDuration: number;
	fps: number;
}): TimelineElement[] {
	const tolerance = getSeamToleranceSeconds(fps);
	const pieces = splitElementsAtTime({ elements, time: insertTime, fps });

	const firstAfterStart = Math.min(
		...pieces
			.filter((piece) => piece.after)
			.map((piece) => piece.element.startTime)
	);
	const overflow = insertTime + insertDuration - firstAfterStart;
	const shift = overflow > tolerance ? overflow : 0;
	return pieces.map(({ element, after }) =>
		after && shift > 0
			? { ...element, startTime: element.startTime + shift }
			: element
	);
}

/**
 * Opens `duration` seconds of empty time at `time`: every element from the
 * point on moves right by exactly that much, whatever room there already
 * was, and the element spanning the point is split there. The reverse of a
 * ripple delete of the same span.
 */
export function openGapInElements({
	elements,
	time,
	duration,
	fps,
}: {
	elements: readonly TimelineElement[];
	time: number;
	duration: number;
	fps: number;
}): {
	elements: TimelineElement[];
	movedElements: number;
	splitElements: number;
} {
	const pieces = splitElementsAtTime({ elements, time, fps });
	return {
		elements: pieces.map(({ element, after }) =>
			after ? { ...element, startTime: element.startTime + duration } : element
		),
		movedElements: pieces.filter((piece) => piece.after).length,
		splitElements: pieces.filter((piece) => piece.split).length,
	};
}
