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
});
