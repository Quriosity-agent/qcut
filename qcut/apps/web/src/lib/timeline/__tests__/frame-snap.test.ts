import { describe, expect, it } from "vitest";
import type {
	MediaElement,
	TextElement,
	TimelineElement,
	TimelineTrack,
} from "@/types/timeline";
import { findOffFrameElements, isOnFrame, planFrameSnap } from "../frame-snap";

const FPS = 24;
const frames = (count: number) => count / FPS;

function clip({
	id,
	start,
	length,
	trimStart = 2,
	trimEnd = 2,
	extra = {},
}: {
	id: string;
	/** Timeline start and length, in frames. */
	start: number;
	length: number;
	trimStart?: number;
	trimEnd?: number;
	extra?: Partial<MediaElement>;
}): MediaElement {
	const rate = extra.playbackRate ?? 1;
	return {
		id,
		type: "media",
		mediaId: `media-${id}`,
		name: id,
		startTime: frames(start),
		duration: frames(length) * rate + trimStart + trimEnd,
		trimStart,
		trimEnd,
		...extra,
	} as MediaElement;
}

function track(elements: TimelineElement[], id = "main"): TimelineTrack {
	return { id, name: id, type: "media", elements } as TimelineTrack;
}

const everything = () => true;

/** The source second a media clip shows at `time` on the timeline. */
function sourceAt(element: MediaElement, time: number): number {
	const rate = element.playbackRate ?? 1;
	const offset = (time - element.startTime) * rate;
	return element.reverse
		? element.duration - element.trimEnd - offset
		: element.trimStart + offset;
}

function snapped(plan: ReturnType<typeof planFrameSnap>, id: string) {
	const element = plan.tracks
		.flatMap((item) => item.elements)
		.find((item) => item.id === id);
	if (!element) throw new Error(`no element ${id}`);
	return element as MediaElement;
}

describe("isOnFrame", () => {
	it("reads float noise as on the frame and a real offset as off it", () => {
		expect(isOnFrame({ time: 1258 / 24, fps: 24 })).toBe(true);
		expect(isOnFrame({ time: 52.416_666_7, fps: 24 })).toBe(true);
		expect(isOnFrame({ time: 52.425_333, fps: 24 })).toBe(false);
	});
});

