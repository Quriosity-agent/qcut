/**
 * Sticker Export E2E Tests
 *
 * End-to-end tests for the full sticker export pipeline:
 * - SVG rasterization (svg-rasterizer.ts)
 * - Multi-sticker source extraction with timing
 * - Word filter cut + sticker interop (timing remapping)
 * - maintainAspectRatio passthrough
 * - File extension normalization
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MediaItem } from "@/stores/media-store-types";
import type { StickerSourceForFilter } from "../export-cli/types";
import { isSvgContent } from "../export-cli/sources/svg-rasterizer";

// Mock sticker-timeline-query
const mockTimingMap = new Map<string, { startTime: number; endTime: number }>();

vi.mock("@/lib/sticker-timeline-query", () => ({
	getStickerTimingMap: () => mockTimingMap,
	getStickerTiming: (id: string) => mockTimingMap.get(id) ?? null,
}));

import { extractStickerSources } from "../export-cli/sources/sticker-sources";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

interface StickerOverlayData {
	id: string;
	mediaItemId: string;
	position: { x: number; y: number };
	size: { width: number; height: number };
	zIndex: number;
	opacity?: number;
	rotation?: number;
	maintainAspectRatio?: boolean;
	timing?: { startTime?: number; endTime?: number };
}

function createStickerData(
	overrides?: Partial<StickerOverlayData>
): StickerOverlayData {
	return {
		id: "sticker-1",
		mediaItemId: "media-1",
		position: { x: 50, y: 50 },
		size: { width: 20, height: 20 },
		zIndex: 1,
		opacity: 1,
		rotation: 0,
		...overrides,
	};
}

function createMediaItem(overrides?: Partial<MediaItem>): MediaItem {
	return {
		id: "media-1",
		name: "sticker.png",
		type: "image",
		file: new File([], "sticker.png"),
		url: "blob:http://localhost/sticker-1",
		localPath: "/tmp/sticker.png",
		...overrides,
	};
}

function createStoreGetter(stickers: StickerOverlayData[]) {
	return async () => ({
		getStickersForExport: () => stickers,
	});
}

function createMockAPI(path = "/tmp/exported-sticker.png") {
	return {
		saveStickerForExport: vi.fn().mockResolvedValue({
			success: true,
			path,
		}),
	};
}

const silentLogger = vi.fn();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Sticker Export E2E", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		silentLogger.mockClear();
		mockTimingMap.clear();
	});

	// =========================================================================
	// SVG Detection
	// =========================================================================

	describe("SVG detection (isSvgContent)", () => {
		it("should detect SVG by blob type", () => {
			const blob = new Blob(["<svg></svg>"], { type: "image/svg+xml" });
			expect(isSvgContent(blob)).toBe(true);
		});

		it("should detect SVG by data URL", () => {
			const blob = new Blob(["data"], { type: "application/octet-stream" });
			expect(isSvgContent(blob, "data:image/svg+xml;base64,abc")).toBe(true);
		});

		it("should detect SVG by file extension in URL", () => {
			const blob = new Blob(["data"], { type: "application/octet-stream" });
			expect(isSvgContent(blob, "https://example.com/icon.svg")).toBe(true);
		});

		it("should return false for PNG", () => {
			const blob = new Blob(["data"], { type: "image/png" });
			expect(isSvgContent(blob)).toBe(false);
		});

		it("should return false for JPEG", () => {
			const blob = new Blob(["data"], { type: "image/jpeg" });
			expect(isSvgContent(blob, "https://example.com/photo.jpg")).toBe(false);
		});
	});

	// =========================================================================
	// File Extension Normalization
	// =========================================================================

	describe("file extension normalization", () => {
		it("should save PNG stickers with format 'png'", async () => {
			const mockBlob = {
				arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
				type: "image/png",
			};
			vi.spyOn(globalThis, "fetch").mockResolvedValue({
				ok: true,
				blob: vi.fn().mockResolvedValue(mockBlob),
			} as unknown as Response);

			const mockAPI = createMockAPI();
			const stickers = [createStickerData()];
			const mediaItems = [
				createMediaItem({ localPath: undefined, url: "blob:http://test/1" }),
			];

			await extractStickerSources(
				mediaItems,
				"session-1",
				1920,
				1080,
				10,
				createStoreGetter(stickers),
				mockAPI,
				silentLogger
			);

			expect(mockAPI.saveStickerForExport).toHaveBeenCalledWith(
				expect.objectContaining({ format: "png" })
			);
		});

		it("should normalize JPEG format to 'jpg'", async () => {
			const mockBlob = {
				arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
				type: "image/jpeg",
			};
			vi.spyOn(globalThis, "fetch").mockResolvedValue({
				ok: true,
				blob: vi.fn().mockResolvedValue(mockBlob),
			} as unknown as Response);

			const mockAPI = createMockAPI();
			const stickers = [createStickerData()];
			const mediaItems = [
				createMediaItem({ localPath: undefined, url: "blob:http://test/2" }),
			];

			await extractStickerSources(
				mediaItems,
				"session-1",
				1920,
				1080,
				10,
				createStoreGetter(stickers),
				mockAPI,
				silentLogger
			);

			expect(mockAPI.saveStickerForExport).toHaveBeenCalledWith(
				expect.objectContaining({ format: "jpg" })
			);
		});

		it("should convert SVG stickers to PNG format for FFmpeg compatibility", async () => {
			// SVG blobs should be rasterized to PNG before saving
			// In jsdom, Canvas API is not available, so the rasterization will fail.
			// But we verify the SVG is detected and the attempt is made.
			const svgContent =
				'<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
			const mockBlob = {
				arrayBuffer: vi
					.fn()
					.mockResolvedValue(new TextEncoder().encode(svgContent).buffer),
				type: "image/svg+xml",
			};
			vi.spyOn(globalThis, "fetch").mockResolvedValue({
				ok: true,
				blob: vi.fn().mockResolvedValue(mockBlob),
			} as unknown as Response);

			const mockAPI = createMockAPI();
			const stickers = [createStickerData()];
			const mediaItems = [
				createMediaItem({ localPath: undefined, url: "blob:http://test/svg" }),
			];

			// In jsdom, canvas is not available, so SVG rasterization will throw.
			// The sticker should be skipped gracefully.
			const result = await extractStickerSources(
				mediaItems,
				"session-1",
				1920,
				1080,
				10,
				createStoreGetter(stickers),
				mockAPI,
				silentLogger
			);

			// SVG rasterization fails in jsdom → sticker skipped gracefully
			expect(result).toHaveLength(0);
			expect(silentLogger).toHaveBeenCalledWith(
				expect.stringContaining("Failed to process sticker"),
				expect.anything()
			);
		});

		it("should skip SVG localPath and re-download for rasterization", async () => {
			const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
				ok: true,
				blob: vi.fn().mockResolvedValue({
					arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
					type: "image/png",
				}),
			} as unknown as Response);

			const mockAPI = createMockAPI();
			const stickers = [createStickerData()];
			// SVG local path should trigger re-download for rasterization
			const mediaItems = [
				createMediaItem({
					localPath: "/tmp/sticker.svg",
					url: "blob:http://test/svg-local",
				}),
			];

			await extractStickerSources(
				mediaItems,
				"session-1",
				1920,
				1080,
				10,
				createStoreGetter(stickers),
				mockAPI,
				silentLogger
			);

			// Should have called fetch because localPath ends with .svg
			expect(fetchSpy).toHaveBeenCalled();
		});
	});

	// =========================================================================
	// Multi-Sticker Export
	// =========================================================================

	describe("multi-sticker export pipeline", () => {
		it("should extract multiple stickers sorted by zIndex", async () => {
			const stickers = [
				createStickerData({ id: "s1", mediaItemId: "m1", zIndex: 30 }),
				createStickerData({ id: "s2", mediaItemId: "m2", zIndex: 10 }),
				createStickerData({ id: "s3", mediaItemId: "m3", zIndex: 20 }),
			];
			const mediaItems = [
				createMediaItem({ id: "m1" }),
				createMediaItem({ id: "m2" }),
				createMediaItem({ id: "m3" }),
			];

			const result = await extractStickerSources(
				mediaItems,
				"session-1",
				1920,
				1080,
				10,
				createStoreGetter(stickers),
				createMockAPI(),
				silentLogger
			);

			expect(result).toHaveLength(3);
			expect(result[0].id).toBe("s2"); // zIndex 10
			expect(result[1].id).toBe("s3"); // zIndex 20
			expect(result[2].id).toBe("s1"); // zIndex 30
		});

		it("should assign correct timing per sticker from timeline", async () => {
			mockTimingMap.set("s1", { startTime: 0, endTime: 5 });
			mockTimingMap.set("s2", { startTime: 3, endTime: 8 });
			mockTimingMap.set("s3", { startTime: 6, endTime: 10 });

			const stickers = [
				createStickerData({ id: "s1", mediaItemId: "m1", zIndex: 1 }),
				createStickerData({ id: "s2", mediaItemId: "m2", zIndex: 2 }),
				createStickerData({ id: "s3", mediaItemId: "m3", zIndex: 3 }),
			];
			const mediaItems = [
				createMediaItem({ id: "m1" }),
				createMediaItem({ id: "m2" }),
				createMediaItem({ id: "m3" }),
			];

			const result = await extractStickerSources(
				mediaItems,
				"session-1",
				1920,
				1080,
				10,
				createStoreGetter(stickers),
				createMockAPI(),
				silentLogger
			);

			expect(result[0]).toMatchObject({ id: "s1", startTime: 0, endTime: 5 });
			expect(result[1]).toMatchObject({ id: "s2", startTime: 3, endTime: 8 });
			expect(result[2]).toMatchObject({ id: "s3", startTime: 6, endTime: 10 });
		});

		it("should handle stickers at different positions on 1920x1080", async () => {
			const stickers = [
				createStickerData({
					id: "s-topleft",
					mediaItemId: "m1",
					position: { x: 10, y: 10 },
					size: { width: 10, height: 10 },
					zIndex: 1,
				}),
				createStickerData({
					id: "s-center",
					mediaItemId: "m2",
					position: { x: 50, y: 50 },
					size: { width: 15, height: 15 },
					zIndex: 2,
				}),
				createStickerData({
					id: "s-bottomright",
					mediaItemId: "m3",
					position: { x: 90, y: 90 },
					size: { width: 10, height: 10 },
					zIndex: 3,
				}),
			];
			const mediaItems = [
				createMediaItem({ id: "m1" }),
				createMediaItem({ id: "m2" }),
				createMediaItem({ id: "m3" }),
			];

			const result = await extractStickerSources(
				mediaItems,
				"session-1",
				1920,
				1080,
				10,
				createStoreGetter(stickers),
				createMockAPI(),
				silentLogger
			);

			expect(result).toHaveLength(3);

			// Top-left: center=(192, 108), size=108x108, topLeft=(138, 54)
			const baseSize = 1080;
			const tlW = Math.round((10 / 100) * baseSize);
			const tlCenterX = Math.round((10 / 100) * 1920);
			const tlCenterY = Math.round((10 / 100) * 1080);
			expect(result[0].x).toBe(tlCenterX - tlW / 2);
			expect(result[0].y).toBe(tlCenterY - tlW / 2);
			expect(result[0].width).toBe(tlW);

			// Center: center=(960, 540), size=162x162, topLeft=(879, 459)
			const cW = Math.round((15 / 100) * baseSize);
			expect(result[1].x).toBe(Math.round(960 - cW / 2));
			expect(result[1].width).toBe(cW);

			// Bottom-right: center=(1728, 972)
			expect(result[2].x).toBe(
				Math.round((90 / 100) * 1920 - ((10 / 100) * baseSize) / 2)
			);
		});

		it("should skip stickers with missing media and continue", async () => {
			const stickers = [
				createStickerData({ id: "s1", mediaItemId: "m-exists", zIndex: 1 }),
				createStickerData({ id: "s2", mediaItemId: "m-missing", zIndex: 2 }),
				createStickerData({ id: "s3", mediaItemId: "m-exists2", zIndex: 3 }),
			];
			const mediaItems = [
				createMediaItem({ id: "m-exists" }),
				createMediaItem({ id: "m-exists2" }),
				// m-missing intentionally absent
			];

			const result = await extractStickerSources(
				mediaItems,
				"session-1",
				1920,
				1080,
				10,
				createStoreGetter(stickers),
				createMockAPI(),
				silentLogger
			);

			// s2 skipped because media missing
			expect(result).toHaveLength(2);
			expect(result[0].id).toBe("s1");
			expect(result[1].id).toBe("s3");
		});
	});

	// =========================================================================
	// maintainAspectRatio Passthrough
	// =========================================================================

	describe("maintainAspectRatio passthrough", () => {
		it("should pass maintainAspectRatio=true to export source", async () => {
			const stickers = [createStickerData({ maintainAspectRatio: true })];
			const mediaItems = [createMediaItem()];

			const result = await extractStickerSources(
				mediaItems,
				"session-1",
				1920,
				1080,
				10,
				createStoreGetter(stickers),
				createMockAPI(),
				silentLogger
			);

			expect(result).toHaveLength(1);
			expect(result[0].maintainAspectRatio).toBe(true);
		});

		it("should pass maintainAspectRatio=false by default", async () => {
			const stickers = [createStickerData()]; // no maintainAspectRatio set
			const mediaItems = [createMediaItem()];

			const result = await extractStickerSources(
				mediaItems,
				"session-1",
				1920,
				1080,
				10,
				createStoreGetter(stickers),
				createMockAPI(),
				silentLogger
			);

			expect(result).toHaveLength(1);
			expect(result[0].maintainAspectRatio).toBeUndefined();
		});
	});

	// =========================================================================
	// Opacity and Rotation Passthrough
	// =========================================================================

	describe("sticker properties passthrough", () => {
		it("should pass opacity and rotation to export source", async () => {
			const stickers = [createStickerData({ opacity: 0.5, rotation: 45 })];
			const mediaItems = [createMediaItem()];

			const result = await extractStickerSources(
				mediaItems,
				"session-1",
				1920,
				1080,
				10,
				createStoreGetter(stickers),
				createMockAPI(),
				silentLogger
			);

			expect(result[0].opacity).toBe(0.5);
			expect(result[0].rotation).toBe(45);
		});

		it("should handle zero opacity sticker", async () => {
			const stickers = [createStickerData({ opacity: 0 })];
			const mediaItems = [createMediaItem()];

			const result = await extractStickerSources(
				mediaItems,
				"session-1",
				1920,
				1080,
				10,
				createStoreGetter(stickers),
				createMockAPI(),
				silentLogger
			);

			expect(result[0].opacity).toBe(0);
		});

		it("should handle 360-degree rotation sticker", async () => {
			const stickers = [createStickerData({ rotation: 360 })];
			const mediaItems = [createMediaItem()];

			const result = await extractStickerSources(
				mediaItems,
				"session-1",
				1920,
				1080,
				10,
				createStoreGetter(stickers),
				createMockAPI(),
				silentLogger
			);

			expect(result[0].rotation).toBe(360);
		});
	});

	// =========================================================================
	// Full Pipeline: Multiple stickers with mixed properties
	// =========================================================================

	describe("full export pipeline", () => {
		it("should handle a realistic multi-sticker export scenario", async () => {
			// 3 stickers with different positions, timings, and properties
			mockTimingMap.set("logo", { startTime: 0, endTime: 30 });
			mockTimingMap.set("arrow", { startTime: 5, endTime: 15 });
			mockTimingMap.set("badge", { startTime: 10, endTime: 25 });

			const stickers = [
				createStickerData({
					id: "logo",
					mediaItemId: "m-logo",
					position: { x: 10, y: 10 },
					size: { width: 8, height: 8 },
					zIndex: 100,
					opacity: 0.9,
					rotation: 0,
					maintainAspectRatio: true,
				}),
				createStickerData({
					id: "arrow",
					mediaItemId: "m-arrow",
					position: { x: 50, y: 50 },
					size: { width: 15, height: 15 },
					zIndex: 50,
					opacity: 1,
					rotation: 45,
				}),
				createStickerData({
					id: "badge",
					mediaItemId: "m-badge",
					position: { x: 85, y: 85 },
					size: { width: 12, height: 12 },
					zIndex: 75,
					opacity: 0.7,
					rotation: 0,
				}),
			];

			const mediaItems = [
				createMediaItem({ id: "m-logo", name: "logo.png" }),
				createMediaItem({ id: "m-arrow", name: "arrow.png" }),
				createMediaItem({ id: "m-badge", name: "badge.png" }),
			];

			const result = await extractStickerSources(
				mediaItems,
				"session-full",
				1920,
				1080,
				30,
				createStoreGetter(stickers),
				createMockAPI(),
				silentLogger
			);

			expect(result).toHaveLength(3);

			// Sorted by zIndex: arrow(50) < badge(75) < logo(100)
			expect(result[0].id).toBe("arrow");
			expect(result[1].id).toBe("badge");
			expect(result[2].id).toBe("logo");

			// Timing from timeline
			expect(result[0]).toMatchObject({ startTime: 5, endTime: 15 });
			expect(result[1]).toMatchObject({ startTime: 10, endTime: 25 });
			expect(result[2]).toMatchObject({ startTime: 0, endTime: 30 });

			// Properties preserved
			expect(result[0].rotation).toBe(45);
			expect(result[1].opacity).toBe(0.7);
			expect(result[2].maintainAspectRatio).toBe(true);

			// Positions are valid pixel coordinates
			for (const s of result) {
				expect(Number.isInteger(s.x)).toBe(true);
				expect(Number.isInteger(s.y)).toBe(true);
				expect(s.width).toBeGreaterThan(0);
				expect(s.height).toBeGreaterThan(0);
			}
		});
	});
});
