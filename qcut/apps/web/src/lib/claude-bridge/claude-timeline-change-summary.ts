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
	/**
	 * Elements that kept their place but not their settings, such as a clip
	 * whose media was replaced (N28, 2026-10-30 trailer report: undoing a
	 * replace-media answered with nothing changed).
	 */
	changed: number;
	/** The first few changed elements, in timeline order. */
	elements: Array<{
		elementId: string;
		name?: string;
		change: "added" | "removed" | "moved" | "changed";
		trackId: string;
		startTime: number;
		/** Where a moved element was before. */
		from?: { trackId: string; startTime: number; duration: number };
		duration: number;
		/** For a moved or changed element: the fields that differ. */
		fields?: string[];
	}>;
}

const LISTED = 10;

type Placed = {
	placement: {
		name?: string;
		trackId: string;
		startTime: number;
		duration: number;
	};
	element: Record<string, unknown>;
};

function placements(tracks: readonly TimelineTrack[]) {
	const byId = new Map<string, Placed>();
	for (const track of tracks) {
		for (const element of track.elements) {
			byId.set(element.id, {
				placement: {
					name: element.name,
					trackId: track.id,
					startTime: element.startTime,
					duration: element.duration,
				},
				element: element as unknown as Record<string, unknown>,
			});
		}
	}
	return byId;
}

/** The element's fields whose values differ, in name order. */
function differingFields({
	was,
	now,
}: {
	was: Record<string, unknown>;
	now: Record<string, unknown>;
}): string[] {
	const keys = new Set([...Object.keys(was), ...Object.keys(now)]);
	return [...keys]
		.filter((key) => JSON.stringify(was[key]) !== JSON.stringify(now[key]))
		.sort();
}

/** The elements added, removed, moved or changed between two timelines. */
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
	const counts = { added: 0, removed: 0, moved: 0, changed: 0 };
	for (const [elementId, { placement, element }] of now) {
		const earlier = was.get(elementId);
		if (!earlier) {
			counts.added++;
			elements.push({ elementId, change: "added", ...placement });
			continue;
		}
		const fields = differingFields({ was: earlier.element, now: element });
		const from = earlier.placement;
		if (
			from.trackId !== placement.trackId ||
			from.startTime !== placement.startTime ||
			from.duration !== placement.duration
		) {
			counts.moved++;
			elements.push({
				elementId,
				change: "moved",
				...placement,
				from: {
					trackId: from.trackId,
					startTime: from.startTime,
					duration: from.duration,
				},
				...(fields.length > 0 ? { fields } : {}),
			});
		} else if (fields.length > 0) {
			counts.changed++;
			elements.push({ elementId, change: "changed", ...placement, fields });
		}
	}
	for (const [elementId, { placement }] of was) {
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
