import { describe, expect, it } from "vitest";
import type { AdjustmentLayer } from "../claude/handlers/claude-export-handler/adjustment-layer-pass.js";
import { planConcatSpans } from "../claude/handlers/claude-export-handler/concat-timing.js";
import type { PictureLayers } from "../claude/handlers/claude-export-handler/export-range.js";
import type { ConcatEntry } from "../claude/handlers/claude-export-handler/gap-segments.js";
import {
	layersInPictureWindow,
	overlayCanBeCut,
	planPictureWindow,
	rangeInPictureWindow,
	segmentsInPictureWindow,
} from "../claude/handlers/claude-export-handler/picture-window.js";
import { runIndependently } from "../claude/handlers/claude-export-handler/task-pool.js";
import type {
	ExportSegment,
	StickerOverlay,
	TextOverlay,
} from "../claude/handlers/claude-export-handler/types.js";
import { DEFAULT_VIDEO_COLOR_SETTINGS } from "../ffmpeg/color-settings.js";

const FPS = 24;

/** A film of `count` clips of `seconds` each, with an optional gap file. */
function film({
	count,
	seconds,
	gapAfter,
}: {
	count: number;
	seconds: number;
	/** A one-second gap after the clip at this position. */
	gapAfter?: number;
}) {
	const entries: ConcatEntry[] = [];
	let time = 0;
	for (let index = 0; index < count; index += 1) {
		entries.push({
			kind: "segment",
			index,
			startTime: time,
			endTime: time + seconds,
		});
		time += seconds;
		if (gapAfter === index) {
			entries.push({
				kind: "gap",
				index: 0,
				startTime: time,
				endTime: time + 1,
			});
			time += 1;
		}
	}
	return {
		entries,
		spans: planConcatSpans({ inputs: entries, fps: FPS, sampleRate: 48_000 }),
	};
}

const NO_LAYERS: PictureLayers = {
	mediaOverlays: [],
	stickerOverlays: [],
	textOverlays: [],
	jianyingTextOverlays: [],
	adjustmentLayers: [],
};

function overlay(extra: Partial<ExportSegment> = {}): ExportSegment {
	return {
		elementId: "vignette",
		trackId: "vignette",
		trackOrder: 0,
		elementOrder: 0,
		sourcePath: "/media/vignette.mov",
		sourceId: "vignette",
		startTime: 8,
		duration: 280,
		trimStart: 2,
		fitMode: "cover",
		...extra,
	};
}

function grade(extra: Partial<AdjustmentLayer> = {}): AdjustmentLayer {
	return {
		elementId: "grade",
		trackOrder: 1,
		startTime: 0,
		endTime: 300,
		color: structuredClone(DEFAULT_VIDEO_COLOR_SETTINGS),
		opacity: 1,
		aboveOverlays: false,
		...extra,
	};
}

