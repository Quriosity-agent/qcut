import { describe, expect, it, vi } from "vitest";
import {
	type MeasureNativeLoudness,
	registerAudioMixRoutes,
} from "../claude/http/claude-http-audio-mix-routes";
import type { Router } from "../claude/utils/http-router";

/** POST /api/claude/mix/:projectId/loudness with a stretch of the timeline. */

type RouteHandler = (req: {
	params: Record<string, string>;
	query: Record<string, string>;
	body?: unknown;
}) => Promise<unknown>;

function loudnessRoute(measureNativeLoudness: MeasureNativeLoudness) {
	const handlers = new Map<string, RouteHandler>();
	const record = (method: string) => (path: string, handler: RouteHandler) => {
		handlers.set(`${method} ${path}`, handler);
	};
	const router = {
		get: record("GET"),
		post: record("POST"),
		patch: record("PATCH"),
		delete: record("DELETE"),
		handle: () => {},
	} as unknown as Router;
	registerAudioMixRoutes({ router, measureNativeLoudness });
	const handler = handlers.get("POST /api/claude/mix/:projectId/loudness");
	if (!handler) throw new Error("loudness route not registered");
	return (body: unknown) =>
		handler({ params: { projectId: "p1" }, query: {}, body });
}

describe("mix loudness route: a stretch", () => {
	it("hands the stretch to the native measurement", async () => {
		const measure = vi.fn<MeasureNativeLoudness>(async () => ({
			integratedLufs: -18,
			maxShortTermLufs: -12,
			maxMomentaryLufs: -10,
			truePeakDbtp: -1.2,
			samplePeakDb: -1.5,
			durationSeconds: 30,
		}));
		await loudnessRoute(measure)({ startTime: 155.583, endTime: 185.75 });
		await vi.waitFor(() =>
			expect(measure).toHaveBeenCalledWith({
				projectId: "p1",
				range: { startTime: 155.583, endTime: 185.75 },
			})
		);
	});

	it("measures the whole mix without one", async () => {
		const measure = vi.fn<MeasureNativeLoudness>(async () => ({
			integratedLufs: -18,
			maxShortTermLufs: -12,
			maxMomentaryLufs: -10,
			truePeakDbtp: -1.2,
			samplePeakDb: -1.5,
			durationSeconds: 218,
		}));
		await loudnessRoute(measure)({});
		await vi.waitFor(() =>
			expect(measure).toHaveBeenCalledWith({
				projectId: "p1",
				range: undefined,
			})
		);
	});

	it("refuses a stretch of the browser rendering and a bad number", async () => {
		const measure = vi.fn<MeasureNativeLoudness>();
		const post = loudnessRoute(measure);
		await expect(post({ engine: "browser", startTime: 1 })).rejects.toThrow(
			"measured on the native rendering"
		);
		await expect(post({ startTime: "soon" })).rejects.toThrow(
			"startTime must be a number of seconds"
		);
		expect(measure).not.toHaveBeenCalled();
	});
});
