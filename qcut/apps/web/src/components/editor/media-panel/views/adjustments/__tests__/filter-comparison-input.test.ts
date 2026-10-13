import { afterEach, describe, expect, it, vi } from "vitest";
import {
	comparisonTestImage,
	readComparisonImage,
} from "../filter-comparison-input";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("comparison image preparation", () => {
	it("creates a deterministic opaque image with spatial variation", () => {
		const first = comparisonTestImage();
		expect(first.rgba).toEqual(comparisonTestImage().rgba);
		expect(first.rgba.length).toBe(first.width * first.height * 4);
		expect(first.rgba.every((value, i) => i % 4 !== 3 || value === 255)).toBe(
			true
		);
		expect(new Set(first.rgba).size).toBeGreaterThan(200);
	});
	it("bounds decoded images proportionally and releases the bitmap", async () => {
		const close = vi.fn();
		const bitmap = { width: 1280, height: 720, close };
		vi.stubGlobal(
			"createImageBitmap",
			vi.fn(async () => bitmap)
		);
		const pixels = new Uint8ClampedArray(640 * 360 * 4).fill(255);
		const drawImage = vi.fn();
		const getContext = (() => ({
			drawImage,
			getImageData: () => ({ data: pixels }),
		})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
			getContext
		);
		const result = await readComparisonImage({
			file: new File(["image"], "test.png", { type: "image/png" }),
		});
		expect(result).toMatchObject({ width: 640, height: 360, resized: true });
		expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 640, 360);
		expect(close).toHaveBeenCalledOnce();
		pixels[3] = 254;
		await expect(
			readComparisonImage({
				file: new File(["image"], "test.png", { type: "image/png" }),
			})
		).rejects.toThrow("不透明");
		expect(close).toHaveBeenCalledTimes(2);
	});
	it("rejects unsupported types before decoding", async () => {
		await expect(
			readComparisonImage({
				file: new File(["x"], "test.svg", { type: "image/svg+xml" }),
			})
		).rejects.toThrow("PNG");
	});
	it.each([
		{
			width: 1080,
			height: 1920,
			maxPixels: 3840 * 2160,
			expectedWidth: 1080,
			expectedHeight: 1920,
		},
		{
			width: 3840,
			height: 2160,
			maxPixels: 3840 * 2160,
			expectedWidth: 3840,
			expectedHeight: 2160,
		},
		{
			width: 4096,
			height: 4096,
			maxPixels: 3840 * 2160,
			expectedWidth: 2880,
			expectedHeight: 2880,
		},
		{
			width: 10,
			height: 10,
			maxPixels: 100,
			expectedWidth: 10,
			expectedHeight: 10,
		},
		{
			width: 10,
			height: 10,
			maxPixels: 99,
			expectedWidth: 9,
			expectedHeight: 9,
		},
	])("honors pixel limits and reports actual dimension changes: %j", async ({
		width,
		height,
		maxPixels,
		expectedWidth,
		expectedHeight,
	}) => {
		const close = vi.fn();
		const bitmap = { width, height, close };
		vi.stubGlobal(
			"createImageBitmap",
			vi.fn(async () => bitmap)
		);
		const pixels = new Uint8ClampedArray(
			expectedWidth * expectedHeight * 4
		).fill(255);
		const drawImage = vi.fn();
		const getContext = (() => ({
			drawImage,
			getImageData: () => ({ data: pixels }),
		})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
			getContext
		);
		const result = await readComparisonImage({
			file: new File(["image"], "test.png", { type: "image/png" }),
			maxEdge: 4096,
			maxPixels,
		});
		expect(result).toMatchObject({
			width: expectedWidth,
			height: expectedHeight,
			resized: width !== expectedWidth || height !== expectedHeight,
		});
		expect(result.width * result.height).toBeLessThanOrEqual(maxPixels);
		expect(drawImage).toHaveBeenCalledWith(
			bitmap,
			0,
			0,
			expectedWidth,
			expectedHeight
		);
		expect(close).toHaveBeenCalledOnce();
	});
});
