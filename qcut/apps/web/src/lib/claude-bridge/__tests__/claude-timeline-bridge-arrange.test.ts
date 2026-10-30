import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `editor:timeline:arrange` lays a track's elements end to end: in time
 * order, spaced, or in a given order, from a start offset, in one commit.
 */

vi.mock("@/stores/media/media-store", () => ({
	useMediaStore: { getState: () => ({ mediaItems: [] }) },
	getMediaAspectRatio: vi.fn(() => 16 / 9),
}));
vi.mock("@/lib/storage/storage-service", () => ({
	storageService: {
		saveTimeline: vi.fn(() => Promise.resolve()),
		saveProjectTimeline: vi.fn(() => Promise.resolve()),
		loadTimeline: vi.fn(() => Promise.resolve(null)),
	},
}));
vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: vi.fn(() => ({ activeProject: { id: "p1", fps: 24 } })),
	},
}));
vi.mock("@/stores/editor/editor-store", () => ({
	useEditorStore: {
		getState: vi.fn(() => ({ currentTime: 0, setCurrentTime: vi.fn() })),
	},
}));
vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { getTimelineElementDuration } from "@/lib/timeline";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { setupArrangeHandler } from "../claude-timeline-bridge-arrange";

function clip(id: string, startTime: number, length: number): MediaElement {
	return {
		id,
		type: "media",
		name: id,
		mediaId: `${id}-media`,
		startTime,
		duration: length + 1,
		trimStart: 0.5,
		trimEnd: 0.5,
	};
}

function setTrack({
	locked = false,
	// Out of time order on purpose: c, a, b by start.
	elements = [clip("a", 4, 3), clip("b", 9, 1), clip("c", 0, 2)],
}: {
	locked?: boolean;
	elements?: MediaElement[];
} = {}) {
	const tracks: TimelineTrack[] = [
		{
			id: "main",
			name: "主轨道",
			type: "media",
			isMain: true,
			locked,
			elements,
		},
		{ id: "empty", name: "空", type: "media", elements: [] },
	];
	useTimelineStore.setState({ _tracks: tracks, tracks, history: [] });
}

function arrange(request: Record<string, unknown>) {
	let handler: ((message: unknown) => void) | undefined;
	const sendArrangeResponse = vi.fn();
	setupArrangeHandler({
		claudeAPI: {
			onArrange: (callback: typeof handler) => {
				handler = callback;
			},
			sendArrangeResponse,
		} as never,
	});
	handler?.({ requestId: "r1", request: { trackId: "main", ...request } });
	return sendArrangeResponse.mock.lastCall;
}

function mainElements() {
	return (
		useTimelineStore
			.getState()
			.tracks.find((candidate) => candidate.id === "main")?.elements ?? []
	);
}

function starts(): Record<string, number> {
	return Object.fromEntries(
		mainElements().map((element) => [element.id, element.startTime])
	);
}

beforeEach(() => setTrack());

describe("arranging a track", () => {
	it("lays the elements end to end in time order", () => {
		expect(arrange({ mode: "sequential" })).toEqual([
			"r1",
			{
				arranged: [
					{ elementId: "c", newStartTime: 0 },
					{ elementId: "a", newStartTime: 2 },
					{ elementId: "b", newStartTime: 5 },
				],
			},
		]);
		expect(starts()).toEqual({ a: 2, b: 5, c: 0 });
	});

	it("spaces them half a second apart unless told otherwise", () => {
		arrange({ mode: "spaced" });
		expect(starts()).toEqual({ a: 2.5, b: 6, c: 0 });
		setTrack();
		arrange({ mode: "spaced", gap: 1, startOffset: 3 });
		expect(starts()).toEqual({ a: 6, b: 10, c: 3 });
	});

	it("takes a gap or offset that is not a finite distance as unset", () => {
		arrange({
			mode: "spaced",
			gap: Number.POSITIVE_INFINITY,
			startOffset: Number.NaN,
		});
		expect(starts()).toEqual({ a: 2.5, b: 6, c: 0 });
	});

	it("commits nothing when a clip's length is not finite", () => {
		// A recorded WebM can report an endless duration until it is seeked.
		const endless = { ...clip("endless", 0, 1), duration: Infinity };
		setTrack({ elements: [endless, clip("after", 5, 1)] });
		expect(arrange({ mode: "sequential" })).toEqual(["r1", { arranged: [] }]);
		expect(starts()).toEqual({ endless: 0, after: 5 });
	});

	it("moves an element whose id is __proto__", () => {
		setTrack({ elements: [clip("__proto__", 5, 2), clip("b", 0, 1)] });
		arrange({ mode: "sequential" });
		const moved = mainElements().find((element) => element.id === "__proto__");
		expect(moved?.startTime).toBe(1);
	});

	it("measures a speed-ramped clip at the project's frame rate", () => {
		const ramped: MediaElement = {
			...clip("ramp", 0, 2),
			speedKeyframes: [
				{ id: "slow", frame: 0, value: 1, easing: "linear" },
				{ id: "fast", frame: 30, value: 2, easing: "linear" },
			],
		};
		setTrack({ elements: [ramped, clip("next", 10, 1)] });
		arrange({ mode: "sequential" });
		// The project runs at 24 fps; at 30 fps the ramp has another length.
		const length = getTimelineElementDuration({ element: ramped, fps: 24 });
		expect(
			Math.abs(
				length - getTimelineElementDuration({ element: ramped, fps: 30 })
			)
		).toBeGreaterThan(0.01);
		expect(starts()).toEqual({ ramp: 0, next: length });
	});

	it("takes a manual order first and the rest after, by time", () => {
		arrange({ mode: "manual", order: ["b", "missing", "a"] });
		expect(starts()).toEqual({ b: 0, a: 1, c: 4 });
	});

	it("arranges nothing on an empty, missing or locked track", () => {
		expect(arrange({ trackId: "empty", mode: "sequential" })).toEqual([
			"r1",
			{ arranged: [] },
		]);
		expect(arrange({ trackId: "gone", mode: "sequential" })).toEqual([
			"r1",
			{ arranged: [] },
		]);
		setTrack({ locked: true });
		expect(arrange({ mode: "sequential" })).toEqual(["r1", { arranged: [] }]);
		expect(starts()).toEqual({ a: 4, b: 9, c: 0 });
	});
});
