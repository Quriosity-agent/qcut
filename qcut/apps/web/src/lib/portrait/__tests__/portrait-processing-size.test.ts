import { describe, expect, it } from "vitest";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import {
	portraitProcessingSize,
	portraitSourceDimensions,
} from "../portrait-processing-size";

const input = {
	width: 1080,
	height: 1620,
	sourceWidth: 4000,
	sourceHeight: 6000,
};
const blemish: MediaPortraitAdjustments = {
	enabled: true,
	values: { face_adjust_SpotAcne: 50 },
};

describe("blemish processing resolution", () => {
	it.each([50, 100])("retains source detail at intensity %i", (value) => {
		expect(
			portraitProcessingSize({
				...input,
				adjustments: { enabled: true, values: { face_adjust_SpotAcne: value } },
			})
		).toEqual({ width: 2160, height: 3240 });
	});

	it.each([
		undefined,
		{ enabled: false, values: { face_adjust_SpotAcne: 100 } },
		{ enabled: true, values: { face_adjust_SpotAcne: 0 } },
		{ enabled: true, values: { face_adjust_Smooth: 100 } },
		{ enabled: true, values: { face_adjust_Clarity: 100 } },
	])("keeps other controls and neutral frames unchanged: %j", (adjustments) => {
		expect(portraitProcessingSize({ ...input, adjustments })).toEqual({
			width: 1080,
			height: 1620,
		});
	});

	it("supports combined and per-person settings", () => {
		const adjustments: MediaPortraitAdjustments = {
			enabled: true,
			values: { face_adjust_Smooth: 50 },
			faces: [{ trackId: 7, values: { face_adjust_SpotAcne: 100 } }],
		};
		expect(portraitProcessingSize({ ...input, adjustments })).toEqual({
			width: 2160,
			height: 3240,
		});
	});

	it.each([
		{ sourceWidth: 540, sourceHeight: 810, width: 1080, height: 1620 },
		{ sourceWidth: 1080, sourceHeight: 1620, width: 1080, height: 1620 },
		{ sourceWidth: 1600, sourceHeight: 2400, width: 1600, height: 2400 },
	])("does not invent source pixels: %j", ({
		sourceWidth,
		sourceHeight,
		width,
		height,
	}) => {
		expect(
			portraitProcessingSize({
				...input,
				sourceWidth,
				sourceHeight,
				adjustments: blemish,
			})
		).toEqual({ width, height });
	});

	it.each([
		{ width: 1920, height: 1080 },
		{ width: 2000, height: 2000 },
		{ width: 500, height: 3000 },
	])("bounds dimensions and allocation while preserving aspect: %j", ({
		width,
		height,
	}) => {
		const size = portraitProcessingSize({
			width,
			height,
			sourceWidth: 12000,
			sourceHeight: 12000,
			adjustments: blemish,
		});
		expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(4096);
		expect(size.width * size.height).toBeLessThanOrEqual(3840 * 2160);
		expect(Math.abs(size.width - (size.height * width) / height)).toBeLessThan(
			2
		);
	});

	it.each([
		0,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("does not allocate from invalid source dimensions %j", (sourceWidth) => {
		expect(
			portraitProcessingSize({ ...input, sourceWidth, adjustments: blemish })
		).toEqual({ width: input.width, height: input.height });
	});

	it("uses intrinsic image dimensions instead of its CSS presentation size", () => {
		const source = document.createElement("img");
		source.width = 400;
		source.height = 600;
		Object.defineProperties(source, {
			naturalWidth: { value: 4000 },
			naturalHeight: { value: 6000 },
		});
		expect(portraitSourceDimensions({ source })).toEqual({
			width: 4000,
			height: 6000,
		});
	});

	it("does not supersample the already-fitted preview twice", () => {
		const source = document.createElement("canvas");
		source.width = 2160;
		source.height = 3240;
		const dimensions = portraitSourceDimensions({ source });
		expect(
			portraitProcessingSize({
				...input,
				sourceWidth: dimensions.width,
				sourceHeight: dimensions.height,
				adjustments: blemish,
			})
		).toEqual(dimensions);
	});
});