describe("the picture window of a range export", () => {
	const { entries, spans } = film({ count: 150, seconds: 2 });

	it("holds the clips the range touches, and starts where the first of them does", () => {
		const window = planPictureWindow({
			range: { start: 101, end: 103 },
			entries,
			spans,
			layers: NO_LAYERS,
			fps: FPS,
		});
		// Clips 50 (100–102 s) and 51 (102–104 s) of 150.
		expect(window).toEqual({
			first: 50,
			last: 51,
			firstFrame: 2400,
			start: 100,
			frames: 96,
			duration: 4,
		});
		expect(
			segmentsInPictureWindow({ window: window as never, entries })
		).toEqual(new Set([50, 51]));
	});

	it("is one clip for a range inside it, and ends with the clip the range ends in", () => {
		expect(
			planPictureWindow({
				range: { start: 100.5, end: 101.5 },
				entries,
				spans,
				layers: NO_LAYERS,
				fps: FPS,
			})
		).toMatchObject({ first: 50, last: 50, frames: 48 });
		// A range that ends on a cut does not take the clip after the cut.
		expect(
			planPictureWindow({
				range: { start: 100, end: 102 },
				entries,
				spans,
				layers: NO_LAYERS,
				fps: FPS,
			})
		).toMatchObject({ first: 50, last: 50 });
	});

	it("counts a gap as part of the picture", () => {
		const withGap = film({ count: 6, seconds: 2, gapAfter: 2 });
		// Clips at 0–2, 2–4, 4–6, a gap 6–7, clips at 7–9, 9–11, 11–13.
		const window = planPictureWindow({
			range: { start: 6.5, end: 8 },
			entries: withGap.entries,
			spans: withGap.spans,
			layers: NO_LAYERS,
			fps: FPS,
		});
		expect(window).toMatchObject({ first: 3, last: 4, start: 6, frames: 72 });
		expect(
			segmentsInPictureWindow({
				window: window as never,
				entries: withGap.entries,
			})
		).toEqual(new Set([3]));
	});

	it("is not used when the range touches every clip", () => {
		const short = film({ count: 3, seconds: 2 });
		expect(
			planPictureWindow({
				range: { start: 1, end: 5 },
				entries: short.entries,
				spans: short.spans,
				layers: NO_LAYERS,
				fps: FPS,
			})
		).toBeUndefined();
	});

	it("keeps its start for an overlay that looks the same whenever it is started from", () => {
		const layers = { ...NO_LAYERS, mediaOverlays: [overlay()] };
		expect(
			planPictureWindow({
				range: { start: 101, end: 103 },
				entries,
				spans,
				layers,
				fps: FPS,
			})
		).toMatchObject({ first: 50, start: 100 });
	});

	it("starts at an overlay that moves or changes over its length", () => {
		for (const moving of [
			overlay({
				startTime: 95,
				keyframes: { opacity: [{ frame: 0 }] } as never,
			}),
			overlay({
				startTime: 95,
				transform: {
					x: 0,
					y: 0,
					rotationDegrees: 0,
					scaleX: 1,
					scaleY: 1,
					opacity: 1,
					xKeyframes: [{ timeSeconds: 0, value: 4 }],
				},
			}),
			overlay({ startTime: 95, frameInterpolation: "blend" }),
		]) {
			expect(overlayCanBeCut({ overlay: moving })).toBe(false);
			// Second 95 is in clip 47 (94–96 s).
			expect(
				planPictureWindow({
					range: { start: 101, end: 103 },
					entries,
					spans,
					layers: { ...NO_LAYERS, mediaOverlays: [moving] },
					fps: FPS,
				})
			).toMatchObject({ first: 47, last: 51, start: 94 });
		}
		expect(overlayCanBeCut({ overlay: overlay() })).toBe(true);
		expect(
			overlayCanBeCut({ overlay: overlay({ keyframes: { opacity: [] } }) })
		).toBe(true);
	});

	it("starts at a sticker or a text that began before the range", () => {
		const sticker = { startTime: 99, endTime: 102 } as StickerOverlay;
		const text = { startTime: 97.5, endTime: 101.5 } as TextOverlay;
		expect(
			planPictureWindow({
				range: { start: 101, end: 103 },
				entries,
				spans,
				layers: { ...NO_LAYERS, stickerOverlays: [sticker] },
				fps: FPS,
			})
		).toMatchObject({ first: 49, start: 98 });
		expect(
			planPictureWindow({
				range: { start: 101, end: 103 },
				entries,
				spans,
				layers: { ...NO_LAYERS, textOverlays: [text] },
				fps: FPS,
			})
		).toMatchObject({ first: 48, start: 96 });
	});

	it("leaves a range with a keyframed grade to the whole picture", () => {
		const color = structuredClone(DEFAULT_VIDEO_COLOR_SETTINGS);
		(color as { keyframes?: unknown }).keyframes = {
			saturation: [{ frame: 0, value: 0 }],
		};
		expect(
			planPictureWindow({
				range: { start: 101, end: 103 },
				entries,
				spans,
				layers: { ...NO_LAYERS, adjustmentLayers: [grade({ color })] },
				fps: FPS,
			})
		).toBeUndefined();
		expect(
			planPictureWindow({
				range: { start: 101, end: 103 },
				entries,
				spans,
				layers: { ...NO_LAYERS, adjustmentLayers: [grade()] },
				fps: FPS,
			})
		).toMatchObject({ first: 50 });
	});
});

