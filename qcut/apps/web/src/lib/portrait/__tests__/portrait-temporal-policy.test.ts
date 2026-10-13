import { describe, expect, it } from "vitest";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import {
	canUseNativePortraitSourceWindow,
	portraitSourceWindowKey,
} from "../portrait-temporal-policy";

const adjustments: MediaPortraitAdjustments = {
	enabled: true,
	values: { face_adjust_TotalFace: 25 },
};

describe("native portrait source-window eligibility", () => {
	it("accepts native global adjustments including legacy engine/target defaults", () => {
		expect(canUseNativePortraitSourceWindow({ adjustments })).toBe(true);
		expect(
			canUseNativePortraitSourceWindow({
				adjustments: {
					...adjustments,
					engine: "native",
					faceTarget: { mode: "all" },
				},
			})
		).toBe(true);
	});
	it.each([
		{ enabled: false },
		{ values: {} },
		{ engine: "independent" as const },
		{ faceTarget: { mode: "single" as const, faceId: 1 } },
		{
			faces: [
				{
					trackId: 1,
					personBindingId: "person-1",
					values: { face_adjust_TotalFace: 10 },
				},
			],
		},
		{ manualBody: {} },
		{
			manualRetouch: {
				strokes: [
					{
						id: "stroke",
						tool: "smooth" as const,
						mode: "paint" as const,
						size: 0.1,
						intensity: 50,
						points: [{ x: 0.5, y: 0.5 }],
					},
				],
			},
		},
	])("rejects unsupported scope %j", (change) => {
		expect(
			canUseNativePortraitSourceWindow({
				adjustments: { ...adjustments, ...change },
			})
		).toBe(false);
	});
	it("rejects stabilized source pixels and absent settings", () => {
		expect(
			canUseNativePortraitSourceWindow({ adjustments, stabilization: 1 })
		).toBe(false);
		expect(
			canUseNativePortraitSourceWindow({
				adjustments,
				stabilization: Number.NaN,
			})
		).toBe(false);
		expect(canUseNativePortraitSourceWindow({})).toBe(false);
	});
	it("separates continuous and bounded-history identities without truncation collisions", () => {
		expect(portraitSourceWindowKey({ sourceKey: "video:A" })).toBe(
			"source-window-v1:video:A"
		);
		expect(portraitSourceWindowKey({ sourceKey: "video:B" })).not.toBe(
			portraitSourceWindowKey({ sourceKey: "video:A" })
		);
		expect(() =>
			portraitSourceWindowKey({ sourceKey: "x".repeat(512) })
		).toThrow("too long");
	});
});
