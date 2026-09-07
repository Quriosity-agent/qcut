import { describe, expect, it, vi } from "vitest";
import {
	attemptTimelineRulerCalibration,
	calibrateTimelineRuler,
	rulerTimeToX,
	rulerXToTime,
} from "../cli-handlers-pointer-ruler.js";
import type { EditorApiClient } from "../../editor/editor-api-client.js";

function clientWith(elements: unknown[], truncated = false) {
	return {
		get: vi.fn(async () => ({ elements, truncated })),
	} as unknown as EditorApiClient;
}

const label = (time: number, x: number, y = 760) => ({
	ref: `@l${time}`,
	testId: null,
	textPreview: `${time}s`,
	bounds: { x, y, width: 12, height: 10 },
});

describe("calibrateTimelineRuler", () => {
	it("fits pixels per second and origin from the ruler labels", async () => {
		const calibration = await calibrateTimelineRuler({
			client: clientWith([
				label(0, 240),
				label(2, 340),
				label(4, 440),
				label(4, 440),
			]),
		});

		expect(calibration).toEqual({
			originX: 240,
			pixelsPerSecond: 50,
			rulerY: 765,
			labelCount: 3,
		});
		expect(rulerTimeToX({ calibration: calibration!, time: 3 })).toBe(390);
		expect(rulerXToTime({ calibration: calibration!, x: 315 })).toBe(1.5);
		expect(rulerXToTime({ calibration: calibration!, x: 0 })).toBe(0);
	});

	it("uses the most populated label row and ignores decimals rows elsewhere", async () => {
		const calibration = await calibrateTimelineRuler({
			client: clientWith([
				label(0, 100),
				label(0.5, 125),
				label(1, 150),
				label(7, 900, 40),
			]),
		});
		expect(calibration).toEqual(
			expect.objectContaining({
				pixelsPerSecond: 50,
				originX: 100,
				labelCount: 3,
			})
		);
	});

	it("returns null without at least two distinct labels or when truncated", async () => {
		await expect(
			calibrateTimelineRuler({ client: clientWith([label(0, 100)]) })
		).resolves.toBeNull();
		await expect(
			calibrateTimelineRuler({
				client: clientWith([label(0, 100), label(0, 100)]),
			})
		).resolves.toBeNull();
		await expect(
			calibrateTimelineRuler({
				client: clientWith([label(0, 100), label(1, 150)], true),
			})
		).resolves.toBeNull();
	});

	it("prefers the renderer ruler probe over a full snapshot", async () => {
		const get = vi.fn(async (path: string) => {
			if (path === "/api/claude/pointer/ruler-labels") {
				return {
					action: "ruler-labels",
					count: 3,
					labels: [
						{ time: 0, x: 300, y: 760, width: 12, height: 10 },
						{ time: 4, x: 500, y: 760, width: 12, height: 10 },
						{ time: 8, x: 700, y: 760, width: 12, height: 10 },
					],
				};
			}
			throw new Error(`unexpected GET ${path}`);
		});
		const attempt = await attemptTimelineRulerCalibration({
			client: { get } as unknown as EditorApiClient,
		});

		expect(attempt).toEqual({
			source: "ruler-labels",
			labelCount: 3,
			calibration: {
				originX: 300,
				pixelsPerSecond: 50,
				rulerY: 765,
				labelCount: 3,
			},
		});
		expect(get).toHaveBeenCalledTimes(1);
	});

	it("falls back to the snapshot when the probe is unavailable and reports why calibration failed", async () => {
		const get = vi.fn(async (path: string) => {
			if (path === "/api/claude/pointer/ruler-labels") {
				throw new Error("404 Not Found");
			}
			return { elements: [label(0, 100)], truncated: false };
		});
		const attempt = await attemptTimelineRulerCalibration({
			client: { get } as unknown as EditorApiClient,
		});

		expect(attempt.calibration).toBeNull();
		expect(attempt.source).toBe("snapshot");
		expect(attempt.reason).toContain("need at least two");
		expect(get).toHaveBeenCalledTimes(2);
	});
});
