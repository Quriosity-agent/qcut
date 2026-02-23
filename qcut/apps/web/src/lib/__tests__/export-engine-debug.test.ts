// Location: apps/web/src/lib/__tests__/export-engine-debug.test.ts

import { describe, it, expect, vi } from "vitest";
import { validateRenderedFrame } from "../export/export-engine-debug";

vi.mock("@/lib/debug/debug-config", () => ({
	debugLog: vi.fn(),
	debugWarn: vi.fn(),
}));

// Helper to create a mock CanvasRenderingContext2D
function createMockContext(pixelData: number[]): CanvasRenderingContext2D {
	return {
		getImageData: vi.fn(() => ({
			data: new Uint8ClampedArray(pixelData),
		})),
	} as unknown as CanvasRenderingContext2D;
}

describe("Export Engine Debug", () => {
	describe("validateRenderedFrame", () => {
		it("detects blank (all-black) canvas", () => {
			// 4 pixels, all black (RGBA = 0,0,0,255)
			const blackPixels = [
				0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
			];
			const ctx = createMockContext(blackPixels);

			const result = validateRenderedFrame(ctx, 0, 0, 50, 50, 1);
			expect(result.isValid).toBe(false);
			expect(result.reason).toContain("mostly black");
		});

		it("passes for canvas with content", () => {
			// 4 pixels with bright content
			const contentPixels = [
				255, 128, 64, 255, 200, 100, 50, 255, 150, 75, 25, 255, 100, 200, 150,
				255,
			];
			const ctx = createMockContext(contentPixels);

			const result = validateRenderedFrame(ctx, 0, 0, 50, 50, 1);
			expect(result.isValid).toBe(true);
		});

		it("detects transparent canvas as invalid", () => {
			// 4 pixels, all fully transparent
			const transparentPixels = [
				0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
			];
			const ctx = createMockContext(transparentPixels);

			const result = validateRenderedFrame(ctx, 0, 0, 50, 50, 1);
			expect(result.isValid).toBe(false);
		});

		it("returns valid when getImageData throws", () => {
			const ctx = {
				getImageData: vi.fn(() => {
					throw new Error("Security error");
				}),
			} as unknown as CanvasRenderingContext2D;

			const result = validateRenderedFrame(ctx, 0, 0, 50, 50, 1);
			expect(result.isValid).toBe(true);
			expect(result.reason).toContain("Validation error");
		});
	});
});
