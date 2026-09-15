import { describe, expect, it } from "vitest";
import type { JianyingShotSplitResult } from "../jianying-shot-split-contract.js";
import { compareShotSplitResults } from "../jianying-shot-split/compare.js";

function result(
	overrides: Partial<JianyingShotSplitResult>
): JianyingShotSplitResult {
	return {
		appVersion: "11.3.0",
		coreUuid: "uuid",
		cutFrames: [],
		cutPoints: [],
		durationSeconds: 12,
		elapsedMs: 100,
		engine: "bridge",
		fps: 24,
		frameCount: 288,
		height: 180,
		route: "qcut-jianying-shot-split-v1",
		shots: [],
		sourcePath: "/clip.mp4",
		width: 320,
		...overrides,
	};
}

describe("compareShotSplitResults", () => {
	it("pairs cuts within the tolerance and lists the rest per side", () => {
		const comparison = compareShotSplitResults({
			bridge: result({ cutFrames: [71, 143, 215, 260], elapsedMs: 150 }),
			torch: result({
				cutFrames: [70, 143, 216, 300],
				elapsedMs: 5000,
				engine: "torch",
				frameCount: 287,
			}),
		});
		expect(comparison.matches).toEqual([
			{ bridgeFrame: 71, frameDelta: -1, torchFrame: 70 },
			{ bridgeFrame: 143, frameDelta: 0, torchFrame: 143 },
			{ bridgeFrame: 215, frameDelta: 1, torchFrame: 216 },
		]);
		expect(comparison.bridgeOnlyFrames).toEqual([260]);
		expect(comparison.torchOnlyFrames).toEqual([300]);
		expect(comparison.agreement).toBeCloseTo(3 / 5);
		expect(comparison.maxFrameDelta).toBe(1);
		expect(comparison.frameCountMatches).toBe(false);
		expect(comparison.bridgeElapsedMs).toBe(150);
		expect(comparison.torchElapsedMs).toBe(5000);
		expect(comparison.toleranceFrames).toBe(1);
	});

	it("uses each torch cut at most once and prefers the nearest", () => {
		const comparison = compareShotSplitResults({
			bridge: result({ cutFrames: [100, 101] }),
			torch: result({ cutFrames: [101], engine: "torch" }),
		});
		expect(comparison.matches).toEqual([
			{ bridgeFrame: 100, frameDelta: 1, torchFrame: 101 },
		]);
		expect(comparison.bridgeOnlyFrames).toEqual([101]);
		expect(comparison.torchOnlyFrames).toEqual([]);
	});

	it("reports full agreement for identical or both-empty results", () => {
		expect(
			compareShotSplitResults({
				bridge: result({ cutFrames: [5, 9] }),
				torch: result({ cutFrames: [9, 5], engine: "torch" }),
			}).agreement
		).toBe(1);
		expect(
			compareShotSplitResults({ bridge: result({}), torch: result({}) })
				.agreement
		).toBe(1);
	});

	it("honours a custom tolerance and rejects invalid ones", () => {
		const strict = compareShotSplitResults({
			bridge: result({ cutFrames: [10] }),
			torch: result({ cutFrames: [11], engine: "torch" }),
			toleranceFrames: 0,
		});
		expect(strict.matches).toEqual([]);
		expect(strict.agreement).toBe(0);
		expect(() =>
			compareShotSplitResults({
				bridge: result({}),
				torch: result({}),
				toleranceFrames: -1,
			})
		).toThrow("容差");
	});
});
