import { describe, expect, it } from "vitest";
import {
	CANVAS_PLAYBACK_SEGMENT_SECONDS,
	createCanvasPlaybackWindow,
} from "../canvas-playback-window";

const portrait = { width: 1080, height: 1920, fps: 30, frames: 108_000 };

describe("rolling playback frame windows", () => {
	it("reserves bounded portrait segments independent of timeline length", () => {
		const maxBytes = 2 * 1024 ** 3;
		const window = createCanvasPlaybackWindow({ ...portrait, maxBytes });
		const frameReservation =
			Math.ceil(portrait.width * portrait.height * 4 * 1.01) + 65_536;
		expect(CANVAS_PLAYBACK_SEGMENT_SECONDS).toBe(2);
		expect(window.segmentFrames).toBe(60);
		expect(window.segmentFrames * 3 * frameReservation).toBeLessThanOrEqual(
			maxBytes
		);
		expect(window.at({ frame: 3600 })).toEqual({
			start: 3540,
			end: 3720,
			segments: [60, 61],
		});
	});

	it("retains a previous segment without scheduling its recomputation", () => {
		const window = createCanvasPlaybackWindow({
			...portrait,
			maxBytes: 2 * 1024 ** 3,
		});
		expect(window.at({ frame: 0 })).toEqual({
			start: 0,
			end: 120,
			segments: [0, 1],
		});
		expect(window.at({ frame: 60 })).toEqual({
			start: 0,
			end: 180,
			segments: [1, 2],
		});
	});

	it("shrinks 4K segment duration to fit the same worst-case byte budget", () => {
		const width = 3840;
		const height = 2160;
		const maxBytes = 2 * 1024 ** 3;
		const reservation = Math.ceil(width * height * 4 * 1.01) + 65_536;
		const window = createCanvasPlaybackWindow({
			...portrait,
			width,
			height,
			maxBytes,
		});
		expect(window.segmentFrames).toBe(Math.floor(maxBytes / (3 * reservation)));
		expect(window.segmentFrames).toBeLessThan(60);
		expect(window.segmentFrames * 3 * reservation).toBeLessThanOrEqual(
			maxBytes
		);
	});

	it("rounds fractional frame rates upward and clips the tail segment", () => {
		const window = createCanvasPlaybackWindow({
			width: 2,
			height: 2,
			fps: 29.97,
			frames: 123,
			maxBytes: 2 * 1024 ** 3,
		});
		expect(window.segmentFrames).toBe(60);
		expect(window.range({ index: 2 })).toEqual({ start: 120, end: 123 });
		expect(window.at({ frame: 122 })).toEqual({
			start: 60,
			end: 123,
			segments: [2],
		});
	});

	it("supports a one-frame clip without scheduling another segment", () => {
		const window = createCanvasPlaybackWindow({
			...portrait,
			frames: 1,
			maxBytes: 2 * 1024 ** 3,
		});
		expect(window.segmentFrames).toBe(1);
		expect(window.at({ frame: 0 })).toEqual({
			start: 0,
			end: 1,
			segments: [0],
		});
	});

	it("rejects a budget that cannot contain even the smallest rolling window", () => {
		const reservation =
			Math.ceil(portrait.width * portrait.height * 4 * 1.01) + 65_536;
		expect(() =>
			createCanvasPlaybackWindow({ ...portrait, maxBytes: reservation * 3 - 1 })
		).toThrow("cannot hold a rolling frame window");
	});

	it.each([
		{ width: 0 },
		{ height: -1 },
		{ fps: Number.NaN },
		{ fps: 0 },
		{ frames: 1.5 },
		{ maxBytes: Number.POSITIVE_INFINITY },
	])("rejects invalid dimensions or budget %o", (invalid) => {
		expect(() =>
			createCanvasPlaybackWindow({
				...portrait,
				maxBytes: 2 * 1024 ** 3,
				...invalid,
			})
		).toThrow("Invalid rolling playback dimensions or budget");
	});
});
