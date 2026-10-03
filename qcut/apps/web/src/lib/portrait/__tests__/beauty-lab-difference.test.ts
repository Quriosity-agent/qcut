import { describe, expect, it } from "vitest";
import {
	compareBeautyLabFrames,
	validateBeautyLabFrame,
	type BeautyLabFrame,
} from "../beauty-lab-difference";

function makeFrame({
	rgba = [10, 20, 30, 255],
	width = rgba.length / 4,
	height = 1,
	name = "frame",
}: {
	rgba?: number[];
	width?: number;
	height?: number;
	name?: string;
} = {}): BeautyLabFrame {
	return { name, width, height, rgba: new Uint8Array(rgba) };
}

describe("compareBeautyLabFrames", () => {
	it("returns opaque black and zero metrics for identical pixels", () => {
		const reference = makeFrame({ name: "original" });
		const result = compareBeautyLabFrames({
			reference,
			candidate: makeFrame({ name: "native" }),
			gain: 32,
		});
		expect(result).toEqual({
			difference: {
				name: "original -> native",
				width: 1,
				height: 1,
				rgba: new Uint8Array([0, 0, 0, 255]),
			},
			metrics: {
				changedPixels: 0,
				pixelCount: 1,
				rgbMae: 0,
				rgbMax: 0,
				alphaMax: 0,
			},
		});
		expect(result.difference.rgba).not.toBe(reference.rgba);
	});

	it("uses max absolute RGB per pixel, not channel sum or luminance", () => {
		const result = compareBeautyLabFrames({
			reference: makeFrame({ rgba: [10, 20, 30, 255, 100, 120, 140, 90] }),
			candidate: makeFrame({ rgba: [12, 17, 35, 250, 100, 120, 140, 90] }),
			gain: 4,
		});
		expect(Array.from(result.difference.rgba)).toEqual([
			20, 20, 20, 255, 0, 0, 0, 255,
		]);
		expect(result.metrics).toEqual({
			changedPixels: 1,
			pixelCount: 2,
			rgbMae: 10 / 6,
			rgbMax: 5,
			alphaMax: 5,
		});
	});

	it("counts alpha-only changes while keeping the RGB difference black", () => {
		const result = compareBeautyLabFrames({
			reference: makeFrame({ rgba: [10, 20, 30, 0, 10, 20, 30, 255] }),
			candidate: makeFrame({ rgba: [10, 20, 30, 255, 10, 20, 30, 200] }),
			gain: 32,
		});
		expect(Array.from(result.difference.rgba)).toEqual([
			0, 0, 0, 255, 0, 0, 0, 255,
		]);
		expect(result.metrics).toEqual({
			changedPixels: 2,
			pixelCount: 2,
			rgbMae: 0,
			rgbMax: 0,
			alphaMax: 255,
		});
	});

	it("includes hidden RGB bytes rather than premultiplying by alpha", () => {
		const result = compareBeautyLabFrames({
			reference: makeFrame({ rgba: [0, 0, 0, 0] }),
			candidate: makeFrame({ rgba: [255, 0, 0, 0] }),
			gain: 1,
		});
		expect(result.metrics).toEqual({
			changedPixels: 1,
			pixelCount: 1,
			rgbMae: 85,
			rgbMax: 255,
			alphaMax: 0,
		});
		expect(Array.from(result.difference.rgba)).toEqual([255, 255, 255, 255]);
	});

	it("applies shared gain and clips only display bytes, never the metrics", () => {
		const reference = makeFrame({ rgba: [0, 0, 0, 0, 0, 0, 0, 0] });
		const candidate = makeFrame({ rgba: [2, 3, 4, 7, 200, 10, 0, 20] });
		const low = compareBeautyLabFrames({ reference, candidate, gain: 1 });
		const high = compareBeautyLabFrames({ reference, candidate, gain: 32 });
		expect(Array.from(low.difference.rgba)).toEqual([
			4, 4, 4, 255, 200, 200, 200, 255,
		]);
		expect(Array.from(high.difference.rgba)).toEqual([
			128, 128, 128, 255, 255, 255, 255, 255,
		]);
		expect(low.metrics).toEqual(high.metrics);
		expect(high.metrics.rgbMax).toBe(200);
	});

	it("does not independently normalize comparison pairs", () => {
		const reference = makeFrame({ rgba: [0, 0, 0, 255] });
		const near = compareBeautyLabFrames({
			reference,
			candidate: makeFrame({ rgba: [1, 0, 0, 255] }),
			gain: 4,
		});
		const far = compareBeautyLabFrames({
			reference,
			candidate: makeFrame({ rgba: [8, 0, 0, 255] }),
			gain: 4,
		});
		expect(near.difference.rgba[0]).toBe(4);
		expect(far.difference.rgba[0]).toBe(32);
	});

	it("does not mutate frame objects or byte-offset views of shared buffers", () => {
		const backing = new Uint8Array([
			99, 10, 20, 30, 255, 98, 12, 25, 28, 240, 97,
		]);
		const reference = Object.freeze({
			name: "reference",
			width: 1,
			height: 1,
			rgba: backing.subarray(1, 5),
		});
		const candidate = Object.freeze({
			name: "candidate",
			width: 1,
			height: 1,
			rgba: backing.subarray(6, 10),
		});
		const snapshot = backing.slice();
		const forward = compareBeautyLabFrames({ reference, candidate, gain: 2 });
		const backward = compareBeautyLabFrames({
			reference: candidate,
			candidate: reference,
			gain: 2,
		});
		expect(forward.metrics).toEqual(backward.metrics);
		expect(forward.difference.rgba).toEqual(backward.difference.rgba);
		expect(backing).toEqual(snapshot);
		forward.difference.rgba.fill(0);
		expect(backing).toEqual(snapshot);
		expect(reference.name).toBe("reference");
		expect(candidate.name).toBe("candidate");
	});

	it.each([
		{ missing: "reference" },
		{ missing: "candidate" },
	])("rejects a missing $missing", ({ missing }) => {
		const frame = makeFrame();
		expect(() =>
			compareBeautyLabFrames({
				reference:
					missing === "reference" ? (null as unknown as BeautyLabFrame) : frame,
				candidate:
					missing === "candidate" ? (null as unknown as BeautyLabFrame) : frame,
				gain: 1,
			})
		).toThrow(TypeError);
	});

	it.each([
		{ width: 1, height: 2 },
		{ width: 3, height: 1 },
	])("rejects mismatched dimensions without rescaling: $width x $height", ({
		width,
		height,
	}) => {
		expect(() =>
			compareBeautyLabFrames({
				reference: makeFrame({
					rgba: new Array(8).fill(0),
					width: 2,
					height: 1,
				}),
				candidate: makeFrame({
					rgba: new Array(width * height * 4).fill(0),
					width,
					height,
				}),
				gain: 1,
			})
		).toThrow("same dimensions");
	});

	it.each([
		{ gain: 0 },
		{ gain: -1 },
		{ gain: 33 },
		{ gain: 1.5 },
		{ gain: Number.NaN },
		{ gain: Number.POSITIVE_INFINITY },
		{ gain: "2" as unknown as number },
		{ gain: null as unknown as number },
	])("rejects invalid gain $gain", ({ gain }) => {
		const frame = makeFrame();
		expect(() =>
			compareBeautyLabFrames({ reference: frame, candidate: frame, gain })
		).toThrow("gain must be an integer from 1 to 32");
	});

	it.each([{ gain: 1 }, { gain: 32 }])("accepts gain bound $gain", ({
		gain,
	}) => {
		const frame = makeFrame();
		expect(() =>
			compareBeautyLabFrames({ reference: frame, candidate: frame, gain })
		).not.toThrow();
	});
});

