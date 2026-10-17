import { describe, expect, it, vi } from "vitest";
import type { MediaElement } from "@/types/timeline";
import {
	applyTimelineSceneSplits,
	planSceneTimelineSplits,
	rollbackTimelineSceneSplits,
	sceneTimelineSplitTimes,
} from "../timeline-smart-split";

function element({
	overrides = {},
}: {
	overrides?: Partial<MediaElement>;
} = {}): MediaElement {
	return {
		id: "clip",
		type: "media",
		mediaId: "media",
		name: "Clip",
		startTime: 10,
		duration: 12,
		trimStart: 2,
		trimEnd: 2,
		...overrides,
	};
}

describe("timeline smart split", () => {
	it("maps visible scene boundaries into timeline coordinates", () => {
		const splitTimes = sceneTimelineSplitTimes({
			element: element({ overrides: { playbackRate: 2 } }),
			scenes: [
				{ timestamp: 0, confidence: 1 },
				{ timestamp: 4, confidence: 0.8 },
				{ timestamp: 8, confidence: 0.8 },
				{ timestamp: 12, confidence: 0.8 },
			],
			fps: 30,
		});

		expect(splitTimes).toEqual([11, 13]);
	});

	it("sorts reverse-playback boundaries in timeline order", () => {
		const splitTimes = sceneTimelineSplitTimes({
			element: element({ overrides: { reverse: true } }),
			scenes: [
				{ timestamp: 4, confidence: 0.8 },
				{ timestamp: 8, confidence: 0.8 },
			],
			fps: 30,
		});

		expect(splitTimes).toEqual([12, 16]);
	});

	it("pushes one undo snapshot while splitting each new right segment", () => {
		const pushHistory = vi.fn();
		const splitElement = vi
			.fn()
			.mockReturnValueOnce("right-1")
			.mockReturnValueOnce("right-2");

		const result = applyTimelineSceneSplits({
			trackId: "track",
			elementId: "clip",
			splitTimes: [12, 16],
			pushHistory,
			splitElement,
		});

		expect(pushHistory).toHaveBeenCalledTimes(1);
		expect(splitElement).toHaveBeenNthCalledWith(1, "track", "clip", 12, false);
		expect(splitElement).toHaveBeenNthCalledWith(
			2,
			"track",
			"right-1",
			16,
			false
		);
		expect(result).toEqual({
			createdElementIds: ["right-1", "right-2"],
			skipped: [],
		});
	});

	it("names the cuts the editor refuses instead of dropping them", () => {
		const result = applyTimelineSceneSplits({
			trackId: "track",
			elementId: "clip",
			splitTimes: [12, 14, 16],
			pushHistory: vi.fn(),
			splitElement: vi
				.fn()
				.mockReturnValueOnce("right-1")
				.mockReturnValueOnce(null)
				.mockReturnValueOnce("right-2"),
		});
		expect(result.createdElementIds).toEqual(["right-1", "right-2"]);
		expect(result.skipped).toEqual([
			{ timelineTime: 14, reason: expect.stringContaining("refused") },
		]);
	});

	it("plans cuts with reasons for the boundaries it sets aside", () => {
		const plan = planSceneTimelineSplits({
			element: element(),
			scenes: [
				{ timestamp: 0, confidence: 1 },
				{ timestamp: 1, confidence: 0.9 },
				{ timestamp: 2.01, confidence: 0.9 },
				{ timestamp: 4, confidence: 0.8 },
				{ timestamp: 4.02, confidence: 0.8 },
				{ timestamp: 6, confidence: 0.8 },
				{ timestamp: 9.5, confidence: 0.8 },
				{ timestamp: 11, confidence: 0.8 },
				{ timestamp: Number.NaN, confidence: 0 },
			],
			fps: 30,
			minShotSeconds: 1,
		});
		// trimStart 2, trimEnd 2 on a 12 s source: visible source range 2–10.
		expect(plan.cuts).toEqual([
			{ sourceTime: 4, timelineTime: 12 },
			{ sourceTime: 6, timelineTime: 14 },
		]);
		// Range checks are reported in input order, then the cut-spacing ones.
		expect(plan.skipped).toEqual([
			{ sourceTime: 1, reason: "outside the clip's trimmed range" },
			{ sourceTime: 2.01, reason: "within one frame of the clip's edge" },
			{ sourceTime: 11, reason: "outside the clip's trimmed range" },
			{ reason: "not a number" },
			{
				sourceTime: 4.02,
				timelineTime: 12.02,
				reason: "within one frame of another cut",
			},
			{
				sourceTime: 9.5,
				timelineTime: 17.5,
				reason: "would leave a shot shorter than 1 s",
			},
		]);
	});

	it("rolls back only the task-created segments and preserves later edits", () => {
		const source = element();
		const tracks = [
			{
				id: "track",
				name: "Main",
				type: "media" as const,
				isMain: true,
				elements: [
					{ ...source, duration: 4 },
					{ ...source, id: "right-1", startTime: 14, duration: 4 },
					{ ...source, id: "right-2", startTime: 18, duration: 4 },
					{
						...source,
						id: "later-user-edit",
						startTime: 24,
						name: "Later edit",
					},
				],
			},
		];

		const result = rollbackTimelineSceneSplits({
			tracks,
			trackId: "track",
			sourceElement: source,
			createdElementIds: ["right-1", "right-2"],
		});

		expect(result[0].elements.map((item) => item.id)).toEqual([
			"clip",
			"later-user-edit",
		]);
		expect(result[0].elements[0]).toEqual(source);
	});
});
