import { describe, expect, it } from "vitest";
import { selectPortraitSkinTone } from "../portrait-skin-tone";
import {
	createPortraitPreset,
	applyPortraitPreset,
	parsePortraitPresetExport,
	serializePortraitPresets,
} from "../portrait-presets";
import { normalizeMediaPortraitAdjustments } from "@qcut/editor-core";
import { applyPortraitAdjustments } from "../portrait-face-scope";

describe("skin palette persistence", () => {
	it.each([
		"7408757645705776384",
		null,
	] as const)("applies a preset's global skin selection %j without assigning it to one face", (skinToneResourceId) => {
		const result = applyPortraitAdjustments({
			adjustments: { enabled: true, values: { face_adjust_Smooth: 10 } },
			scope: {
				mode: "face",
				trackId: 2,
				personBindingId: "person-2",
				bindingAnchor: { rect: { x: 0, y: 0, width: 0.5, height: 0.5 } },
			},
			edited: {
				enabled: true,
				skinToneResourceId,
				values: {
					face_adjust_skin_Intensity: 45,
					face_adjust_skin_ColdWarm: -15,
					face_adjust_eye: 20,
				},
			},
		});
		expect(result.skinToneResourceId).toBe(skinToneResourceId);
		expect(result.values).toEqual({
			face_adjust_Smooth: 10,
			...(skinToneResourceId === null
				? {}
				: { face_adjust_skin_Intensity: 45, face_adjust_skin_ColdWarm: -15 }),
		});
		expect(result.faces?.[0].values).toEqual({ face_adjust_eye: 20 });
		expect(result.faces?.[0]).not.toHaveProperty("skinToneResourceId");
	});
	it.each([
		"7408757645705743616",
		"7408757645705760000",
		"7408757645705776384",
		"7408757645705792768",
		"7408757645705809152",
		null,
	] as const)("roundtrips %j through normalized project and exported face preset", (skinToneResourceId) => {
		const adjustments = {
			enabled: true,
			skinToneResourceId,
			values: {
				face_adjust_skin_Intensity: 50,
				face_adjust_skin_ColdWarm: -15,
			},
		};
		const normalized = normalizeMediaPortraitAdjustments({
			adjustments: JSON.parse(JSON.stringify(adjustments)),
		});
		expect(normalized).toEqual(adjustments);
		const preset = createPortraitPreset({
			adjustments: normalized,
			scope: "face",
			name: "skin",
		});
		const [imported] = parsePortraitPresetExport({
			value: JSON.parse(serializePortraitPresets({ presets: [preset] })),
		});
		expect(imported.skinToneResourceId).toBe(skinToneResourceId);
		expect(
			applyPortraitPreset({
				adjustments: { enabled: false, values: {} },
				preset: imported,
			})
		).toEqual(adjustments);
	});
	it("legacy presets clear explicit selection and keep the pink default", () => {
		const preset = createPortraitPreset({
			adjustments: {
				enabled: true,
				values: { face_adjust_skin_Intensity: 50 },
			},
			scope: "face",
		});
		expect(
			applyPortraitPreset({
				adjustments: {
					enabled: true,
					skinToneResourceId: "7408757645705776384",
					values: {},
				},
				preset,
			})
		).not.toHaveProperty("skinToneResourceId");
	});
	it("body presets preserve the global palette and do not capture it", () => {
		const adjustments = {
			enabled: true,
			skinToneResourceId: "7408757645705776384" as const,
			values: { face_adjust_skin_ColdWarm: 25 },
		};
		const preset = createPortraitPreset({ adjustments, scope: "body" });
		expect(preset).not.toHaveProperty("skinToneResourceId");
		expect(
			applyPortraitPreset({ adjustments, preset }).skinToneResourceId
		).toBe(adjustments.skinToneResourceId);
	});
	it("removes conflicting legacy per-face skin settings without touching other features", () => {
		const result = selectPortraitSkinTone({
			adjustments: {
				enabled: true,
				values: {},
				faces: [
					{ trackId: 0, values: { face_adjust_skin_Intensity: 90 } },
					{
						trackId: 1,
						values: { face_adjust_eye: 25, face_adjust_skin_ColdWarm: 20 },
					},
				],
			},
			resourceId: "7408757645705776384",
		});
		expect(result.faces).toEqual([
			{ trackId: 1, values: { face_adjust_eye: 25 } },
		]);
	});
});