describe("layers as the window's picture has them", () => {
	const window = {
		first: 50,
		last: 51,
		firstFrame: 2400,
		start: 100,
		frames: 96,
		duration: 4,
	};

	it("cuts an overlay that began before the window and reads it from the matching instant", () => {
		const [cut, later, still] = layersInPictureWindow({
			layers: {
				...NO_LAYERS,
				mediaOverlays: [
					// Began at 8 s, two seconds into its file: 92 s have played.
					overlay(),
					overlay({ elementId: "late", startTime: 101, duration: 5 }),
					overlay({
						elementId: "still",
						isImage: true,
						startTime: 0,
						duration: 300,
						trimStart: 0,
					}),
				],
			},
			window,
		}).mediaOverlays;
		expect(cut).toMatchObject({ startTime: 0, duration: 188, trimStart: 94 });
		expect(later).toMatchObject({ startTime: 1, duration: 5, trimStart: 2 });
		expect(still).toMatchObject({ startTime: 0, duration: 200, trimStart: 0 });
	});

	it("reads a retimed overlay as far into its file as it has played", () => {
		const [cut] = layersInPictureWindow({
			layers: {
				...NO_LAYERS,
				mediaOverlays: [overlay({ startTime: 90, playbackRate: 2 })],
			},
			window,
		}).mediaOverlays;
		// Ten seconds of the timeline at double speed are twenty of the file.
		expect(cut).toMatchObject({ startTime: 0, duration: 270, trimStart: 22 });
	});

	it("moves every other layer back by the window's start, below zero if need be", () => {
		const moved = layersInPictureWindow({
			layers: {
				...NO_LAYERS,
				adjustmentLayers: [grade({ startTime: 40, endTime: 102.5 })],
				stickerOverlays: [{ startTime: 100.5, endTime: 101 } as StickerOverlay],
				textOverlays: [{ startTime: 101, endTime: 103 } as TextOverlay],
			},
			window,
		});
		expect(moved.adjustmentLayers[0]).toMatchObject({
			startTime: -60,
			endTime: 2.5,
		});
		expect(moved.stickerOverlays[0]).toMatchObject({
			startTime: 0.5,
			endTime: 1,
		});
		expect(moved.textOverlays[0]).toMatchObject({ startTime: 1, endTime: 3 });
		expect(
			rangeInPictureWindow({ range: { start: 101, end: 103 }, window })
		).toEqual({ start: 1, end: 3 });
	});
});

describe("steps that do not wait for one another", () => {
	it("runs them a few at a time and waits for all", async () => {
		let running = 0;
		let most = 0;
		const done: number[] = [];
		await runIndependently({
			limit: 3,
			tasks: Array.from({ length: 10 }, (_, index) => async () => {
				running += 1;
				most = Math.max(most, running);
				await new Promise((resolve) => setTimeout(resolve, 5));
				running -= 1;
				done.push(index);
			}),
		});
		expect(most).toBe(3);
		expect(done.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it("starts nothing more after a failure, waits for what runs, and throws the first failure", async () => {
		const started: number[] = [];
		let finished = 0;
		const run = runIndependently({
			limit: 2,
			tasks: Array.from({ length: 6 }, (_, index) => async () => {
				started.push(index);
				await new Promise((resolve) =>
					setTimeout(resolve, index === 0 ? 1 : 15)
				);
				if (index === 0) throw new Error("clip 0 could not be encoded");
				finished += 1;
			}),
		});
		await expect(run).rejects.toThrow("clip 0 could not be encoded");
		// The one that was running beside it was waited for.
		expect(started).toEqual([0, 1]);
		expect(finished).toBe(1);
	});

	it("does nothing for no steps", async () => {
		await expect(runIndependently({ tasks: [] })).resolves.toBeUndefined();
	});
});
