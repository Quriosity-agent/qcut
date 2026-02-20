/**
 * ResizeHandles Tests
 *
 * Tests canvas-relative delta calculation and boundary clamping.
 */

import { describe, it, expect } from "vitest";

/**
 * Pure function extracted from ResizeHandles.calculateNewSize logic
 * for unit testing without React rendering overhead.
 */
function calculateNewSize(
	handle: string,
	deltaX: number,
	deltaY: number,
	canvasWidth: number,
	canvasHeight: number,
	startWidth: number,
	startHeight: number,
	startLeft: number,
	startTop: number,
	currentX: number,
	currentY: number,
	maintainAspectRatio = false
) {
	let newWidth = startWidth;
	let newHeight = startHeight;
	let newX = currentX;
	let newY = currentY;

	const deltaXPercent = (deltaX / canvasWidth) * 100;
	const deltaYPercent = (deltaY / canvasHeight) * 100;

	switch (handle) {
		case "tl":
			newWidth = startWidth - deltaXPercent * 2;
			newHeight = startHeight - deltaYPercent * 2;
			newX = startLeft + deltaXPercent;
			newY = startTop + deltaYPercent;
			break;
		case "tr":
			newWidth = startWidth + deltaXPercent * 2;
			newHeight = startHeight - deltaYPercent * 2;
			newY = startTop + deltaYPercent;
			break;
		case "bl":
			newWidth = startWidth - deltaXPercent * 2;
			newHeight = startHeight + deltaYPercent * 2;
			newX = startLeft + deltaXPercent;
			break;
		case "br":
			newWidth = startWidth + deltaXPercent * 2;
			newHeight = startHeight + deltaYPercent * 2;
			break;
		case "t":
			newHeight = startHeight - deltaYPercent * 2;
			newY = startTop + deltaYPercent;
			break;
		case "b":
			newHeight = startHeight + deltaYPercent * 2;
			break;
		case "l":
			newWidth = startWidth - deltaXPercent * 2;
			newX = startLeft + deltaXPercent;
			break;
		case "r":
			newWidth = startWidth + deltaXPercent * 2;
			break;
	}

	// Min/max constraints
	newWidth = Math.max(5, Math.min(100, newWidth));
	newHeight = Math.max(5, Math.min(100, newHeight));
	newX = Math.max(0, Math.min(100, newX));
	newY = Math.max(0, Math.min(100, newY));

	// Canvas boundary clamping (center-based)
	const maxWidth = Math.min(100, newX * 2, (100 - newX) * 2);
	const maxHeight = Math.min(100, newY * 2, (100 - newY) * 2);
	newWidth = Math.max(5, Math.min(maxWidth, newWidth));
	newHeight = Math.max(5, Math.min(maxHeight, newHeight));

	return { width: newWidth, height: newHeight, x: newX, y: newY };
}

describe("ResizeHandles — delta calculation", () => {
	it("calculates delta as percentage of canvas, not window", () => {
		// Canvas is 400x300, sticker at center with 20% size
		// Dragging br handle 40px right, 30px down
		const result = calculateNewSize(
			"br",
			40,
			30,
			400, // canvasWidth
			300, // canvasHeight
			20, // startWidth
			20, // startHeight
			50, // startLeft
			50, // startTop
			50, // currentX
			50 // currentY
		);

		// 40px / 400 = 10%, deltaXPercent = 10, newWidth = 20 + 10*2 = 40
		expect(result.width).toBe(40);
		// 30px / 300 = 10%, deltaYPercent = 10, newHeight = 20 + 10*2 = 40
		expect(result.height).toBe(40);
	});

	it("produces correct percentages on small canvas (400x300)", () => {
		// 1px on a 400px canvas = 0.25%
		const result = calculateNewSize(
			"r",
			1,
			0,
			400,
			300,
			20,
			20,
			50,
			50,
			50,
			50
		);

		// deltaXPercent = (1/400)*100 = 0.25, newWidth = 20 + 0.25*2 = 20.5
		expect(result.width).toBeCloseTo(20.5, 1);
	});

	it("handles edge handles (top) correctly", () => {
		const result = calculateNewSize(
			"t",
			0,
			-30,
			400,
			300,
			20,
			20,
			50,
			50,
			50,
			50
		);

		// deltaYPercent = (-30/300)*100 = -10
		// newHeight = 20 - (-10)*2 = 40
		expect(result.height).toBe(40);
		// newY = 50 + (-10) = 40
		expect(result.y).toBe(40);
	});
});

describe("ResizeHandles — boundary clamping", () => {
	it("clamps width when sticker is near right edge", () => {
		// Sticker at x=90%, trying to resize to 50% width
		// maxWidth = min(100, 90*2, (100-90)*2) = min(100, 180, 20) = 20
		const result = calculateNewSize(
			"r",
			100,
			0,
			400,
			300,
			10,
			10,
			90,
			50,
			90,
			50
		);

		expect(result.width).toBe(20);
	});

	it("allows full width when sticker is centered", () => {
		// Sticker at x=50%, maxWidth = min(100, 100, 100) = 100
		const result = calculateNewSize(
			"r",
			800,
			0,
			400,
			300,
			10,
			10,
			50,
			50,
			50,
			50
		);

		expect(result.width).toBe(100);
	});

	it("clamps height when sticker is near bottom edge", () => {
		// Sticker at y=90%, maxHeight = min(100, 180, 20) = 20
		const result = calculateNewSize(
			"b",
			0,
			100,
			400,
			300,
			10,
			10,
			50,
			90,
			50,
			90
		);

		expect(result.height).toBe(20);
	});

	it("enforces minimum size of 5%", () => {
		// Shrinking sticker below minimum
		const result = calculateNewSize(
			"br",
			-100,
			-100,
			400,
			300,
			10,
			10,
			50,
			50,
			50,
			50
		);

		expect(result.width).toBeGreaterThanOrEqual(5);
		expect(result.height).toBeGreaterThanOrEqual(5);
	});

	it("clamps position to 0-100 range", () => {
		// Dragging top-left handle far past the origin
		const result = calculateNewSize(
			"tl",
			-1000,
			-1000,
			400,
			300,
			20,
			20,
			10,
			10,
			10,
			10
		);

		expect(result.x).toBeGreaterThanOrEqual(0);
		expect(result.y).toBeGreaterThanOrEqual(0);
		expect(result.x).toBeLessThanOrEqual(100);
		expect(result.y).toBeLessThanOrEqual(100);
	});
});
