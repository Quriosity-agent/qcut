// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareRgbaPixels } from "../beauty-lab/beauty-lab-rgba-metrics.js";

describe("Beauty Lab exact RGBA metrics", () => {
	it("returns zero metrics for identical bytes without mutating inputs", () => {
		const actual = Uint8Array.from([11, 22, 33, 44]);
		const expected = Uint8Array.from(actual);
		expect(
			compareRgbaPixels({ actual, expected, width: 1, height: 1 })
		).toEqual({
			changedPixels: 0,
			maxDelta: 0,
			bbox: null,
		});
		expect(actual).toEqual(expected);
	});
	it.each([0, 1, 2, 3])("detects a change in channel %s", (channel) => {
		const expected = Buffer.alloc(3 * 4 * 4, 50);
		const actual = Buffer.from(expected);
		actual[(2 * 3 + 1) * 4 + channel] = 10;
		expect(
			compareRgbaPixels({ actual, expected, width: 3, height: 4 })
		).toEqual({
			changedPixels: 1,
			maxDelta: 40,
			bbox: [1, 2, 2, 3],
		});
	});
	it("counts pixels once and unions disjoint boundary rows", () => {
		const expected = Buffer.alloc(4 * 5 * 4, 100);
		const actual = Buffer.from(expected);
		actual[0] = 0;
		actual[1] = 255;
		actual[(4 * 4 + 3) * 4 + 3] = 101;
		expect(
			compareRgbaPixels({ actual, expected, width: 4, height: 5 })
		).toEqual({
			changedPixels: 2,
			maxDelta: 155,
			bbox: [0, 0, 4, 5],
		});
		expect(expected.every((value) => value === 100)).toBe(true);
	});
	it("respects sliced byte offsets, including unaligned backing storage", () => {
		const actual = new Uint8Array([99, 1, 2, 3, 4, 99]).subarray(1, 5);
		const expected = new Uint8Array([88, 1, 2, 3, 5, 88]).subarray(1, 5);
		expect(
			compareRgbaPixels({ actual, expected, width: 1, height: 1 })
		).toEqual({
			changedPixels: 1,
			maxDelta: 1,
			bbox: [0, 0, 1, 1],
		});
	});
	it("visits all bytes of real-sized frames, including the last alpha byte", () => {
		const width = 1448;
		const height = 1086;
		const expected = Buffer.alloc(width * height * 4, 11);
		const actual = Buffer.from(expected);
		actual[actual.length - 1] = 10;
		expect(compareRgbaPixels({ actual, expected, width, height })).toEqual({
			changedPixels: 1,
			maxDelta: 1,
			bbox: [width - 1, height - 1, width, height],
		});
	});
	it("matches a straightforward independent calculation on dense mixed changes", () => {
		const width = 31;
		const height = 17;
		const expected = Uint8Array.from(
			{ length: width * height * 4 },
			(_, index) => (index * 37 + 19) % 256
		);
		const actual = Uint8Array.from(expected, (value, index) =>
			index % 7 === 0 ? 255 - value : value
		);
		let changedPixels = 0;
		let maxDelta = 0;
		const xs: number[] = [];
		const ys: number[] = [];
		for (let pixel = 0; pixel < width * height; pixel++) {
			const start = pixel * 4;
			const differences = Array.from({ length: 4 }, (_, channel) =>
				Math.abs(actual[start + channel] - expected[start + channel])
			);
			maxDelta = Math.max(maxDelta, ...differences);
			if (differences.every((value) => value === 0)) continue;
			changedPixels++;
			xs.push(pixel % width);
			ys.push(Math.floor(pixel / width));
		}
		expect(compareRgbaPixels({ actual, expected, width, height })).toEqual({
			changedPixels,
			maxDelta,
			bbox: [
				Math.min(...xs),
				Math.min(...ys),
				Math.max(...xs) + 1,
				Math.max(...ys) + 1,
			],
		});
	});
	it.each([
		{ width: 0, height: 1 },
		{ width: 1, height: -1 },
		{ width: 0.5, height: 1 },
		{ width: NaN, height: 1 },
		{ width: 1, height: Infinity },
		{ width: Number.MAX_SAFE_INTEGER, height: 2 },
	])("rejects invalid dimensions $width x $height", ({ width, height }) => {
		expect(() =>
			compareRgbaPixels({
				actual: Buffer.alloc(4),
				expected: Buffer.alloc(4),
				width,
				height,
			})
		).toThrow("dimensions or byte count");
	});
	it.each([
		{ actual: Buffer.alloc(3), expected: Buffer.alloc(4) },
		{ actual: Buffer.alloc(4), expected: Buffer.alloc(5) },
	])("rejects unequal or truncated buffers", ({ actual, expected }) => {
		expect(() =>
			compareRgbaPixels({ actual, expected, width: 1, height: 1 })
		).toThrow("dimensions or byte count");
	});
});
