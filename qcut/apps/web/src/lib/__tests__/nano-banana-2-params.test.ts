import { describe, it, expect } from "vitest";
import { convertNanoBanana2Parameters } from "../fal-ai/model-handlers/nano-banana-2-params";

describe("convertNanoBanana2Parameters", () => {
	it("returns default values for minimal input", () => {
		const result = convertNanoBanana2Parameters({
			prompt: "edit this",
			image_urls: ["https://example.com/img.png"],
		});

		expect(result).toEqual({
			prompt: "edit this",
			image_urls: ["https://example.com/img.png"],
			num_images: 1,
			output_format: "png",
			resolution: "1K",
			aspect_ratio: "auto",
			safety_tolerance: 4,
			sync_mode: true,
			enable_web_search: false,
			limit_generations: true,
		});
	});

	it("clamps num_images to 1-4 range", () => {
		expect(convertNanoBanana2Parameters({ num_images: 0 }).num_images).toBe(1);
		expect(convertNanoBanana2Parameters({ num_images: 10 }).num_images).toBe(4);
		expect(convertNanoBanana2Parameters({ num_images: 3 }).num_images).toBe(3);
		expect(convertNanoBanana2Parameters({ numImages: 2 }).num_images).toBe(2);
	});

	it("truncates image_urls beyond 10 entries", () => {
		const urls = Array.from({ length: 15 }, (_, i) => `https://img${i}.png`);
		const result = convertNanoBanana2Parameters({ image_urls: urls });
		expect((result.image_urls as string[]).length).toBe(10);
	});

	it("converts imageUrl to image_urls array", () => {
		const result = convertNanoBanana2Parameters({
			imageUrl: "https://single.png",
		});
		expect(result.image_urls).toEqual(["https://single.png"]);
	});

	it("validates resolution enum values", () => {
		expect(convertNanoBanana2Parameters({ resolution: "2K" }).resolution).toBe(
			"2K"
		);
		expect(convertNanoBanana2Parameters({ resolution: "4K" }).resolution).toBe(
			"4K"
		);
		expect(
			convertNanoBanana2Parameters({ resolution: "0.5K" }).resolution
		).toBe("0.5K");
		// Invalid falls back to 1K
		expect(convertNanoBanana2Parameters({ resolution: "8K" }).resolution).toBe(
			"1K"
		);
		expect(
			convertNanoBanana2Parameters({ resolution: "invalid" }).resolution
		).toBe("1K");
	});

	it("validates aspect_ratio enum values", () => {
		expect(
			convertNanoBanana2Parameters({ aspect_ratio: "16:9" }).aspect_ratio
		).toBe("16:9");
		expect(
			convertNanoBanana2Parameters({ aspect_ratio: "9:16" }).aspect_ratio
		).toBe("9:16");
		expect(
			convertNanoBanana2Parameters({ aspectRatio: "1:1" }).aspect_ratio
		).toBe("1:1");
		// Invalid falls back to auto
		expect(
			convertNanoBanana2Parameters({ aspect_ratio: "7:3" }).aspect_ratio
		).toBe("auto");
	});

	it("clamps safety_tolerance to 1-6", () => {
		expect(
			convertNanoBanana2Parameters({ safety_tolerance: 0 }).safety_tolerance
		).toBe(1);
		expect(
			convertNanoBanana2Parameters({ safety_tolerance: 10 }).safety_tolerance
		).toBe(6);
		expect(
			convertNanoBanana2Parameters({ safetyTolerance: 3 }).safety_tolerance
		).toBe(3);
	});

	it("normalizes output_format", () => {
		expect(
			convertNanoBanana2Parameters({ output_format: "jpeg" }).output_format
		).toBe("jpeg");
		expect(
			convertNanoBanana2Parameters({ outputFormat: "webp" }).output_format
		).toBe("webp");
		expect(
			convertNanoBanana2Parameters({ output_format: "PNG" }).output_format
		).toBe("png");
	});

	it("passes through boolean parameters", () => {
		const result = convertNanoBanana2Parameters({
			enable_web_search: true,
			limit_generations: false,
			sync_mode: false,
		});
		expect(result.enable_web_search).toBe(true);
		expect(result.limit_generations).toBe(false);
		expect(result.sync_mode).toBe(false);
	});

	it("passes through seed when provided", () => {
		const result = convertNanoBanana2Parameters({ seed: 42 });
		expect(result.seed).toBe(42);
	});

	it("omits seed when not provided", () => {
		const result = convertNanoBanana2Parameters({});
		expect(result.seed).toBeUndefined();
	});

	it("drops unknown parameters", () => {
		const result = convertNanoBanana2Parameters({
			prompt: "test",
			unknownParam: "value",
			anotherUnknown: 123,
		});
		expect(result).not.toHaveProperty("unknownParam");
		expect(result).not.toHaveProperty("anotherUnknown");
	});
});
