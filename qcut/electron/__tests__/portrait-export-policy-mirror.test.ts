import {
	hasMediaPortraitAdjustments,
	normalizeMediaPortraitAdjustments,
} from "@qcut/editor-core";
import { describe, expect, it } from "vitest";
import { portraitAdjustmentsAreActive } from "../types/portrait-export-policy.js";

/**
 * The main-process export policy mirrors editor-core's activity test (the
 * main process cannot load packages/ at runtime); on stored shapes the two
 * must agree.
 */
const stroke = {
	id: "s",
	tool: "smooth",
	mode: "paint",
	size: 20,
	intensity: 50,
	points: [
		{ x: 0.4, y: 0.5 },
		{ x: 0.6, y: 0.5 },
	],
};
const cases: unknown[] = [
	{ enabled: true, values: {} },
	{ enabled: false, values: { face_adjust_Whiten: 30 } },
	{ enabled: true, values: { face_adjust_Whiten: 30 } },
	{ enabled: true, values: { body_adjust_SlimBody: -20 } },
	{ enabled: true, values: { face_adjust_skin_Intensity: 40 } },
	{
		enabled: true,
		skinToneResourceId: null,
		values: { face_adjust_skin_Intensity: 40 },
	},
	{
		enabled: true,
		values: {},
		makeup: { lip: { cardId: "lip-coral-nude", intensity: 40 } },
	},
	{
		enabled: true,
		values: {},
		makeup: { lip: { cardId: "lip-coral-nude", intensity: 0 } },
	},
	{
		enabled: true,
		values: {},
		manualBody: { stretch: { intensity: 20, upper: 0.7, bottom: 0.2 } },
	},
	{
		enabled: true,
		values: {},
		manualBody: {
			slim: {
				intensity: -10,
				x: 0.5,
				y: 0.5,
				width: 0.2,
				height: 0.3,
				rotation: 0,
			},
		},
	},
	{
		enabled: true,
		values: {},
		manualBody: {
			zoom: { intensity: 0, x: 0.5, y: 0.5, radius: 0.2 },
			stretch: { intensity: 0, upper: 0.7, bottom: 0.2 },
		},
	},
	{ enabled: true, values: {}, manualRetouch: { strokes: [stroke] } },
	{ enabled: true, values: {}, manualRetouch: { strokes: [] } },
	{
		enabled: true,
		values: {},
		faces: [{ trackId: 1, values: { face_adjust_Nose: 15 } }],
	},
	{
		enabled: true,
		values: {},
		faces: [
			{
				trackId: 2,
				values: {},
				makeup: { blush: { cardId: "blush-baby-pink", intensity: 25 } },
			},
		],
	},
	{ enabled: true, values: {}, faces: [{ trackId: 3, values: {} }] },
];

describe("portrait export policy mirror", () => {
	it.each(cases)("agrees with editor-core on %j", (candidate) => {
		const expected =
			typeof candidate === "object" &&
			candidate !== null &&
			(candidate as { enabled?: unknown }).enabled === true &&
			hasMediaPortraitAdjustments({
				adjustments: normalizeMediaPortraitAdjustments({
					adjustments: candidate as never,
				}),
			});
		expect(portraitAdjustmentsAreActive({ candidate })).toBe(expected);
	});
});
