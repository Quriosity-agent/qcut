/**
 * What the events bridge remembers of the timeline between two store
 * updates, so it can say which elements were added, changed or removed.
 *
 * The store replaces an element's object when it changes and keeps the same
 * object otherwise, so an element is serialized once per object, not once
 * per store update. Serializing every element on every update made each
 * edit cost the whole timeline: with a 3D LUT on sixty clips a single added
 * clip re-read tens of megabytes, and `timeline apply` outlived its
 * transaction.
 */

import type { TimelineTrack } from "@/types/timeline";

export interface TimelineElementSnapshot {
	elementId: string;
	trackId: string;
	trackType: string;
	/** The store's own object; the same object means nothing changed. */
	element: object;
	/** The element as JSON, compared when the object was replaced. */
	json: string;
}

export type TimelineSnapshot = Map<string, TimelineElementSnapshot>;

export interface TimelineSnapshotDiff {
	added: TimelineElementSnapshot[];
	updated: Array<{
		before: TimelineElementSnapshot;
		after: TimelineElementSnapshot;
	}>;
	removed: TimelineElementSnapshot[];
}

function serializeElement({ element }: { element: object }): string {
	try {
		return JSON.stringify(element) ?? "{}";
	} catch {
		return "{}";
	}
}

/**
 * A snapshot function that keeps each element's JSON for as long as the
 * store keeps the element's object.
 */
export function createTimelineSnapshotter(): ({
	tracks,
}: {
	tracks: TimelineTrack[];
}) => TimelineSnapshot {
	const serialized = new WeakMap<object, string>();
	return ({ tracks }) => {
		const snapshot: TimelineSnapshot = new Map();
		for (const track of tracks) {
			for (const element of track.elements) {
				let json = serialized.get(element);
				if (json === undefined) {
					json = serializeElement({ element });
					serialized.set(element, json);
				}
				snapshot.set(element.id, {
					elementId: element.id,
					trackId: track.id,
					trackType: track.type,
					element,
					json,
				});
			}
		}
		return snapshot;
	};
}

function elementChanged({
	before,
	after,
}: {
	before: TimelineElementSnapshot;
	after: TimelineElementSnapshot;
}): boolean {
	if (
		before.trackId !== after.trackId ||
		before.trackType !== after.trackType
	) {
		return true;
	}
	return before.element !== after.element && before.json !== after.json;
}

export function diffTimelineSnapshots({
	previous,
	next,
}: {
	previous: TimelineSnapshot;
	next: TimelineSnapshot;
}): TimelineSnapshotDiff {
	const diff: TimelineSnapshotDiff = { added: [], updated: [], removed: [] };
	for (const [elementId, after] of next) {
		const before = previous.get(elementId);
		if (!before) {
			diff.added.push(after);
			continue;
		}
		if (elementChanged({ before, after })) diff.updated.push({ before, after });
	}
	for (const [elementId, before] of previous) {
		if (!next.has(elementId)) diff.removed.push(before);
	}
	return diff;
}

/** The element as a plain record of its own, for an event's payload. */
export function snapshotElementData({
	snapshot,
}: {
	snapshot: TimelineElementSnapshot;
}): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(snapshot.json);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}
