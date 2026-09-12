import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import {
	planMediaBatchEdit,
	readMediaBatchValue,
	type MediaBatchEdit,
} from "@/lib/video/media-batch-properties";
import { clearAutoSaveTimer } from "../timeline-store-autosave";
import { createMediaBatchOperations } from "../timeline-media-batch-operations";
import { useTimelineStore } from "../timeline-store";

function clip({
	id,
	...overrides
}: Partial<MediaElement> & { id: string }): MediaElement {
	return {
		id,
		name: id,
		type: "media",
		mediaId: `${id}-asset`,
		duration: 4,
		startTime: 0,
		trimStart: 0,
		trimEnd: 0,
		maintainAspectRatio: false,
		...overrides,
	};
}

function fixture({
	first = clip({ id: "a", x: 10, scaleX: 1, opacity: 0.4 }),
	second = clip({ id: "b", x: 40, scaleX: 2, opacity: 0.9 }),
	locked = false,
}: {
	first?: MediaElement;
	second?: MediaElement;
	locked?: boolean;
} = {}): TimelineTrack[] {
	return [
		{
			id: "main",
			name: "Main",
			type: "media",
			isMain: true,
			elements: [first, clip({ id: "untouched", x: 99 })],
		},
		{
			id: "overlay",
			name: "Overlay",
			type: "media",
			locked,
			elements: [second],
		},
	];
}

function edit(overrides: Partial<MediaBatchEdit> = {}): MediaBatchEdit {
	return {
		elements: [
			{ trackId: "main", elementId: "a" },
			{ trackId: "overlay", elementId: "b" },
		],
		property: "x",
		mode: "set",
		value: 80,
		currentTime: 1,
		...overrides,
	};
}

function selected({ tracks }: { tracks: TimelineTrack[] }): MediaElement[] {
	return [tracks[0].elements[0], tracks[1].elements[0]].filter(
		(element): element is MediaElement => element.type === "media"
	);
}

afterEach(() => {
	clearAutoSaveTimer();
	vi.restoreAllMocks();
});

