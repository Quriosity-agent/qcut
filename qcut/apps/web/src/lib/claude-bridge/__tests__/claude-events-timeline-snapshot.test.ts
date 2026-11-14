import { describe, expect, it, vi } from "vitest";
import type { TimelineTrack } from "@/types/timeline";
import {
	createTimelineSnapshotter,
	diffTimelineSnapshots,
	snapshotElementData,
} from "../claude-events-timeline-snapshot";

function clip({ id, name = id }: { id: string; name?: string }) {
	return {
		id,
		type: "media",
		name,
		mediaId: "media-1",
		startTime: 0,
		duration: 1,
		trimStart: 0,
		trimEnd: 0,
	};
}

function track({
	id,
	type = "media",
	elements,
}: {
	id: string;
	type?: string;
	elements: object[];
}): TimelineTrack {
	return { id, name: id, type, elements } as unknown as TimelineTrack;
}

/** Counts how many times each element is read by JSON.stringify. */
function countSerializations({ run }: { run: () => void }): number {
	const stringify = vi.spyOn(JSON, "stringify");
	try {
		run();
		return stringify.mock.calls.length;
	} finally {
		stringify.mockRestore();
	}
}

describe("timeline snapshots for the events bridge", () => {
	it("reports nothing for a timeline whose elements are the same objects", () => {
		const snapshot = createTimelineSnapshotter();
		const elements = [clip({ id: "a" }), clip({ id: "b" })];
		const previous = snapshot({ tracks: [track({ id: "t", elements })] });
		const next = snapshot({
			tracks: [track({ id: "t", elements: [...elements] })],
		});
		expect(diffTimelineSnapshots({ previous, next })).toEqual({
			added: [],
			updated: [],
			removed: [],
		});
	});

	it("serializes an element once for as long as the store keeps its object", () => {
		const snapshot = createTimelineSnapshotter();
		const kept = Array.from({ length: 60 }, (_, index) =>
			clip({ id: `kept-${index}` })
		);
		const first = countSerializations({
			run: () => snapshot({ tracks: [track({ id: "t", elements: kept })] }),
		});
		expect(first).toBe(60);
		const added = countSerializations({
			run: () =>
				snapshot({
					tracks: [
						track({ id: "t", elements: [...kept, clip({ id: "new" })] }),
					],
				}),
		});
		expect(added).toBe(1);
	});

	it("names the added, changed and removed elements", () => {
		const snapshot = createTimelineSnapshotter();
		const a = clip({ id: "a" });
		const b = clip({ id: "b" });
		const c = clip({ id: "c" });
		const previous = snapshot({
			tracks: [track({ id: "t", elements: [a, b, c] })],
		});
		const renamed = { ...b, name: "renamed" };
		const next = snapshot({
			tracks: [track({ id: "t", elements: [a, renamed, clip({ id: "d" })] })],
		});
		const diff = diffTimelineSnapshots({ previous, next });
		expect(diff.added.map((item) => item.elementId)).toEqual(["d"]);
		expect(diff.removed.map((item) => item.elementId)).toEqual(["c"]);
		expect(diff.updated).toHaveLength(1);
		expect(snapshotElementData({ snapshot: diff.updated[0].before })).toEqual(
			b
		);
		expect(snapshotElementData({ snapshot: diff.updated[0].after })).toEqual(
			renamed
		);
	});

	it("does not report a replaced object that holds the same values", () => {
		const snapshot = createTimelineSnapshotter();
		const a = clip({ id: "a" });
		const previous = snapshot({ tracks: [track({ id: "t", elements: [a] })] });
		const next = snapshot({
			tracks: [track({ id: "t", elements: [{ ...a }] })],
		});
		expect(diffTimelineSnapshots({ previous, next }).updated).toEqual([]);
	});

	it("reports an element that moved to another track", () => {
		const snapshot = createTimelineSnapshotter();
		const a = clip({ id: "a" });
		const previous = snapshot({
			tracks: [
				track({ id: "one", elements: [a] }),
				track({ id: "two", elements: [] }),
			],
		});
		const next = snapshot({
			tracks: [
				track({ id: "one", elements: [] }),
				track({ id: "two", elements: [a] }),
			],
		});
		const diff = diffTimelineSnapshots({ previous, next });
		expect(diff.updated).toHaveLength(1);
		expect(diff.updated[0].before.trackId).toBe("one");
		expect(diff.updated[0].after.trackId).toBe("two");
	});

	it("gives each event payload a copy of its own", () => {
		const snapshot = createTimelineSnapshotter();
		const a = clip({ id: "a" });
		const [item] = snapshot({
			tracks: [track({ id: "t", elements: [a] })],
		}).values();
		const first = snapshotElementData({ snapshot: item });
		first.name = "changed by a listener";
		expect(snapshotElementData({ snapshot: item }).name).toBe("a");
		expect(a.name).toBe("a");
	});
});
