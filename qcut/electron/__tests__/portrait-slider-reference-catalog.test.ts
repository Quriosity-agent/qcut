// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	buildJianyingPortraitFeatureParameters,
	JIANYING_PORTRAIT_ADJUSTMENT_CATALOG,
	jianyingPortraitRuntimePackageForControl,
} from "../jianying-portrait-adjustment-runtime/catalog.js";

describe("portrait reference control identity", () => {
	it("routes the nose-position label to the feature operator without rewriting classic projects", () => {
		const position = JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.filter(
			(control) => control.titleZh === "鼻高低"
		);
		expect(position).toHaveLength(1);
		expect(position[0]).toMatchObject({
			key: "face_adjust_nose_position",
			category: "nose",
			min: -50,
			max: 50,
		});
		expect(
			jianyingPortraitRuntimePackageForControl({ control: position[0] })
		).toBe("features");
		const classic = JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.find(
			(control) => control.key === "face_adjust_MoveNose"
		);
		expect(classic).toMatchObject({
			titleZh: "鼻部位移（基础）",
			category: "details",
			min: -50,
			max: 50,
		});
		if (!classic) throw new Error("Missing classic nose control");
		expect(jianyingPortraitRuntimePackageForControl({ control: classic })).toBe(
			"face"
		);
		const parameters = JSON.parse(
			buildJianyingPortraitFeatureParameters({
				runtimePackage: "face",
				values: { face_adjust_MoveNose: -48 },
			})
		);
		expect(parameters.face_adjust_MoveNose).toEqual([
			{ id: -1, intensity: -0.48 },
		]);
		expect(parameters).not.toHaveProperty("face_adjust_nose_position");
	});

	it.each([
		{ key: "face_adjust_EnlargeEye", category: "eyes" },
		{ key: "face_adjust_EyeSpacing", category: "eyes" },
		{ key: "face_adjust_inner_corner", category: "eyes" },
		{ key: "face_adjust_Nose", category: "nose" },
		{ key: "face_adjust_nose", category: "details" },
		{ key: "face_adjust_ZoomMouth", category: "mouth" },
	])("keeps $key in its canonical or legacy group", ({ key, category }) => {
		expect(
			JIANYING_PORTRAIT_ADJUSTMENT_CATALOG.find(
				(control) => control.key === key
			)?.category
		).toBe(category);
	});

	it("preserves independent case-sensitive nose operators and signed feature values", () => {
		const parameters = JSON.parse(
			buildJianyingPortraitFeatureParameters({
				runtimePackage: "features",
				values: {
					face_adjust_nose_position: -48,
					face_adjust_nose: 50,
					face_adjust_Nose: 99,
				},
			})
		);
		expect(parameters.face_adjust_nose_position).toEqual([
			{ id: -1, intensity: -0.48 },
		]);
		expect(parameters.face_adjust_nose).toEqual([{ id: -1, intensity: 0.5 }]);
		expect(parameters).not.toHaveProperty("face_adjust_Nose");
	});

	it("exposes the export-calibrated eye-corner operator without migrating classic values", () => {
		const controls = JIANYING_PORTRAIT_ADJUSTMENT_CATALOG;
		expect(controls.filter(({ titleZh }) => titleZh === "开眼角")).toEqual([
			expect.objectContaining({
				key: "face_adjust_inner_corner",
				runtimePackage: "features",
				category: "eyes",
				min: 0,
				max: 100,
			}),
		]);
		expect(
			controls.find(({ key }) => key === "face_adjust_CornerEye")
		).toMatchObject({
			titleZh: "眼角扩张（基础）",
			category: "details",
			min: 0,
			max: 100,
		});
		const canonical = JSON.parse(
			buildJianyingPortraitFeatureParameters({
				runtimePackage: "features",
				values: { face_adjust_inner_corner: 99 },
			})
		);
		expect(canonical.face_adjust_inner_corner).toEqual([
			{ id: -1, intensity: 0.99 },
		]);
		const classic = JSON.parse(
			buildJianyingPortraitFeatureParameters({
				runtimePackage: "face",
				values: { face_adjust_CornerEye: 99 },
			})
		);
		expect(classic.face_adjust_CornerEye).toEqual([
			{ id: -1, intensity: 0.99 },
		]);
		expect(classic).not.toHaveProperty("face_adjust_inner_corner");
	});
});
