import { describe, expect, it } from "vitest";
import {
	colorPreviewCanvasSize,
	portraitPreviewCanvasSize,
} from "../color-preview-resolution";

describe("preview processing resolution", () => {
	it.each([
		{ width: 1080, height: 1620, expected: { width: 1080, height: 1620 } },
		{ width: 3840, height: 2160, expected: { width: 1920, height: 1080 } },
		{ width: 2160, height: 3240, expected: { width: 1280, height: 1920 } },
		{ width: 480, height: 720, expected: { width: 480, height: 720 } },
		{ width: 10000, height: 1, expected: { width: 1920, height: 1 } },
	])("bounds logical portrait size $width x $height without upscaling", ({
		width,
		height,
		expected,
	}) => {
		expect(portraitPreviewCanvasSize({ width, height })).toEqual(expected);
	});
	it.each([
		0,
		-1,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("rejects invalid dimensions %s", (invalid) => {
		for (const size of [
			{ width: invalid, height: 1080 },
			{ width: 1080, height: invalid },
		]) {
			expect(portraitPreviewCanvasSize(size)).toEqual({ width: 0, height: 0 });
			expect(colorPreviewCanvasSize(size)).toEqual({ width: 0, height: 0 });
		}
	});
	it("preserves the color-only preview budget", () => {
		expect(colorPreviewCanvasSize({ width: 1920, height: 1080 })).toEqual({
			width: 480,
			height: 270,
		});
	});
});
