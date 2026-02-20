import { describe, it, expect, vi } from "vitest";
import { buildStickerOverlayFilters } from "../export-cli/filters/sticker-overlay";
import type { StickerSourceForFilter } from "../export-cli/types";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createStickerSource(
	overrides?: Partial<StickerSourceForFilter>
): StickerSourceForFilter {
	return {
		id: "sticker-1",
		path: "/tmp/sticker-1.png",
		x: 852,
		y: 432,
		width: 216,
		height: 216,
		startTime: 0,
		endTime: 10,
		zIndex: 1,
		opacity: 1,
		rotation: 0,
		...overrides,
	};
}

const silentLogger = vi.fn();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildStickerOverlayFilters", () => {
	it("should return empty string when stickerSources is empty", () => {
		const result = buildStickerOverlayFilters([], 10, silentLogger);
		expect(result).toBe("");
	});

	it("should return empty string when stickerSources is null/undefined", () => {
		const result = buildStickerOverlayFilters(
			null as unknown as StickerSourceForFilter[],
			10,
			silentLogger
		);
		expect(result).toBe("");
	});

	it("should generate scale filter for each sticker", () => {
		const sources = [createStickerSource({ width: 200, height: 150 })];
		const result = buildStickerOverlayFilters(sources, 10, silentLogger);

		expect(result).toContain("scale=200:150");
	});

	it("should generate overlay filter with x and y coordinates", () => {
		const sources = [createStickerSource({ x: 100, y: 200 })];
		const result = buildStickerOverlayFilters(sources, 10, silentLogger);

		expect(result).toContain("x=100");
		expect(result).toContain("y=200");
	});

	it("should add enable between clause when timing differs from full duration", () => {
		const sources = [createStickerSource({ startTime: 2, endTime: 8 })];
		const result = buildStickerOverlayFilters(sources, 10, silentLogger);

		expect(result).toContain("enable='between(t,2,8)'");
	});

	it("should omit enable clause when sticker spans entire video", () => {
		const sources = [createStickerSource({ startTime: 0, endTime: 10 })];
		const result = buildStickerOverlayFilters(sources, 10, silentLogger);

		expect(result).not.toContain("enable=");
	});

	it("should apply rotation filter before overlay when rotation is non-zero", () => {
		const sources = [createStickerSource({ rotation: 45 })];
		const result = buildStickerOverlayFilters(sources, 10, silentLogger);

		expect(result).toContain("rotate=45*PI/180:c=none");
	});

	it("should skip rotation filter when rotation is 0", () => {
		const sources = [createStickerSource({ rotation: 0 })];
		const result = buildStickerOverlayFilters(sources, 10, silentLogger);

		expect(result).not.toContain("rotate=");
	});

	it("should skip rotation filter when rotation is undefined", () => {
		const sources = [createStickerSource({ rotation: undefined })];
		const result = buildStickerOverlayFilters(sources, 10, silentLogger);

		expect(result).not.toContain("rotate=");
	});

	it("should apply opacity via format+geq when opacity < 1", () => {
		const sources = [createStickerSource({ opacity: 0.5 })];
		const result = buildStickerOverlayFilters(sources, 10, silentLogger);

		expect(result).toContain("format=rgba,geq=");
		expect(result).toContain("a='0.5*alpha(X,Y)'");
	});

	it("should skip opacity filter when opacity is 1", () => {
		const sources = [createStickerSource({ opacity: 1 })];
		const result = buildStickerOverlayFilters(sources, 10, silentLogger);

		expect(result).not.toContain("format=rgba");
		expect(result).not.toContain("geq=");
	});

	it("should skip opacity filter when opacity is undefined", () => {
		const sources = [createStickerSource({ opacity: undefined })];
		const result = buildStickerOverlayFilters(sources, 10, silentLogger);

		expect(result).not.toContain("format=rgba");
	});

	it("should chain multiple stickers with correct input/output labels", () => {
		const sources = [
			createStickerSource({ id: "s1", zIndex: 1 }),
			createStickerSource({ id: "s2", zIndex: 2 }),
			createStickerSource({ id: "s3", zIndex: 3 }),
		];
		const result = buildStickerOverlayFilters(sources, 10, silentLogger);

		// First sticker outputs to [v1], second to [v2], third has no output label
		expect(result).toContain("[v1]");
		expect(result).toContain("[v2]");
		// Segments separated by semicolons
		const segments = result.split(";");
		expect(segments.length).toBeGreaterThanOrEqual(6); // 2 per sticker minimum (scale + overlay)
	});

	it("should use 0:v as initial input label for first sticker", () => {
		const sources = [createStickerSource()];
		const result = buildStickerOverlayFilters(sources, 10, silentLogger);

		// The overlay filter references [0:v] as the base video
		expect(result).toContain("[0:v]");
	});

	it("should omit output label on last sticker in chain", () => {
		const sources = [
			createStickerSource({ id: "s1", zIndex: 1 }),
			createStickerSource({ id: "s2", zIndex: 2 }),
		];
		const result = buildStickerOverlayFilters(sources, 10, silentLogger);

		// The last overlay filter should NOT end with a label like [v2]
		const segments = result.split(";");
		const lastSegment = segments[segments.length - 1];
		// Last segment should contain overlay but not end with [vN]
		expect(lastSegment).toContain("overlay=");
		expect(lastSegment).not.toMatch(/\[v\d+\]$/);
	});

	it("should use sticker input indices starting at 1", () => {
		const sources = [
			createStickerSource({ id: "s1" }),
			createStickerSource({ id: "s2" }),
		];
		const result = buildStickerOverlayFilters(sources, 10, silentLogger);

		// First sticker: [1:v], second: [2:v]
		expect(result).toContain("[1:v]");
		expect(result).toContain("[2:v]");
	});
});