describe("planFrameSnap", () => {
	it("moves both edges of a clip to the nearest frame and keeps what it shows in place", () => {
		// 126.2 frames from frame 100.3: the edges go to frames 100 and 227.
		const before = clip({ id: "a", start: 100.3, length: 126.2 });
		const plan = planFrameSnap({
			tracks: [track([before])],
			fps: FPS,
			isTargeted: everything,
		});
		const after = snapped(plan, "a");

		expect(after.startTime).toBeCloseTo(frames(100), 9);
		expect(after.trimStart).toBeCloseTo(2 - frames(0.3), 9);
		expect(after.trimEnd).toBeCloseTo(2 - frames(0.5), 9);
		expect(after.duration).toBe(before.duration);
		for (const time of [frames(101), frames(160), frames(226)]) {
			expect(sourceAt(after, time)).toBeCloseTo(sourceAt(before, time), 9);
		}
		expect(plan).toMatchObject({
			checked: 1,
			skipped: [],
			changed: [
				{
					trackId: "main",
					elementId: "a",
					startTime: { from: before.startTime, to: frames(100) },
					endTime: { to: frames(227) },
				},
			],
		});
	});

	it("takes the frame on the inner side where the clip has no unused source to grow into", () => {
		// The nearest frames are outwards on both sides, and neither trim has any.
		const plan = planFrameSnap({
			tracks: [
				track([
					clip({
						id: "a",
						start: 10.3,
						length: 20.5,
						trimStart: 0,
						trimEnd: 0,
					}),
				]),
			],
			fps: FPS,
			isTargeted: everything,
		});
		const after = snapped(plan, "a");
		expect(after.startTime).toBeCloseTo(frames(11), 9);
		expect(after.trimStart).toBeCloseTo(frames(0.7), 9);
		// It ended at 30.8; frame 31 needs source it does not have.
		expect(after.trimEnd).toBeCloseTo(frames(0.8), 9);
		expect(plan.skipped).toEqual([]);
	});

	it("puts a cut on one frame for the clips on both sides of it", () => {
		const a = clip({ id: "a", start: 0, length: 24.4 });
		const b = clip({ id: "b", start: 24.4, length: 24.4 });
		const c = clip({ id: "c", start: 48.8, length: 23.2 });
		const plan = planFrameSnap({
			tracks: [track([a, b, c])],
			fps: FPS,
			isTargeted: everything,
		});
		const [afterA, afterB, afterC] = ["a", "b", "c"].map((id) =>
			snapped(plan, id)
		);
		const end = (element: MediaElement) =>
			element.startTime +
			element.duration -
			element.trimStart -
			element.trimEnd;

		expect(end(afterA)).toBeCloseTo(frames(24), 9);
		expect(afterB.startTime).toBeCloseTo(frames(24), 9);
		expect(end(afterB)).toBeCloseTo(frames(49), 9);
		expect(afterC.startTime).toBeCloseTo(frames(49), 9);
		expect(end(afterC)).toBeCloseTo(frames(72), 9);
		// Nothing moved against its source.
		expect(sourceAt(afterB, frames(30))).toBeCloseTo(
			sourceAt(b, frames(30)),
			9
		);
		expect(sourceAt(afterC, frames(60))).toBeCloseTo(
			sourceAt(c, frames(60)),
			9
		);
	});

	it("moves a cut the other way when only that side has unused source", () => {
		// The cut at 24.6 is nearer frame 25, but the clip before it has no
		// source left to run on; the clip after it can start a little earlier.
		const a = clip({ id: "a", start: 0, length: 24.6, trimEnd: 0 });
		const b = clip({ id: "b", start: 24.6, length: 23.4 });
		const plan = planFrameSnap({
			tracks: [track([a, b])],
			fps: FPS,
			isTargeted: everything,
		});
		expect(snapped(plan, "b").startTime).toBeCloseTo(frames(24), 9);
		expect(snapped(plan, "b").trimStart).toBeCloseTo(2 - frames(0.6), 9);
		expect(snapped(plan, "a").trimEnd).toBeCloseTo(frames(0.6), 9);
		expect(plan.skipped).toEqual([]);
	});

	it("leaves a cut with no unused source on either side, and says so", () => {
		const a = clip({ id: "a", start: 0, length: 24.6, trimEnd: 0 });
		const b = clip({ id: "b", start: 24.6, length: 23.4, trimStart: 0 });
		const plan = planFrameSnap({
			tracks: [track([a, b])],
			fps: FPS,
			isTargeted: everything,
		});
		expect(plan.changed).toEqual([]);
		expect(plan.skipped).toEqual([
			{
				trackId: "main",
				elementId: "a",
				reason:
					"its end stays between frames: there is no unused source on either side of that cut",
			},
			{
				trackId: "main",
				elementId: "b",
				reason:
					"its start stays between frames: there is no unused source on either side of that cut",
			},
		]);
	});

	it("does not move a cut into a clip that is not being snapped", () => {
		const a = clip({ id: "a", start: 0, length: 24.4 });
		const b = clip({ id: "b", start: 24.4, length: 23.6 });
		const plan = planFrameSnap({
			tracks: [track([a, b])],
			fps: FPS,
			isTargeted: ({ element }) => element.id === "b",
		});
		expect(plan.checked).toBe(1);
		expect(plan.changed).toEqual([]);
		expect(plan.skipped).toEqual([
			{
				trackId: "main",
				elementId: "b",
				reason:
					"its start stays between frames: the clip it meets there is not being snapped",
			},
		]);
	});

	describe("two clips that meet within half a frame, but not exactly", () => {
		it("closes the gap on one frame when each clip can take it", () => {
			// A ends 0.1 before frame 24 and B starts 0.2 after it.
			const a = clip({ id: "a", start: 0, length: 23.9 });
			const b = clip({ id: "b", start: 24.2, length: 23.8 });
			const plan = planFrameSnap({
				tracks: [track([a, b])],
				fps: FPS,
				isTargeted: everything,
			});
			const [afterA, afterB] = ["a", "b"].map((id) => snapped(plan, id));
			expect(afterA.trimEnd).toBeCloseTo(2 - frames(0.1), 9);
			expect(afterB.startTime).toBeCloseTo(frames(24), 9);
			// Each trim takes up its own clip's distance, not the other's.
			expect(afterB.trimStart).toBeCloseTo(2 - frames(0.2), 9);
			expect(sourceAt(afterB, frames(30))).toBeCloseTo(
				sourceAt(b, frames(30)),
				9
			);
			expect(plan.skipped).toEqual([]);
		});

		it("brings the later clip to a cut that is on a frame already", () => {
			const a = clip({ id: "a", start: 0, length: 24 });
			const b = clip({ id: "b", start: 24.3, length: 23.7 });
			const plan = planFrameSnap({
				tracks: [track([a, b])],
				fps: FPS,
				isTargeted: everything,
			});
			expect(snapped(plan, "b").startTime).toBeCloseTo(frames(24), 9);
			expect(snapped(plan, "b").trimStart).toBeCloseTo(2 - frames(0.3), 9);
			expect(plan.changed.map((change) => change.elementId)).toEqual(["b"]);
			expect(plan.skipped).toEqual([]);
		});

		it("leaves the later clip, and says so, when it has no source before its start", () => {
			// The cut is on frame 24 for A. B would have to start 0.3 of a
			// frame earlier, and it is at the head of its file: moving it there
			// would slide what it shows.
			const a = clip({ id: "a", start: 0, length: 24 });
			const b = clip({ id: "b", start: 24.3, length: 23.7, trimStart: 0 });
			const tracks = [track([a, b])];
			const plan = planFrameSnap({
				tracks,
				fps: FPS,
				isTargeted: everything,
			});
			expect(plan.changed).toEqual([]);
			expect(plan.tracks[0]).toBe(tracks[0]);
			expect(plan.skipped).toEqual([
				{
					trackId: "main",
					elementId: "b",
					reason:
						"its start stays between frames: there is no unused source on either side of that cut",
				},
			]);
		});

		it("reports nothing for an edge that is on its frame", () => {
			// A's end is on frame 24; the clip after it starts 0.3 later and is
			// not being snapped. Only A's start has anything to do.
			const a = clip({ id: "a", start: 0.4, length: 23.6 });
			const b = clip({ id: "b", start: 24.3, length: 23.7 });
			const plan = planFrameSnap({
				tracks: [track([a, b])],
				fps: FPS,
				isTargeted: ({ element }) => element.id === "a",
			});
			expect(plan.changed).toEqual([
				{
					trackId: "main",
					elementId: "a",
					startTime: { from: frames(0.4), to: 0 },
					endTime: { from: frames(24), to: frames(24) },
				},
			]);
			expect(plan.skipped).toEqual([]);
		});
	});

	it("takes an edge a rounded time left a hair off its frame as on it", () => {
		// 1.041667 s is frame 25 written to the microsecond: a third of a
		// microsecond late. With no source before its start the clip cannot
		// move earlier, and it used to be sent a whole frame later instead.
		const before = {
			...clip({ id: "a", start: 25, length: 20.4, trimStart: 0 }),
			startTime: 1.041_667,
		};
		const plan = planFrameSnap({
			tracks: [track([before])],
			fps: FPS,
			isTargeted: everything,
		});
		const after = snapped(plan, "a");
		expect(after.startTime).toBeCloseTo(frames(25), 9);
		expect(after.trimStart).toBe(0);
		// The end, 0.4 of a frame past frame 45, goes to it.
		expect(after.trimEnd).toBeCloseTo(2 + frames(0.4), 5);
		expect(plan.skipped).toEqual([]);
	});

	it("counts a sped-up clip's trims in source seconds", () => {
		const before = clip({
			id: "fast",
			start: 10.25,
			length: 20.5,
			extra: { playbackRate: 2 },
		});
		const after = snapped(
			planFrameSnap({
				tracks: [track([before])],
				fps: FPS,
				isTargeted: everything,
			}),
			"fast"
		);
		expect(after.startTime).toBeCloseTo(frames(10), 9);
		expect(after.trimStart).toBeCloseTo(2 - frames(0.25) * 2, 9);
		expect(sourceAt(after, frames(20))).toBeCloseTo(
			sourceAt(before, frames(20)),
			9
		);
	});

	it("takes the difference from the other trim of a clip played backwards", () => {
		const before = clip({
			id: "back",
			start: 10.3,
			length: 20.2,
			extra: { reverse: true },
		});
		const after = snapped(
			planFrameSnap({
				tracks: [track([before])],
				fps: FPS,
				isTargeted: everything,
			}),
			"back"
		);
		expect(after.startTime).toBeCloseTo(frames(10), 9);
		expect(after.trimEnd).toBeCloseTo(2 - frames(0.3), 9);
		expect(sourceAt(after, frames(20))).toBeCloseTo(
			sourceAt(before, frames(20)),
			9
		);
	});

	it("gives a title or a picture its new length outright", () => {
		const title = {
			id: "title",
			type: "text",
			name: "Title",
			content: "Hello",
			startTime: frames(5.4),
			duration: frames(47.9),
			trimStart: 0,
			trimEnd: 0,
		} as unknown as TextElement;
		const picture = clip({
			id: "still",
			start: 60.3,
			length: 30.4,
			trimStart: 0,
			trimEnd: 0,
		});
		const plan = planFrameSnap({
			tracks: [track([title], "titles"), track([picture])],
			fps: FPS,
			isTargeted: everything,
			isStill: (element) => element.id === "still",
		});
		expect(snapped(plan, "title")).toMatchObject({
			startTime: frames(5),
			duration: expect.closeTo(frames(48), 9),
		});
		// 60.3 to 90.7: frames 60 and 91, with no source to run out of.
		expect(snapped(plan, "still")).toMatchObject({
			startTime: frames(60),
			duration: expect.closeTo(frames(31), 9),
		});
	});

	it("leaves a clip with a speed curve or a freeze frame, and says why", () => {
		const plan = planFrameSnap({
			tracks: [
				track([
					clip({
						id: "ramp",
						start: 0.5,
						length: 24,
						extra: {
							speedKeyframes: [
								{ frame: 0, value: 1 },
								{ frame: 12, value: 2 },
							] as MediaElement["speedKeyframes"],
						},
					}),
				]),
			],
			fps: FPS,
			isTargeted: everything,
		});
		expect(plan.changed).toEqual([]);
		expect(plan.skipped).toHaveLength(1);
		expect(plan.skipped[0].reason).toBe(
			"it has a speed curve, so its trims cannot take up the difference"
		);
	});

	it("leaves a clip with a freeze frame for the same reason", () => {
		const plan = planFrameSnap({
			tracks: [
				track([
					clip({
						id: "held",
						start: 0.5,
						length: 24,
						extra: { freezeFrameDuration: 0.5 },
					}),
				]),
			],
			fps: FPS,
			isTargeted: everything,
		});
		expect(plan.changed).toEqual([]);
		expect(plan.skipped.map(({ reason }) => reason)).toEqual([
			"it has a freeze frame, so its trims cannot take up the difference",
		]);
	});

	it("leaves a clip its frames would close up on, and says so", () => {
		// From 10.6 to 11.4 with no source to grow into: both edges go inwards
		// to frame 11, which leaves nothing.
		const sliver = clip({
			id: "sliver",
			start: 10.6,
			length: 0.8,
			trimStart: 0,
			trimEnd: 0,
		});
		const tracks = [track([sliver])];
		const plan = planFrameSnap({ tracks, fps: FPS, isTargeted: everything });
		expect(plan.changed).toEqual([]);
		expect(plan.tracks[0]).toBe(tracks[0]);
		expect(plan.skipped).toEqual([
			{
				trackId: "main",
				elementId: "sliver",
				reason: "it would be left shorter than a frame",
			},
		]);
	});

	it("changes nothing when every edge is on a frame already", () => {
		const tracks = [
			track([
				clip({ id: "a", start: 0, length: 24 }),
				clip({ id: "b", start: 24, length: 48 }),
			]),
		];
		const plan = planFrameSnap({ tracks, fps: FPS, isTargeted: everything });
		expect(plan).toMatchObject({ checked: 2, changed: [], skipped: [] });
		expect(plan.tracks[0]).toBe(tracks[0]);
	});
});

describe("findOffFrameElements", () => {
	it("lists the clips with an edge between frames", () => {
		expect(
			findOffFrameElements({
				tracks: [
					track([
						clip({ id: "on", start: 0, length: 24 }),
						clip({ id: "off", start: 24, length: 24.4 }),
					]),
				],
				fps: FPS,
			})
		).toEqual([
			{
				trackId: "main",
				elementId: "off",
				startTime: frames(24),
				endTime: expect.closeTo(frames(48.4), 9),
			},
		]);
	});
});