describe("media property batch planner", () => {
	it("sets only the chosen field and retains unselected elements and unrelated data", () => {
		const first = clip({
			id: "a",
			x: 5,
			y: 19,
			opacity: 0.3,
			keyframes: { y: [{ id: "y1", frame: 0, value: 19, easing: "linear" }] },
			filterStack: { enabled: true, effects: [] },
		});
		const tracks = fixture({ first });
		const result = planMediaBatchEdit({ tracks, edit: edit(), fps: 30 });
		expect(result.updatedCount).toBe(2);
		expect(selected(result).map((element) => element.x)).toEqual([80, 80]);
		expect(selected(result)[0]).toEqual({ ...first, x: 80 });
		expect(result.tracks[0].elements[1]).toBe(tracks[0].elements[1]);
		expect(tracks[0].elements[0]).toBe(first);
		expect(first.x).toBe(5);
	});

	it("adjusts each position from its own value and deduplicates explicit targets", () => {
		const batch = edit({ mode: "adjust", value: -5 });
		batch.elements.push(batch.elements[0]);
		const result = planMediaBatchEdit({
			tracks: fixture(),
			edit: batch,
			fps: 30,
		});
		expect(result.updatedCount).toBe(2);
		expect(selected(result).map((element) => element.x)).toEqual([5, 35]);
	});

	it("distinguishes setting 120 percent from enlarging every scale by 20 percent", () => {
		const tracks = fixture();
		const set = planMediaBatchEdit({
			tracks,
			edit: edit({ property: "scaleX", value: 120 }),
			fps: 30,
		});
		const adjust = planMediaBatchEdit({
			tracks,
			edit: edit({ property: "scaleX", mode: "adjust", value: 20 }),
			fps: 30,
		});
		expect(selected(set).map((element) => element.scaleX)).toEqual([1.2, 1.2]);
		expect(selected(adjust).map((element) => element.scaleX)).toEqual([
			1.2, 2.4,
		]);
	});

	it("uses percentage points for opacity and clamps only bounded properties", () => {
		const opacity = planMediaBatchEdit({
			tracks: fixture(),
			edit: edit({ property: "opacity", mode: "adjust", value: 20 }),
			fps: 30,
		});
		expect(selected(opacity).map((element) => element.opacity)).toEqual([
			0.6, 1,
		]);
		const tiny = planMediaBatchEdit({
			tracks: fixture(),
			edit: edit({ property: "scaleX", value: -30 }),
			fps: 30,
		});
		expect(selected(tiny).map((element) => element.scaleX)).toEqual([
			0.01, 0.01,
		]);
		const large = planMediaBatchEdit({
			tracks: fixture(),
			edit: edit({ property: "scaleX", value: 900 }),
			fps: 30,
		});
		expect(selected(large).map((element) => element.scaleX)).toEqual([4, 4]);
		const rotation = planMediaBatchEdit({
			tracks: fixture(),
			edit: edit({ property: "rotation", value: 720 }),
			fps: 30,
		});
		expect(selected(rotation).map((element) => element.rotation)).toEqual([
			720, 720,
		]);
	});

	it("honors each clip's scale link without changing its link setting", () => {
		const tracks = fixture({
			first: clip({ id: "a", maintainAspectRatio: true, scaleX: 1, scaleY: 1 }),
			second: clip({ id: "b", scaleX: 2, scaleY: 0.5 }),
		});
		const result = planMediaBatchEdit({
			tracks,
			edit: edit({ property: "scaleX", mode: "adjust", value: 20 }),
			fps: 30,
		});
		expect(selected(result)).toMatchObject([
			{ scaleX: 1.2, scaleY: 1.2, maintainAspectRatio: true },
			{ scaleX: 2.4, scaleY: 0.5, maintainAspectRatio: false },
		]);
	});

	it("updates a keyed value at each clip's local frame and preserves other frames and properties", () => {
		const frames = [
			{ id: "start", frame: 0, value: 0, easing: "linear" as const },
			{ id: "middle", frame: 30, value: 30, easing: "easeIn" as const },
			{ id: "end", frame: 60, value: 60, easing: "linear" as const },
		];
		const first = clip({
			id: "a",
			startTime: 10,
			keyframes: {
				x: frames,
				opacity: [{ id: "alpha", frame: 0, value: 0.5, easing: "linear" }],
			},
		});
		const second = clip({
			id: "b",
			startTime: 10.5,
			keyframes: { x: [frames[0], frames[2]] },
		});
		const result = planMediaBatchEdit({
			tracks: fixture({ first, second }),
			edit: edit({ mode: "adjust", value: 10, currentTime: 11 }),
			fps: 30,
		});
		const [a, b] = selected(result);
		expect(a.keyframes?.x).toEqual([
			frames[0],
			{ ...frames[1], value: 40 },
			frames[2],
		]);
		expect(a.keyframes?.opacity).toBe(first.keyframes?.opacity);
		expect(b.keyframes?.x).toHaveLength(3);
		expect(b.keyframes?.x?.[1]).toMatchObject({
			frame: 15,
			value: 25,
			easing: "linear",
		});
		expect(first.keyframes?.x).toBe(frames);
	});

	it("clamps keyframe editing to trimmed, retimed clip boundaries", () => {
		const first = clip({
			id: "a",
			duration: 6,
			trimStart: 1,
			trimEnd: 1,
			playbackRate: 2,
			startTime: 10,
			keyframes: {
				x: [
					{ id: "first", frame: 0, value: 5, easing: "linear" },
					{ id: "last", frame: 60, value: 30, easing: "linear" },
				],
			},
		});
		const request = edit({
			elements: [{ trackId: "main", elementId: "a" }],
			mode: "adjust",
			value: 7,
			currentTime: 100,
		});
		const end = planMediaBatchEdit({
			tracks: fixture({ first }),
			edit: request,
			fps: 30,
		});
		expect(selected(end)[0].keyframes?.x?.[1]).toMatchObject({
			id: "last",
			frame: 60,
			value: 37,
		});
		const start = planMediaBatchEdit({
			tracks: fixture({ first }),
			edit: { ...request, currentTime: 0 },
			fps: 30,
		});
		expect(selected(start)[0].keyframes?.x?.[0]).toMatchObject({
			id: "first",
			frame: 0,
			value: 12,
		});
		expect(
			readMediaBatchValue({
				element: first,
				property: "x",
				currentTime: 100,
				fps: 30,
			})
		).toBe(30);
	});

	it("rejects the entire batch for locked, missing, or non-media members", () => {
		const locked = fixture({ locked: true });
		expect(
			planMediaBatchEdit({ tracks: locked, edit: edit(), fps: 30 })
		).toEqual({ tracks: locked, updatedCount: 0 });
		const tracks = fixture();
		const missing = edit();
		missing.elements.push({ trackId: "main", elementId: "gone" });
		expect(planMediaBatchEdit({ tracks, edit: missing, fps: 30 }).tracks).toBe(
			tracks
		);
		const missingTrack = edit({
			elements: [{ trackId: "gone", elementId: "a" }],
		});
		const otherType = fixture();
		otherType[1].elements = [
			{
				id: "b",
				name: "Adjustment",
				type: "adjustment",
				startTime: 0,
				duration: 4,
				trimStart: 0,
				trimEnd: 0,
			},
		];
		expect(
			planMediaBatchEdit({ tracks: otherType, edit: edit(), fps: 30 }).tracks
		).toBe(otherType);
		expect(
			planMediaBatchEdit({ tracks, edit: missingTrack, fps: 30 }).updatedCount
		).toBe(0);
	});

	it("keeps no-op, zero adjustment, invalid numbers and overflow out of history", () => {
		const tracks = fixture();
		for (const batch of [
			edit({ mode: "adjust", value: 0 }),
			edit({ value: Number.NaN }),
			edit({ value: Infinity }),
			edit({ currentTime: Infinity }),
			edit({ elements: [] }),
		]) {
			expect(planMediaBatchEdit({ tracks, edit: batch, fps: 30 }).tracks).toBe(
				tracks
			);
		}
		expect(
			planMediaBatchEdit({ tracks, edit: edit(), fps: 0 }).updatedCount
		).toBe(0);
		const overflowing = fixture({
			second: clip({ id: "b", x: Number.MAX_VALUE }),
		});
		expect(
			planMediaBatchEdit({
				tracks: overflowing,
				edit: edit({ mode: "adjust", value: Number.MAX_VALUE }),
				fps: 30,
			}).tracks
		).toBe(overflowing);
		const same = planMediaBatchEdit({
			tracks,
			edit: edit({
				elements: [{ trackId: "main", elementId: "a" }],
				value: 10,
			}),
			fps: 30,
		});
		expect(same.tracks).toBe(tracks);
	});
});