describe("Beauty Lab frame validation", () => {
	it.each([
		{ dimension: 0 },
		{ dimension: -1 },
		{ dimension: 1.5 },
		{ dimension: 4097 },
		{ dimension: Number.MAX_SAFE_INTEGER },
		{ dimension: Number.NaN },
		{ dimension: Number.POSITIVE_INFINITY },
		{ dimension: "1" as unknown as number },
		{ dimension: null as unknown as number },
	])("rejects invalid dimension $dimension on both axes", ({ dimension }) => {
		for (const axis of ["width", "height"]) {
			const invalid = { ...makeFrame(), [axis]: dimension };
			expect(() => validateBeautyLabFrame({ frame: invalid })).toThrow(
				RangeError
			);
			for (const side of ["reference", "candidate"]) {
				expect(() =>
					compareBeautyLabFrames({
						reference: makeFrame(),
						candidate: makeFrame(),
						[side]: invalid,
						gain: 1,
					})
				).toThrow(RangeError);
			}
		}
	});

	it("accepts 4096 on either axis with the exact byte count", () => {
		for (const dimensions of [
			{ width: 4096, height: 1 },
			{ width: 1, height: 4096 },
		]) {
			const frame = {
				name: "boundary",
				...dimensions,
				rgba: new Uint8Array(4096 * 4),
			};
			expect(() => validateBeautyLabFrame({ frame })).not.toThrow();
		}
	});

	it("rejects oversized pixel allocations before checking data", () => {
		expect(() =>
			validateBeautyLabFrame({
				frame: {
					name: "oversize",
					width: 4096,
					height: 4097,
					rgba: new Uint8Array(0),
				},
			})
		).toThrow("dimensions");
	});

	it.each([
		{ length: 0 },
		{ length: 3 },
		{ length: 5 },
		{ length: 8 },
	])("requires exactly four bytes per pixel, not $length", ({ length }) => {
		expect(() =>
			validateBeautyLabFrame({
				frame: { ...makeFrame(), rgba: new Uint8Array(length) },
			})
		).toThrow("byte count");
	});

	it.each([
		{ rgba: [10, 20, 30, 255] },
		{ rgba: new Uint8ClampedArray(4) },
		{ rgba: new Float32Array(4) },
		{ rgba: new ArrayBuffer(4) },
		{ rgba: null },
	])("rejects non-Uint8Array RGBA storage: $rgba", ({ rgba }) => {
		expect(() =>
			validateBeautyLabFrame({
				frame: { ...makeFrame(), rgba } as unknown as BeautyLabFrame,
			})
		).toThrow(TypeError);
	});

	it("requires a typed name", () => {
		expect(() =>
			validateBeautyLabFrame({
				frame: { ...makeFrame(), name: 123 } as unknown as BeautyLabFrame,
			})
		).toThrow(TypeError);
	});
});
