import { describe, expect, it } from "vitest";
import {
	clampBoundsToWorkArea,
	resolveInitialWindowSize,
	resolveRequestedDisplay,
} from "../window-sizing.js";

describe("initial QCut window size", () => {
	it("keeps a full-HD capture surface when the display supports it", () => {
		expect(
			resolveInitialWindowSize({
				workAreaWidth: 2560,
				workAreaHeight: 1300,
			})
		).toEqual({
			width: 2048,
			height: 1080,
		});
	});

	it("does not exceed a smaller display work area", () => {
		expect(
			resolveInitialWindowSize({
				workAreaWidth: 1440,
				workAreaHeight: 900,
			})
		).toEqual({
			width: 1440,
			height: 900,
		});
	});
});

describe("clamping the window to a display work area", () => {
	it("shrinks a window sized on a larger display onto a smaller one", () => {
		// A 2048x1112 window from a 1440p primary dragged onto a 1080p display
		// whose work area starts right of the primary.
		expect(
			clampBoundsToWorkArea({
				bounds: { x: 2700, y: 100, width: 2048, height: 1112 },
				workArea: { x: 2560, y: 25, width: 1920, height: 1055 },
			})
		).toEqual({ x: 2560, y: 25, width: 1920, height: 1055 });
	});

	it("keeps a window that already fits, pulling it fully on-screen", () => {
		expect(
			clampBoundsToWorkArea({
				bounds: { x: 3600, y: -40, width: 1280, height: 800 },
				workArea: { x: 2560, y: 25, width: 1920, height: 1055 },
			})
		).toEqual({ x: 3200, y: 25, width: 1280, height: 800 });
	});

	it("leaves a fully visible window untouched", () => {
		const bounds = { x: 100, y: 80, width: 1600, height: 900 };
		expect(
			clampBoundsToWorkArea({
				bounds,
				workArea: { x: 0, y: 25, width: 2560, height: 1415 },
			})
		).toEqual(bounds);
	});
});

describe("QCUT_WINDOW_DISPLAY display selection", () => {
	const displays = [
		{ id: 1, workArea: { x: 0, y: 30, width: 2560, height: 1309 } },
		{ id: 2, workArea: { x: -1920, y: 30, width: 1920, height: 1050 } },
	];

	it("stays on the primary display when nothing is requested", () => {
		expect(
			resolveRequestedDisplay({ requested: undefined, displays, primaryId: 1 })
		).toBeNull();
		expect(
			resolveRequestedDisplay({ requested: "", displays, primaryId: 1 })
		).toBeNull();
	});

	it("picks the first non-primary display for 'secondary'", () => {
		expect(
			resolveRequestedDisplay({
				requested: "secondary",
				displays,
				primaryId: 1,
			})?.id
		).toBe(2);
		expect(
			resolveRequestedDisplay({
				requested: "secondary",
				displays: displays.slice(0, 1),
				primaryId: 1,
			})
		).toBeNull();
	});

	it("accepts a 1-based index and rejects everything else", () => {
		expect(
			resolveRequestedDisplay({ requested: "2", displays, primaryId: 1 })?.id
		).toBe(2);
		expect(
			resolveRequestedDisplay({ requested: "1", displays, primaryId: 1 })?.id
		).toBe(1);
		for (const requested of ["0", "3", "1.5", "left", "-1"]) {
			expect(
				resolveRequestedDisplay({ requested, displays, primaryId: 1 })
			).toBeNull();
		}
	});
});
