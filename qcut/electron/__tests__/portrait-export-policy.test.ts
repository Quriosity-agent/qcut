import { describe, expect, it } from "vitest";
import {
	portraitAdjustmentsAreActive,
	timelineRequiresRendererPortraitExport,
} from "../types/portrait-export-policy.js";
import type { ClaudeTimeline } from "../types/claude-api.js";

function timeline(portraitAdjustments: unknown): ClaudeTimeline {
	return {
		name: "t",
		duration: 4,
		width: 1080,
		height: 1920,
		fps: 30,
		tracks: [
			{
				id: "main",
				index: 0,
				name: "Main",
				type: "media",
				elements: [
					{
						id: "clip",
						trackIndex: 0,
						startTime: 0,
						endTime: 4,
						duration: 4,
						type: "media",
						portraitAdjustments,
					},
				],
			},
		],
	} as unknown as ClaudeTimeline;
}

describe("portrait export policy", () => {
	it("sends every kind of picture-changing portrait edit to the renderer", () => {
		for (const adjustments of [
			{ enabled: true, values: { face_adjust_Whiten: 20 } },
			{
				enabled: true,
				values: {},
				makeup: { lip: { cardId: "lip-coral-nude", intensity: 40 } },
			},
			{
				enabled: true,
				values: {},
				manualBody: { stretch: { intensity: 20, upper: 0.7, bottom: 0.2 } },
			},
			{
				enabled: true,
				values: {},
				manualRetouch: {
					strokes: [
						{
							id: "s",
							tool: "smooth",
							mode: "paint",
							size: 20,
							intensity: 50,
							points: [
								{ x: 0.4, y: 0.5 },
								{ x: 0.6, y: 0.5 },
							],
						},
					],
				},
			},
		]) {
			expect(portraitAdjustmentsAreActive({ candidate: adjustments })).toBe(
				true
			);
			expect(
				timelineRequiresRendererPortraitExport({
					timeline: timeline(adjustments),
				})
			).toBe(true);
		}
	});

	it("keeps disabled, neutral and malformed edits on the native path", () => {
		for (const adjustments of [
			undefined,
			null,
			[],
			{ enabled: false, values: { face_adjust_Whiten: 20 } },
			{
				enabled: true,
				values: { face_adjust_Whiten: 0 },
				manualBody: { stretch: { intensity: 0, upper: 0.7, bottom: 0.2 } },
				makeup: { lip: { cardId: "lip-coral-nude", intensity: 0 } },
			},
			{ enabled: true, values: 5, manualRetouch: {}, manualBody: "x" },
		]) {
			expect(portraitAdjustmentsAreActive({ candidate: adjustments })).toBe(
				false
			);
		}
	});
});
