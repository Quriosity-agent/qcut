/**
 * What an undo or redo changed on the timeline, for the editor API's answer
 * (N18, 2026-10-28 trailer report: an undo answered ok while it reverted an
 * older step than the one the caller meant, and nothing in the answer said
 * so).
 *
 * @module lib/claude-bridge/claude-timeline-change-summary
 */

import type { TimelineTrack } from "@/types/timeline";

export interface TimelineChangeSummary {
	added: number;
	removed: number;
	moved: number;
	/** The first few changed elements, in timeline order. */
	elements: Array<{
		elementId: string;
		name?: string;
		change: "added" | "removed" | "moved";
		trackId: string;
		startTime: number;
		/** Where a moved element was before. */
		from?: { trackId: string; startTime: number; duration: number };
		duration: number;
	}>;
}

const LISTED = 10;

function placements(tracks: readonly TimelineTrack[]) {
	const byId = new Map<
		string,
		{ name?: string; trackId: string; startTime: number; duration: number }
	>();
	for (const track of tracks) {
		for (const element of track.elements) {
			byId.set(element.id, {
				name: element.name,
				trackId: track.id,
				startTime: element.startTime,
				duration: element.duration,
			});
		}
	}
	return byId;
}

/** The elements added, removed or moved between two timelines. */
export function summarizeTimelineChange({
	before,
	after,
}: {
	before: readonly TimelineTrack[];
	after: readonly TimelineTrack[];
}): TimelineChangeSummary {
	const was = placements(before);
	const now = placements(after);
	const elements: TimelineChangeSummary["elements"] = [];
	const counts = { added: 0, removed: 0, moved: 0 };
	for (const [elementId, placement] of now) {
		const earlier = was.get(elementId);
		if (!earlier) {
			counts.added++;
			elements.push({ elementId, change: "added", ...placement });
		} else if (
			earlier.trackId !== placement.trackId ||
			earlier.startTime !== placement.startTime ||
			earlier.duration !== placement.duration
		) {
			counts.moved++;
			elements.push({
				elementId,
				change: "moved",
				...placement,
				from: {
					trackId: earlier.trackId,
					startTime: earlier.startTime,
					duration: earlier.duration,
				},
			});
		}
	}
	for (const [elementId, placement] of was) {
		if (now.has(elementId)) continue;
		counts.removed++;
		elements.push({ elementId, change: "removed", ...placement });
	}
	elements.sort((left, right) => left.startTime - right.startTime);
	return { ...counts, elements: elements.slice(0, LISTED) };
}

/**
 * The step an undo or redo moved — the last of `entries`, the history list
 * it landed on — and what it changed.
 */
export function historyStepReport({
	entries,
	before,
	after,
}: {
	entries: ReadonlyArray<{ label: string }>;
	before: readonly TimelineTrack[];
	after: readonly TimelineTrack[];
}): { label?: string; changes: TimelineChangeSummary } {
	const label = entries[entries.length - 1]?.label;
	return {
		...(label ? { label } : {}),
		changes: summarizeTimelineChange({ before, after }),
	};
}
