// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	type BeautyLabFaceBox,
	createBeautyLabFaceTracker,
	faceBoxIoU,
} from "../beauty-lab/beauty-lab-video-face-tracks.js";

function box(x: number, y = 0.2, size = 0.2): BeautyLabFaceBox {
	return { x, y, width: size, height: size };
}

function tracker(
	options: Partial<Parameters<typeof createBeautyLabFaceTracker>[0]> = {}
) {
	return createBeautyLabFaceTracker({
		minIoU: 0.3,
		maxMissedFrames: 2,
		maxTracks: 4,
		...options,
	});
}

describe("face box overlap", () => {
	it("computes intersection over union", () => {
		expect(faceBoxIoU({ left: box(0.1), right: box(0.1) })).toBe(1);
		expect(faceBoxIoU({ left: box(0.1), right: box(0.5) })).toBe(0);
		expect(
			faceBoxIoU({ left: box(0, 0, 0.2), right: box(0.1, 0, 0.2) })
		).toBeCloseTo(1 / 3);
	});
});

describe("stable face identities", () => {
	it("keeps IDs while faces move and only resets new tracks", () => {
		const faces = tracker();
		const first = faces.update({
			generation: 0,
			frameNumber: 0,
			detections: [box(0.1), box(0.6)],
		});
		expect(first.assignments).toEqual([
			{ trackId: 1, detection: 0, isNew: true, resetTemporalState: true },
			{ trackId: 2, detection: 1, isNew: true, resetTemporalState: true },
		]);
		const second = faces.update({
			generation: 0,
			frameNumber: 1,
			detections: [box(0.62), box(0.12)],
		});
		expect(second.assignments).toEqual([
			{ trackId: 2, detection: 0, isNew: false, resetTemporalState: false },
			{ trackId: 1, detection: 1, isNew: false, resetTemporalState: false },
		]);
		expect(second.ended).toEqual([]);
	});
	it("keeps an occluded face within the grace period but restarts its state", () => {
		const faces = tracker();
		faces.update({ generation: 0, frameNumber: 0, detections: [box(0.1)] });
		faces.update({ generation: 0, frameNumber: 1, detections: [] });
		faces.update({ generation: 0, frameNumber: 2, detections: [] });
		const back = faces.update({
			generation: 0,
			frameNumber: 3,
			detections: [box(0.11)],
		});
		expect(back.assignments).toEqual([
			{ trackId: 1, detection: 0, isNew: false, resetTemporalState: true },
		]);
	});
	it("restarts state when frames were skipped within the grace period", () => {
		const faces = tracker();
		faces.update({ generation: 0, frameNumber: 0, detections: [box(0.1)] });
		const back = faces.update({
			generation: 0,
			frameNumber: 3,
			detections: [box(0.1)],
		});
		expect(back.ended).toEqual([]);
		expect(back.assignments).toEqual([
			{ trackId: 1, detection: 0, isNew: false, resetTemporalState: true },
		]);
	});
	it("retires a track whose skipped frames exceed the grace period", () => {
		const faces = tracker();
		faces.update({ generation: 0, frameNumber: 0, detections: [box(0.1)] });
		const back = faces.update({
			generation: 0,
			frameNumber: 4,
			detections: [box(0.1)],
		});
		expect(back.ended).toEqual([1]);
		expect(back.assignments).toEqual([
			{ trackId: 2, detection: 0, isNew: true, resetTemporalState: true },
		]);
		expect(faces.activeTrackIds()).toEqual([2]);
	});
	it("matches every eligible face before reporting overflow", () => {
		const faces = tracker({ maxTracks: 2 });
		faces.update({
			generation: 0,
			frameNumber: 0,
			detections: [box(0.2), box(0.32)],
		});
		// Greedy overlap alone gives detection 0 to track 1, stranding track 2
		// (which only overlaps detection 0) and overflowing detection 1.
		const result = faces.update({
			generation: 0,
			frameNumber: 1,
			detections: [box(0.23), box(0.13)],
		});
		expect(result.overflow).toBe(0);
		expect(result.ended).toEqual([]);
		expect(result.assignments).toEqual([
			{ trackId: 2, detection: 0, isNew: false, resetTemporalState: false },
			{ trackId: 1, detection: 1, isNew: false, resetTemporalState: false },
		]);
	});
	it("keeps the best overlap when no re-route is needed", () => {
		const faces = tracker({ maxTracks: 2 });
		faces.update({
			generation: 0,
			frameNumber: 0,
			detections: [box(0.2), box(0.32)],
		});
		const result = faces.update({
			generation: 0,
			frameNumber: 1,
			detections: [box(0.21), box(0.33)],
		});
		expect(result.assignments).toEqual([
			{ trackId: 1, detection: 0, isNew: false, resetTemporalState: false },
			{ trackId: 2, detection: 1, isNew: false, resetTemporalState: false },
		]);
	});
	it("retires a face after the grace period and never reuses its ID", () => {
		const faces = tracker({ maxMissedFrames: 1 });
		faces.update({ generation: 0, frameNumber: 0, detections: [box(0.1)] });
		faces.update({ generation: 0, frameNumber: 1, detections: [] });
		const gone = faces.update({
			generation: 0,
			frameNumber: 2,
			detections: [],
		});
		expect(gone.ended).toEqual([1]);
		const back = faces.update({
			generation: 0,
			frameNumber: 3,
			detections: [box(0.1)],
		});
		expect(back.assignments[0]).toMatchObject({ trackId: 2, isNew: true });
	});
	it("retires every track on a new generation and keeps numbering forward", () => {
		const faces = tracker();
		faces.update({
			generation: 0,
			frameNumber: 5,
			detections: [box(0.1), box(0.6)],
		});
		const seek = faces.update({
			generation: 1,
			frameNumber: 0,
			detections: [box(0.1)],
		});
		expect(seek.ended).toEqual([1, 2]);
		expect(seek.assignments[0]).toMatchObject({ trackId: 3, isNew: true });
		expect(faces.activeTrackIds()).toEqual([3]);
	});
	it("rejects repeated frames and backwards generations", () => {
		const faces = tracker();
		faces.update({ generation: 2, frameNumber: 4, detections: [] });
		expect(() =>
			faces.update({ generation: 2, frameNumber: 4, detections: [] })
		).toThrow(/increase/);
		expect(() =>
			faces.update({ generation: 1, frameNumber: 9, detections: [] })
		).toThrow(/backwards/);
	});
	it("caps simultaneous tracks and reports overflow", () => {
		const faces = tracker({ maxTracks: 2 });
		const result = faces.update({
			generation: 0,
			frameNumber: 0,
			detections: [box(0), box(0.3), box(0.6)],
		});
		expect(result.assignments.map((row) => row.trackId)).toEqual([1, 2]);
		expect(result.overflow).toBe(1);
	});
	it("breaks equal overlaps deterministically by track then detection", () => {
		const faces = tracker();
		faces.update({ generation: 0, frameNumber: 0, detections: [box(0.4)] });
		const result = faces.update({
			generation: 0,
			frameNumber: 1,
			detections: [box(0.45), box(0.35)],
		});
		expect(result.assignments).toEqual([
			{ trackId: 1, detection: 0, isNew: false, resetTemporalState: false },
			{ trackId: 2, detection: 1, isNew: true, resetTemporalState: true },
		]);
	});
	it.each([
		{ x: -0.1, y: 0, width: 0.2, height: 0.2 },
		{ x: 0.9, y: 0, width: 0.2, height: 0.2 },
		{ x: 0, y: 0, width: 0, height: 0.2 },
		{ x: Number.NaN, y: 0, width: 0.2, height: 0.2 },
	])("rejects invalid box %j", (bad) => {
		expect(() =>
			tracker().update({ generation: 0, frameNumber: 0, detections: [bad] })
		).toThrow(/input/);
	});
	it.each([
		{ minIoU: 0 },
		{ minIoU: 1 },
		{ maxMissedFrames: -1 },
		{ maxTracks: 0 },
		{ maxTracks: 17 },
	])("rejects invalid options %j", (options) => {
		expect(() => tracker(options)).toThrow(/options/);
	});
});
