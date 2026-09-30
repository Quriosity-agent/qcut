import { describe, expect, it } from "vitest";
import {
	hasMediaPortraitAdjustments,
	normalizeMediaPortraitAdjustments,
} from "../portrait-adjustments.js";

describe("media portrait adjustments", () => {
	it("round-trips every new nose and brow key including per-face values", () => {
		const keys = [
			"face_adjust_MaShengNose",
			"face_adjust_XiaoQiaoBi",
			"face_adjust_TuoFengNose",
			"eyebrow_adjust_BiaoZhun",
			"eyebrow_adjust_LiuYe",
			"eyebrow_adjust_JianMei",
		] as const;
		const values = Object.fromEntries(keys.map((key) => [key, 50]));
		const adjustments = {
			enabled: true,
			values,
			faces: [{ trackId: 2, values }],
		};
		expect(
			normalizeMediaPortraitAdjustments({
				adjustments: JSON.parse(JSON.stringify(adjustments)),
			})
		).toEqual(adjustments);
	});

	it("preserves neutral makeup choices in saved projects without activating beauty", () => {
		const adjustments = {
			enabled: true,
			values: {},
			makeup: { lip: { cardId: "lip-soft-pink", intensity: 0 } },
			faces: [
				{
					trackId: 2,
					values: {},
					makeup: { brows: { cardId: "brows-flow", intensity: 0 } },
				},
			],
		};
		const normalized = normalizeMediaPortraitAdjustments({
			adjustments: JSON.parse(JSON.stringify(adjustments)),
		});
		expect(normalized).toEqual(adjustments);
		expect(hasMediaPortraitAdjustments({ adjustments: normalized })).toBe(
			false
		);
	});
	it("persists GAN contour independently of legacy temple values, including per-face entries", () => {
		const adjustments = {
			enabled: true,
			values: { face_adjust_temple: 35, face_adjust_lunkuopinghua: 50 },
			faces: [{ trackId: 2, values: { face_adjust_lunkuopinghua: 75 } }],
		};
		const normalized = normalizeMediaPortraitAdjustments({ adjustments });
		expect(normalized).toEqual(adjustments);
		expect(
			normalizeMediaPortraitAdjustments({
				adjustments: JSON.parse(JSON.stringify(normalized)),
			})
		).toEqual(adjustments);
		expect(hasMediaPortraitAdjustments({ adjustments: normalized })).toBe(true);
	});

	it("keeps finite supported values and drops neutral or unknown input", () => {
		const normalized = normalizeMediaPortraitAdjustments({
			adjustments: {
				enabled: true,
				values: {
					face_adjust_TotalFace: 60,
					face_adjust_Nose: 0,
					unknown: 90,
				} as never,
			},
		});
		expect(normalized).toEqual({
			enabled: true,
			values: { face_adjust_TotalFace: 60 },
		});
		expect(hasMediaPortraitAdjustments({ adjustments: normalized })).toBe(true);
	});

	it("requires both the master switch and a non-neutral value", () => {
		expect(
			hasMediaPortraitAdjustments({
				adjustments: {
					enabled: false,
					values: { body_adjust_SlimWaist: 80 },
				},
			})
		).toBe(false);
		expect(
			hasMediaPortraitAdjustments({
				adjustments: { enabled: true, values: {} },
			})
		).toBe(false);
	});

	it("normalizes face targeting and makeup selections", () => {
		const normalized = normalizeMediaPortraitAdjustments({
			adjustments: {
				enabled: true,
				values: {},
				faceTarget: { mode: "single", faceId: 2 },
				makeup: {
					lip: { cardId: "lip-soft-pink", intensity: 75 },
					contacts: { cardId: "bad card", intensity: 80 },
				},
			},
		});
		expect(normalized).toEqual({
			enabled: true,
			values: {},
			faceTarget: { mode: "single", faceId: 2 },
			makeup: {
				lip: { cardId: "lip-soft-pink", intensity: 75 },
			},
		});
		expect(hasMediaPortraitAdjustments({ adjustments: normalized })).toBe(true);
	});

	it("drops invalid face IDs and clamps makeup intensity", () => {
		expect(
			normalizeMediaPortraitAdjustments({
				adjustments: {
					enabled: true,
					values: {},
					faceTarget: { mode: "single", faceId: 12 },
					makeup: {
						blush: { cardId: "blush-baby-pink", intensity: 140 },
					},
				},
			})
		).toEqual({
			enabled: true,
			values: {},
			makeup: {
				blush: { cardId: "blush-baby-pink", intensity: 100 },
			},
		});
	});
	it("keeps legacy shapes byte-identical with no faces key", () => {
		const legacy = normalizeMediaPortraitAdjustments({
			adjustments: {
				enabled: true,
				values: { face_adjust_TotalFace: 40 },
				faceTarget: { mode: "single", faceId: 2 },
			},
		});
		expect(legacy).toEqual({
			enabled: true,
			values: { face_adjust_TotalFace: 40 },
			faceTarget: { mode: "single", faceId: 2 },
		});
		expect("faces" in legacy).toBe(false);
	});

	it("validates, dedupes, sorts, and caps per-face entries", () => {
		const normalized = normalizeMediaPortraitAdjustments({
			adjustments: {
				enabled: true,
				values: {},
				faces: [
					{ trackId: 5, values: { face_adjust_Chin: 10 } },
					{ trackId: 5, values: { face_adjust_Chin: 99 } },
					{ trackId: -1, values: { face_adjust_Chin: 10 } },
					{ trackId: 1.5, values: { face_adjust_Chin: 10 } },
					{ trackId: Number.NaN, values: { face_adjust_Chin: 10 } },
					{ trackId: 7, values: {} },
					{ trackId: 0, values: { face_adjust_Smooth: 30 } },
				],
			},
		});
		expect(normalized.faces).toEqual([
			{ trackId: 0, values: { face_adjust_Smooth: 30 } },
			{ trackId: 5, values: { face_adjust_Chin: 10 } },
		]);
	});

	it("caps per-face entries at the native ten-face limit", () => {
		const normalized = normalizeMediaPortraitAdjustments({
			adjustments: {
				enabled: true,
				values: {},
				faces: Array.from({ length: 12 }, (_, index) => ({
					trackId: index,
					values: { face_adjust_Chin: 10 },
				})),
			},
		});
		expect(normalized.faces).toHaveLength(10);
	});

	it("preserves project person bindings independently of session track ids", () => {
		const anchor = {
			rect: { x: 0.1, y: 0.2, width: 0.25, height: 0.3 },
			frameNumber: 24,
		};
		const normalized = normalizeMediaPortraitAdjustments({
			adjustments: {
				enabled: true,
				values: {},
				faces: [
					{
						trackId: 0,
						personBindingId: "portrait-person:first",
						bindingAnchor: anchor,
						values: { face_adjust_Chin: 10 },
					},
					{
						trackId: 0,
						personBindingId: "portrait-person:second",
						bindingAnchor: anchor,
						values: { face_adjust_VFace: 20 },
					},
				],
			},
		});

		expect(normalized.faces).toHaveLength(2);
		expect(normalized.faces?.map((face) => face.personBindingId)).toEqual([
			"portrait-person:first",
			"portrait-person:second",
		]);
		expect(normalized.faces?.[0]?.bindingAnchor).toEqual(anchor);
	});

	it("drops person-bound entries without a usable binding anchor", () => {
		const normalized = normalizeMediaPortraitAdjustments({
			adjustments: {
				enabled: true,
				values: {},
				faces: [
					{
						trackId: 0,
						personBindingId: "portrait-person:first",
						values: { face_adjust_Chin: 10 },
					},
					{
						trackId: 1,
						personBindingId: "portrait-person:second",
						bindingAnchor: {
							rect: { x: 0.5, y: 0.5, width: 0.6, height: 0.2 },
						},
						values: { face_adjust_VFace: 20 },
					},
					{ trackId: 2, values: { face_adjust_Chin: 5 } },
				],
			},
		});
		expect(normalized.faces).toHaveLength(1);
		expect(normalized.faces?.[0]).toEqual({
			trackId: 2,
			values: { face_adjust_Chin: 5 },
		});
	});

	it("activates on per-face-only values or makeup", () => {
		expect(
			hasMediaPortraitAdjustments({
				adjustments: {
					enabled: true,
					values: {},
					faces: [{ trackId: 3, values: { face_adjust_VFace: 25 } }],
				},
			})
		).toBe(true);
		expect(
			hasMediaPortraitAdjustments({
				adjustments: {
					enabled: true,
					values: {},
					faces: [
						{
							trackId: 3,
							values: {},
							makeup: { lip: { cardId: "lip-soft-pink", intensity: 60 } },
						},
					],
				},
			})
		).toBe(true);
	});

	it("is idempotent for per-face shapes", () => {
		const once = normalizeMediaPortraitAdjustments({
			adjustments: {
				enabled: true,
				values: { face_adjust_Whiten: 20 },
				faces: [{ trackId: 2, values: { face_adjust_Chin: -15 } }],
			},
		});
		expect(normalizeMediaPortraitAdjustments({ adjustments: once })).toEqual(
			once
		);
	});
});