describe("media batch store operation", () => {
	it("saves a whole batch once, with one undo and redo restoring every clip", () => {
		const tracks = fixture();
		useTimelineStore.setState({
			_tracks: tracks,
			tracks,
			history: [],
			redoStack: [],
			selectedElements: edit().elements,
			selectedTransition: null,
		});
		const result = useTimelineStore
			.getState()
			.updateMediaPropertiesBatch(edit());
		expect(result).toBe(2);
		expect(useTimelineStore.getState().history).toHaveLength(1);
		expect(
			selected({ tracks: useTimelineStore.getState().tracks }).map(
				(element) => element.x
			)
		).toEqual([80, 80]);
		useTimelineStore.getState().undo();
		expect(
			selected({ tracks: useTimelineStore.getState().tracks }).map(
				(element) => element.x
			)
		).toEqual([10, 40]);
		useTimelineStore.getState().redo();
		expect(
			selected({ tracks: useTimelineStore.getState().tracks }).map(
				(element) => element.x
			)
		).toEqual([80, 80]);
		useTimelineStore.getState().updateMediaPropertiesBatch(edit());
		expect(useTimelineStore.getState().history).toHaveLength(1);
	});

	it("does not schedule N persistence passes for N selected clips", () => {
		const tracks = fixture();
		useTimelineStore.setState({
			_tracks: tracks,
			tracks,
			history: [],
			redoStack: [],
		});
		const save = vi.fn();
		const operations = createMediaBatchOperations({
			get: useTimelineStore.getState,
			deps: { getProjectFps: () => 30, updateTracksAndSave: save },
		});
		expect(operations.updateMediaPropertiesBatch(edit())).toBe(2);
		expect(save).toHaveBeenCalledOnce();
		expect(useTimelineStore.getState().history).toHaveLength(1);
	});

	it("rejects locked targets before history or persistence changes", () => {
		const tracks = fixture({ locked: true });
		useTimelineStore.setState({
			_tracks: tracks,
			tracks,
			history: [],
			redoStack: [],
		});
		const save = vi.fn();
		const operations = createMediaBatchOperations({
			get: useTimelineStore.getState,
			deps: { getProjectFps: () => 30, updateTracksAndSave: save },
		});
		expect(operations.updateMediaPropertiesBatch(edit())).toBe(0);
		expect(save).not.toHaveBeenCalled();
		expect(useTimelineStore.getState().history).toHaveLength(0);
		expect(useTimelineStore.getState()._tracks).toBe(tracks);
	});
});
